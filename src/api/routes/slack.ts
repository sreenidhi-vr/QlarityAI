/**
 * Slack API routes for events, commands, and interactions
 * Handles Slack webhook endpoints with proper validation and async processing
 * Uses UnifiedOrchestrator for modern platform abstraction
 */

import type { FastifyInstance, FastifyPluginOptions, FastifyRequest, FastifyReply } from 'fastify';
import type {
  SlackEventPayload,
  SlackCommandPayload,
  SlackActionPayload,
  SlackViewSubmissionPayload
} from '@/types';
import { RAGError } from '@/types';
import config from '@/utils/config';
import { UnifiedOrchestrator } from '@/core/orchestrator/unifiedOrchestrator';
import { RAGPipeline } from '@/core/rag/ragPipeline';
import { createLLMAdapter } from '@/adapters/llm';
import { createEmbeddingAdapter } from '@/adapters/embedding';
import { PostgresVectorAdapter } from '@/adapters/vector-store/postgres';
import { SlackDelivery } from '@/services/delivery/slackDelivery';
import {
  toPlatformContext,
  formatResponseForSlack,
  createSlackErrorResponse,
  createSourcesModal,
  createFollowupModal,
  extractButtonActionData,
  extractFollowupData
} from '@/adapters/platform/slackAdapter';
import {
  validateSlackRequest,
  extractQueryFromSlackText
} from '@/utils/slackValidation';
import { metrics, MetricNames, startTimer } from '@/utils/metrics';
import axios from 'axios';

// Global instances
let orchestrator: UnifiedOrchestrator | null = null;
let slackDelivery: SlackDelivery | null = null;

// DUPLICATE PREVENTION: Content-based deduplication with request queuing
const processingQueries = new Map<string, Promise<any>>();
const processedQueries = new Map<string, number>();
const DEDUP_WINDOW_MS = 3000; // 3 seconds
const PROCESSING_TIMEOUT_MS = 30000; // 30 seconds max processing time

// Clean up old entries periodically
setInterval(() => {
  const now = Date.now();
  
  // Clean up processed queries
  for (const [key, timestamp] of processedQueries.entries()) {
    if (now - timestamp > DEDUP_WINDOW_MS) {
      processedQueries.delete(key);
    }
  }
  
  // Clean up stale processing queries
  for (const key of processingQueries.keys()) {
    const [, , , , timestamp] = key.split('|');
    if (timestamp && now - parseInt(timestamp) > PROCESSING_TIMEOUT_MS) {
      console.warn('[Slack Unified] Removing stale processing query', { key });
      processingQueries.delete(key);
    }
  }
}, 30000);

function shouldProcessQuery(userId: string, cleanQuery: string, eventType: string, eventId: string):
  { shouldProcess: boolean; reason?: string; existingPromise?: Promise<any> } {
  
  const now = Date.now();
  const contentKey = `${userId}|${cleanQuery?.substring(0, 100)}`;
  
  // Check if identical query is currently being processed
  for (const [processingKey, promise] of processingQueries.entries()) {
    const processingContentKey = processingKey.split('|').slice(0, 2).join('|');
    if (processingContentKey === contentKey) {
      console.warn('[Slack Unified] Query already processing', {
        eventId,
        eventType,
        userId,
        query: cleanQuery?.substring(0, 50)
      });
      return {
        shouldProcess: false,
        reason: 'already_processing_content_match',
        existingPromise: promise
      };
    }
  }
  
  // Check if same query was recently processed
  if (processedQueries.has(contentKey)) {
    const timestamp = processedQueries.get(contentKey)!;
    if (now - timestamp < DEDUP_WINDOW_MS) {
      console.warn('[Slack Unified] Query recently processed', {
        eventId,
        eventType,
        userId,
        query: cleanQuery?.substring(0, 50),
        timeSinceLastMs: now - timestamp
      });
      return { shouldProcess: false, reason: 'recently_processed_content' };
    }
  }
  
  return { shouldProcess: true };
}

function markQueryAsProcessing(userId: string, cleanQuery: string, eventType: string, eventId: string, promise: Promise<any>): string {
  const now = Date.now();
  const uniqueKey = `${userId}|${cleanQuery?.substring(0, 100)}|${eventType}|${eventId}|${now}`;
  processingQueries.set(uniqueKey, promise);
  return uniqueKey;
}

function markQueryAsCompleted(processingKey: string, userId: string, cleanQuery: string): void {
  const now = Date.now();
  const contentKey = `${userId}|${cleanQuery?.substring(0, 100)}`;
  
  processingQueries.delete(processingKey);
  processedQueries.set(contentKey, now);
  
  console.log('[Slack Unified] Query completed', {
    processingKey: processingKey.split('|')[3],
    eventType: processingKey.split('|')[2],
    userId,
    query: cleanQuery?.substring(0, 50),
    contentKey
  });
}

/**
 * Initialize unified Slack components on first request
 */
async function initializeSlackComponents(request: FastifyRequest): Promise<{
  orchestrator: UnifiedOrchestrator;
  delivery: SlackDelivery;
}> {
  if (!orchestrator || !slackDelivery) {
    request.log.info('Initializing unified Slack components...');
    
    if (!config.SLACK_BOT_TOKEN || !config.SLACK_SIGNING_SECRET) {
      throw new RAGError(
        'Slack integration not configured - missing SLACK_BOT_TOKEN or SLACK_SIGNING_SECRET',
        'SLACK_NOT_CONFIGURED'
      );
    }

    try {
      // Initialize RAG pipeline components
      const embeddingAdapter = await createEmbeddingAdapter(
        config.EMBEDDING_PROVIDER,
        { model: config.EMBEDDING_MODEL }
      );
      
      const llmAdapter = await createLLMAdapter(
        config.LLM_PROVIDER,
        { model: config.LLM_MODEL }
      );
      
      const vectorStore = new PostgresVectorAdapter({
        connectionString: config.DATABASE_URL,
        tableName: config.VECTOR_TABLE_NAME,
      });

      // Test vector store connectivity
      const isHealthy = await vectorStore.health();
      if (!isHealthy) {
        throw new RAGError(
          'Vector database is not available for Slack integration',
          'VECTOR_DB_UNHEALTHY'
        );
      }

      const ragPipeline = new RAGPipeline(embeddingAdapter, vectorStore, llmAdapter);
      orchestrator = new UnifiedOrchestrator(ragPipeline, metrics);
      slackDelivery = new SlackDelivery(config.SLACK_BOT_TOKEN);
      
      request.log.info('Unified Slack components initialized successfully');
    } catch (error) {
      request.log.error({
        error: error instanceof Error ? error.message : 'Unknown error'
      }, 'Failed to initialize unified Slack components');
      throw error;
    }
  }
  
  return {
    orchestrator: orchestrator!,
    delivery: slackDelivery!
  };
}

/**
 * Process Slack message through unified orchestrator
 */
async function processSlackMessage(
  payload: SlackEventPayload | SlackCommandPayload,
  orchestrator: UnifiedOrchestrator,
  delivery: SlackDelivery,
  _request: FastifyRequest
): Promise<void> {
  const timer = startTimer();
  
  try {
    // Convert to platform context
    const platformContext = toPlatformContext(payload);
    
    console.log('[Slack Unified] Processing message', {
      platform: platformContext.platform,
      userId: platformContext.userId,
      channelId: platformContext.channelId,
      query: platformContext.query.substring(0, 100)
    });

    metrics.incrementCounter(MetricNames.SLACK_EVENTS_TOTAL, {
      type: 'event' in payload ? 'event' : 'command',
      eventType: 'event' in payload ? payload.event?.type : payload.command
    });

    // Process through unified orchestrator
    const result = await orchestrator.handlePlatformQuery(platformContext);

    // Format response for Slack
    const slackResponse = formatResponseForSlack(result, {
      includeButtons: true,
      maxTextLength: 3000
    });

    console.log('[Slack Unified] Orchestrator processing completed', {
      userId: platformContext.userId,
      success: true,
      confidence: result.confidence,
      intent: result.intent,
      sourcesCount: result.sources.length,
      processingTimeMs: result.metadata.processingTimeMs
    });

    // Send response using delivery service
    const responseUrl = platformContext.metadata?.responseUrl as string | undefined;
    const deliveryResult = await delivery.sendWithFallback(
      {
        channel: platformContext.channelId,
        text: slackResponse.text,
        blocks: slackResponse.blocks,
        ...(platformContext.threadId && { thread_ts: platformContext.threadId })
      },
      responseUrl
    );

    const totalTime = timer();
    
    if (deliveryResult.success) {
      metrics.incrementCounter(MetricNames.SLACK_DELIVERY_TOTAL, { status: 'success' });
      metrics.recordDuration(MetricNames.SLACK_DELIVERY_DURATION_MS, deliveryResult.deliveryTimeMs);
      
      console.log('[Slack Unified] Response delivered successfully', {
        userId: platformContext.userId,
        method: deliveryResult.method,
        messageTs: deliveryResult.messageTs,
        totalTimeMs: totalTime,
        deliveryTimeMs: deliveryResult.deliveryTimeMs
      });
    } else {
      metrics.incrementCounter(MetricNames.SLACK_DELIVERY_TOTAL, { status: 'error' });
      
      console.error('[Slack Unified] Response delivery failed', {
        userId: platformContext.userId,
        error: deliveryResult.error,
        totalTimeMs: totalTime
      });
    }

  } catch (error) {
    const totalTime = timer();
    
    console.error('[Slack Unified] Message processing failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
      totalTimeMs: totalTime
    });

    metrics.incrementCounter(MetricNames.SLACK_DELIVERY_TOTAL, { status: 'error' });

    // Send error response
    try {
      const errorResponse = createSlackErrorResponse(
        'Sorry, I encountered an error processing your message. Please try again.',
        false
      );
      
      const platformContext = toPlatformContext(payload);
      const responseUrl = platformContext.metadata?.responseUrl as string | undefined;
      
      await delivery.sendWithFallback(
        {
          channel: platformContext.channelId,
          text: errorResponse.text,
          blocks: errorResponse.blocks
        },
        responseUrl
      );
    } catch (deliveryError) {
      console.error('[Slack Unified] Failed to send error response', {
        deliveryError: deliveryError instanceof Error ? deliveryError.message : 'Unknown error'
      });
    }
  }
}

/**
 * Process /ask command through unified orchestrator
 */
async function processUnifiedAskCommand(
  payload: SlackCommandPayload,
  request: FastifyRequest
): Promise<void> {
  const { orchestrator, delivery } = await initializeSlackComponents(request);
  await processSlackMessage(payload, orchestrator, delivery, request);
}

/**
 * Unified command processor for multiple Slack commands
 * Routes /ask commands to internal RAG pipeline
 * Routes /domo commands to external n8n webhook
 */
async function processUnifiedSlackCommand(
  payload: SlackCommandPayload,
  request: FastifyRequest
): Promise<void> {
  const { command, text, user_id } = payload;

  request.log.info({
    command,
    user: user_id,
    text: text?.substring(0, 100)
  }, 'Processing unified Slack command');

  metrics.incrementCounter(MetricNames.SLACK_COMMANDS_TOTAL, { command });

  try {
    if (command === '/ask') {
      await processUnifiedAskCommand(payload, request);
    } else if (command === '/domo') {
      await processDomoCommand(payload, request);
    } else {
      request.log.warn({ command, user: user_id }, 'Unknown command received');
      await sendSlackError(payload, `Unknown command: ${command}. Supported commands: /ask, /domo`);
    }
  } catch (error) {
    request.log.error({
      error: error instanceof Error ? error.message : 'Unknown error',
      command,
      user: user_id
    }, 'Failed to process unified command');
    
    await sendSlackError(payload, 'An error occurred while processing your request. Please try again.');
  }
}

/**
 * Process /domo command through external n8n webhook (unchanged)
 */
async function processDomoCommand(
  payload: SlackCommandPayload,
  request: FastifyRequest
): Promise<void> {
  // Keep existing domo command logic unchanged
  request.log.info({
    hasN8nUrl: !!config.N8N_WEBHOOK_URL,
    user: payload.user_id,
    text: payload.text?.substring(0, 100)
  }, '[DOMO-DEBUG] Starting /domo command processing');

  if (!config.N8N_WEBHOOK_URL) {
    request.log.error('[DOMO-DEBUG] FAILED: N8N_WEBHOOK_URL not configured');
    throw new RAGError('N8N_WEBHOOK_URL not configured', 'N8N_NOT_CONFIGURED');
  }

  try {
    const requestPayload = {
      text: payload.text,
      user_name: payload.user_name,
      user_id: payload.user_id,
      channel_id: payload.channel_id,
      channel_name: payload.channel_name,
      team_id: payload.team_id,
      command: payload.command,
      response_url: payload.response_url,
      trigger_id: payload.trigger_id
    };

    const response = await axios.post(config.N8N_WEBHOOK_URL, requestPayload, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 10000
    });

    request.log.info({
      status: response.status,
      user: payload.user_id
    }, '[DOMO-DEBUG] SUCCESS: Received response from n8n');

  } catch (error) {
    request.log.error({
      error: error instanceof Error ? error.message : 'Unknown error',
      user: payload.user_id
    }, '[DOMO-DEBUG] FAILED: Error forwarding to n8n');

    await sendSlackError(payload, 'Failed to process /domo command. Please try again later.');
  }
}

/**
 * Send error message back to Slack using response_url
 */
async function sendSlackError(payload: SlackCommandPayload, message: string): Promise<void> {
  try {
    await axios.post(payload.response_url, {
      text: message,
      response_type: 'ephemeral',
      blocks: [{
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `❌ ${message}`
        }
      }]
    }, {
      headers: {
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('Failed to send error message to Slack:', error);
  }
}

/**
 * Initialize Slack handler on first request
 */
/**
 * Process Slack interactive actions
 */
async function processSlackAction(
  payload: SlackActionPayload | SlackViewSubmissionPayload,
  orchestrator: UnifiedOrchestrator,
  delivery: SlackDelivery,
  request: FastifyRequest
): Promise<void> {
  console.log('[Slack Unified] Processing interactive action', {
    type: payload.type,
    userId: payload.user.id
  });

  metrics.incrementCounter(MetricNames.SLACK_ACTIONS_TOTAL, { type: payload.type });

  try {
    if (payload.type === 'block_actions') {
      const actionData = extractButtonActionData(payload as SlackActionPayload);
      if (!actionData) {
        console.warn('[Slack Unified] No valid action data');
        return;
      }

      switch (actionData.actionId) {
        case 'show_sources':
          await handleShowSources(actionData, delivery, payload);
          break;
        case 'ask_followup':
          await handleAskFollowup(actionData, delivery, payload);
          break;
        default:
          console.warn('[Slack Unified] Unknown action', { actionId: actionData.actionId });
      }
    } else if (payload.type === 'view_submission') {
      const followupData = extractFollowupData(payload);
      if (followupData) {
        await handleSubmitFollowup(followupData, orchestrator, delivery, payload as SlackViewSubmissionPayload, request);
      }
    }
  } catch (error) {
    console.error('[Slack Unified] Action processing failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
      type: payload.type,
      userId: payload.user.id
    });
  }
}

/**
 * Handle show sources action
 */
async function handleShowSources(
  _actionData: any,
  delivery: SlackDelivery,
  payload: SlackActionPayload | SlackViewSubmissionPayload
): Promise<void> {
  // In a real implementation, retrieve sources from cache
  const sourcesModal = createSourcesModal([
    {
      id: 'example',
      title: 'Example Source',
      url: 'https://support.powerschool.com/',
      snippet: 'This is an example source snippet...',
      retrieval_score: 0.95
    }
  ]);

  if (payload.trigger_id) {
    await delivery.openModal(payload.trigger_id, sourcesModal);
  }
}

/**
 * Handle ask followup action
 */
async function handleAskFollowup(
  actionData: any,
  delivery: SlackDelivery,
  payload: SlackActionPayload | SlackViewSubmissionPayload
): Promise<void> {
  const followupModal = createFollowupModal({
    text: 'Original answer text would be here...',
    summary: 'Original summary',
    sources: [],
    confidence: 0.8,
    intent: 'other',
    platformHints: {},
    metadata: {
      processingTimeMs: 1000,
      contextId: actionData.buttonData?.responseId || 'example',
      platform: 'slack',
      userId: payload.user.id,
      channelId: actionData.buttonData?.channelId || 'unknown'
    }
  } as any);

  if (payload.trigger_id) {
    await delivery.openModal(payload.trigger_id, followupModal);
  }
  
  metrics.incrementCounter(MetricNames.FOLLOWUP_MODAL_OPENS_TOTAL, { platform: 'slack' });
}

/**
 * Handle submit followup action
 */
async function handleSubmitFollowup(
  followupData: any,
  orchestrator: UnifiedOrchestrator,
  delivery: SlackDelivery,
  payload: SlackViewSubmissionPayload,
  _request: FastifyRequest
): Promise<void> {
  // Create followup context with parent context reference
  const followupContext = {
    platform: 'slack' as const,
    userId: payload.user.id,
    channelId: followupData.metadata.originalResponseId || 'unknown', // Would normally get from cache
    query: followupData.followupQuestion,
    metadata: {
      parentContextId: followupData.metadata.originalResponseId
    }
  };

  // Process followup through orchestrator
  const result = await orchestrator.handlePlatformQuery(followupContext);
  
  // Format and send response
  const slackResponse = formatResponseForSlack(result, {
    includeButtons: true,
    maxTextLength: 3000
  });

  await delivery.postMessage({
    channel: followupContext.channelId,
    text: slackResponse.text,
    blocks: slackResponse.blocks
  });
}

async function slackRoute(
  fastify: FastifyInstance,
  _opts: FastifyPluginOptions
): Promise<void> {
  // Middleware to validate Slack requests
  const validateSlackSignature = async (request: FastifyRequest, reply: FastifyReply) => {
    const signature = request.headers['x-slack-signature'] as string;
    const timestamp = request.headers['x-slack-request-timestamp'] as string;
    const contentType = request.headers['content-type'] as string;
    
    // DIAGNOSTIC: Log incoming request details
    request.log.info({
      hasSignature: !!signature,
      hasTimestamp: !!timestamp,
      contentType,
      bodyType: typeof request.body,
      ip: request.ip,
      url: request.url,
      method: request.method
    }, '[SLACK-AUTH-DEBUG] Processing Slack request validation');
    
    let body: string;
    
    // Handle different content types for signature validation
    if (contentType && contentType.includes('application/x-www-form-urlencoded')) {
      const parsedBody = request.body as Record<string, any>;
      
      request.log.info({
        parsedBodyKeys: Object.keys(parsedBody),
        hasPayload: !!parsedBody.payload,
        bodyKeysCount: Object.keys(parsedBody).length
      }, '[SLACK-AUTH-DEBUG] Processing form-urlencoded body');
      
      // For interactive actions (payload field), reconstruct exactly as the test creates it
      if (parsedBody.payload && Object.keys(parsedBody).length === 1) {
        // Interactive actions: payload=encodeURIComponent(JSON.stringify(data))
        body = `payload=${encodeURIComponent(parsedBody.payload)}`;
        request.log.info({
          bodyLength: body.length,
          bodyStart: body.substring(0, 100)
        }, '[SLACK-AUTH-DEBUG] Reconstructed interactive payload body');
      } else {
        // For other form data (slash commands), use URLSearchParams
        const urlParams = new URLSearchParams();
        for (const [key, value] of Object.entries(parsedBody)) {
          urlParams.append(key, String(value));
        }
        body = urlParams.toString();
        request.log.info({
          bodyLength: body.length,
          bodyStart: body.substring(0, 100)
        }, '[SLACK-AUTH-DEBUG] Reconstructed URLSearchParams body');
      }
    } else {
      // For JSON requests, stringify the body
      body = JSON.stringify(request.body);
      request.log.info({
        bodyLength: body.length,
        bodyStart: body.substring(0, 100)
      }, '[SLACK-AUTH-DEBUG] Stringified JSON body');
    }

    request.log.info({
      finalBodyLength: body.length,
      signature: signature?.substring(0, 20) + '...',
      timestamp: timestamp
    }, '[SLACK-AUTH-DEBUG] Calling validateSlackRequest');

    const validation = validateSlackRequest(body, timestamp, signature);
    
    request.log.info({
      validationResult: validation.isValid,
      validationError: validation.error,
      validationTimestamp: validation.timestamp
    }, '[SLACK-AUTH-DEBUG] Validation result received');
    
    if (!validation.isValid) {
      request.log.error({
        error: validation.error,
        timestamp: validation.timestamp,
        ip: request.ip,
        contentType,
        bodyLength: body.length,
        url: request.url
      }, '[SLACK-AUTH-DEBUG] RETURNING 401 - Invalid Slack request signature');
      
      return reply.status(401).send({
        error: 'INVALID_SIGNATURE',
        message: 'Request signature validation failed'
      });
    }
    
    request.log.info('[SLACK-AUTH-DEBUG] Signature validation PASSED, continuing to handler');
  };

  /**
   * Slack Events API endpoint
   * Handles app_mention, message events
   */
  fastify.post<{ Body: SlackEventPayload }>(
    '/slack/events',
    {
      preHandler: validateSlackSignature,
      schema: {
        body: {
          type: 'object',
          properties: {
            token: { type: 'string' },
            team_id: { type: 'string' },
            api_app_id: { type: 'string' },
            event: {
              type: 'object',
              properties: {
                type: { type: 'string' },
                user: { type: 'string' },
                text: { type: 'string' },
                ts: { type: 'string' },
                channel: { type: 'string' },
                thread_ts: { type: 'string' },
                channel_type: { type: 'string' }
              },
              required: ['type'] // Only require type, other fields are event-specific
            },
            type: { type: 'string' },
            event_id: { type: 'string' },
            event_time: { type: 'number' },
            challenge: { type: 'string' }
          },
          required: ['type']
        },
        response: {
          200: {
            type: 'object',
            properties: {
              challenge: { type: 'string' },
              status: { type: 'string' }
            }
          },
          400: {
            type: 'object',
            properties: {
              error: { type: 'string' },
              message: { type: 'string' }
            }
          }
        }
      }
    },
    async (request, reply) => {
      const payload = request.body;

      // URL verification challenge
      if (payload.type === 'url_verification') {
        request.log.info('Slack URL verification challenge received');
        return reply.send({ challenge: payload.challenge });
      }

      // Handle event callbacks
      if (payload.type === 'event_callback' && payload.event) {
        const event = payload.event;
        
        // DUPLICATE DIAGNOSIS: Log all event details with enhanced app_mention detection
        const cleanQuery = extractQueryFromSlackText(event.text);
        const contentFingerprint = `${event.user}|${cleanQuery?.substring(0, 100) || 'empty'}`;
        
        request.log.info({
          eventType: event.type,
          user: event.user,
          channel: event.channel,
          eventId: payload.event_id,
          text: event.text?.substring(0, 100),
          cleanQuery: cleanQuery?.substring(0, 50),
          contentFingerprint,
          ts: event.ts,
          thread_ts: event.thread_ts,
          channel_type: event.channel_type,
          team_id: payload.team_id,
          hasAppMention: event.text?.includes('<@') || false,
          isAppMentionType: event.type === 'app_mention'
        }, '[DUPLICATE-DEBUG] Slack event received - checking for app_mention/message overlap');

        // Acknowledge immediately (Slack requires response within 3 seconds)
        reply.send({ status: 'ok' });

        // Process event asynchronously with duplicate prevention
        setImmediate(async () => {
          try {
            // Basic event filtering first
            request.log.info({
              eventId: payload.event_id,
              eventType: event.type,
              user: event.user,
              channel_type: event.channel_type,
              text: event.text?.substring(0, 50)
            }, '[DUPLICATE-PREVENTION] Processing event filters');

            // Filter out bot messages and irrelevant events
            if (event.user === 'USLACKBOT' || event.channel_type === 'im') {
              request.log.info({
                eventId: payload.event_id,
                reason: event.user === 'USLACKBOT' ? 'bot_message' : 'direct_message'
              }, '[DUPLICATE-PREVENTION] Event filtered out');
              return;
            }

            // Only process app_mentions and direct messages to bot
            if (event.type !== 'app_mention' && event.type !== 'message') {
              request.log.info({
                eventId: payload.event_id,
                eventType: event.type
              }, '[DUPLICATE-PREVENTION] Event type not processed');
              return;
            }

            const cleanQuery = extractQueryFromSlackText(event.text);
            
            if (!cleanQuery || cleanQuery.length < 3) {
              request.log.info({
                eventId: payload.event_id,
                queryLength: cleanQuery?.length || 0
              }, '[DUPLICATE-PREVENTION] Query too short, skipping');
              return;
            }

            // DUPLICATE PREVENTION: Check if we should process this query
            const duplicationCheck = shouldProcessQuery(
              event.user || '',
              cleanQuery,
              event.type || '',
              payload.event_id || ''
            );

            if (!duplicationCheck.shouldProcess) {
              request.log.warn({
                eventId: payload.event_id,
                eventType: event.type,
                user: event.user,
                reason: duplicationCheck.reason,
                text: event.text?.substring(0, 50)
              }, '[DUPLICATE-PREVENTION] SKIPPING - Query duplicate detected');
              return;
            }

            request.log.info({
              eventId: payload.event_id,
              eventType: event.type,
              user: event.user,
              channel: event.channel,
              cleanQuery: cleanQuery.substring(0, 100),
              thread_ts: event.thread_ts,
              ts: event.ts
            }, '[DUPLICATE-PREVENTION] Processing unique query');

            // Use unified orchestrator for processing
            const { orchestrator, delivery } = await initializeSlackComponents(request);
            
            // Create unified payload for processing
            const unifiedPayload: SlackEventPayload = {
              ...payload,
              event: {
                ...event,
                text: cleanQuery // Use cleaned query text
              }
            };

            // Mark query as processing and create promise
            const processingPromise = processSlackMessage(unifiedPayload, orchestrator, delivery, request);
            const processingKey = markQueryAsProcessing(
              event.user || '',
              cleanQuery,
              event.type || '',
              payload.event_id || '',
              processingPromise
            );

            try {
              await processingPromise;
              
              // Mark as completed
              markQueryAsCompleted(processingKey, event.user || '', cleanQuery);
              
              request.log.info({
                eventId: payload.event_id,
                success: true,
                processingComplete: true
              }, '[DUPLICATE-PREVENTION] Query processing completed successfully');
              
            } catch (processingError) {
              // Ensure we clean up on error
              markQueryAsCompleted(processingKey, event.user || '', cleanQuery);
              throw processingError;
            }

          } catch (error) {
            request.log.error({
              error: error instanceof Error ? error.message : 'Unknown error',
              eventId: payload.event_id,
              user: event.user,
              channel: event.channel
            }, 'Failed to process Slack event');
          }
        });

        return;
      }

      return reply.status(400).send({
        error: 'INVALID_EVENT_TYPE',
        message: 'Unsupported event type'
      });
    }
  );

  /**
   * Slack Slash Commands endpoint
   */
  fastify.post<{ Body: SlackCommandPayload }>(
    '/slack/command',
    {
      preHandler: validateSlackSignature,
      schema: {
        body: {
          type: 'object',
          properties: {
            token: { type: 'string' },
            team_id: { type: 'string' },
            team_domain: { type: 'string' },
            channel_id: { type: 'string' },
            channel_name: { type: 'string' },
            user_id: { type: 'string' },
            user_name: { type: 'string' },
            command: { type: 'string' },
            text: { type: 'string' },
            response_url: { type: 'string' },
            trigger_id: { type: 'string' }
          },
          required: ['team_id', 'channel_id', 'user_id', 'command', 'response_url']
        }
      }
    },
    async (request, reply) => {
      const payload = request.body;
      
      request.log.info({
        command: payload.command,
        user: payload.user_id,
        channel: payload.channel_id,
        text: payload.text?.substring(0, 100)
      }, 'Slack command received');

      // Acknowledge immediately with appropriate message based on command
      const ackMessage = payload.command === '/ask'
        ? '🔍 Searching knowledge base...'
        : `Processing your ${payload.command} request...`;
      
      reply.send({
        text: ackMessage,
        response_type: 'ephemeral'
      });

      // Process command asynchronously with unified routing
      setImmediate(async () => {
        try {
          await processUnifiedSlackCommand(payload, request);
        } catch (error) {
          request.log.error({
            error: error instanceof Error ? error.message : 'Unknown error',
            user: payload.user_id,
            command: payload.command
          }, 'Failed to process unified Slack command');
        }
      });
    }
  );

  /**
   * Slack Interactive Components endpoint (button clicks, etc.)
   */
  fastify.post<{ Body: { payload: string } }>(
    '/slack/actions',
    {
      preHandler: validateSlackSignature,
      schema: {
        body: {
          type: 'object',
          properties: {
            payload: { type: 'string' }
          },
          required: ['payload']
        }
      }
    },
    async (request, reply) => {
      const startTime = Date.now();
      let actionFlowId: string | undefined;
      
      try {
        const payload: SlackActionPayload | SlackViewSubmissionPayload = JSON.parse(request.body.payload);
        
        // Generate unique flow ID for tracking this interaction
        actionFlowId = `${payload.user.id}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        request.log.info({
          actionFlowId,
          actionType: payload.type,
          user: payload.user.id,
          userName: payload.user.name,
          ...(payload.type === 'block_actions' && 'channel' in payload && {
            channel: payload.channel.id,
            channelName: payload.channel.name
          }),
          ...(payload.type === 'block_actions' && 'actions' in payload && {
            actions: payload.actions.map(a => ({
              action_id: a.action_id,
              type: a.type,
              value: a.value?.substring(0, 100) // Truncate long values
            }))
          }),
          ...(payload.type === 'view_submission' && payload.view && {
            viewCallbackId: payload.view.callback_id,
            viewType: payload.view.type,
            viewId: payload.view.id
          }),
          responseUrl: payload.type === 'block_actions' ? payload.response_url : undefined,
          triggerId: payload.trigger_id,
          payloadSize: JSON.stringify(payload).length
        }, '[INTERACTIVE-FLOW-START] Slack interaction received - starting processing');

        // Acknowledge immediately
        const ackResponse = { status: 'ok' };
        reply.send(ackResponse);
        
        request.log.info({
          actionFlowId,
          ackResponse,
          processingTimeMs: Date.now() - startTime
        }, '[INTERACTIVE-FLOW-ACK] Immediate acknowledgment sent to Slack');

        // Process interaction asynchronously
        setImmediate(async () => {
          const asyncStartTime = Date.now();
          
          try {
            request.log.info({
              actionFlowId,
              user: payload.user.id,
              actionType: payload.type
            }, '[INTERACTIVE-FLOW-ASYNC] Starting async processing of interaction');

            const { orchestrator, delivery } = await initializeSlackComponents(request);
            
            request.log.info({
              actionFlowId,
              orchestratorInitialized: !!orchestrator,
              deliveryInitialized: !!delivery,
              initTimeMs: Date.now() - asyncStartTime
            }, '[INTERACTIVE-FLOW-HANDLER] Unified Slack components initialized');
            
            // Process interaction through unified action processor
            const actionStartTime = Date.now();
            await processSlackAction(payload, orchestrator, delivery, request);
            const actionEndTime = Date.now();

            request.log.info({
              actionFlowId,
              processingTimeMs: actionEndTime - actionStartTime,
              totalFlowTimeMs: actionEndTime - startTime,
              status: 'completed_successfully'
            }, '[INTERACTIVE-FLOW-HANDLER-RESULT] Unified action processing completed');

            const totalAsyncTime = Date.now() - asyncStartTime;
            const totalFlowTime = Date.now() - startTime;
            
            request.log.info({
              actionFlowId,
              user: payload.user.id,
              actionType: payload.type,
              asyncProcessingTimeMs: totalAsyncTime,
              totalFlowTimeMs: totalFlowTime,
              status: 'completed'
            }, '[INTERACTIVE-FLOW-COMPLETE] Slack interaction processing completed successfully');

          } catch (error) {
            const errorTime = Date.now();
            const totalFlowTime = errorTime - startTime;
            
            request.log.error({
              actionFlowId,
              error: error instanceof Error ? {
                name: error.name,
                message: error.message,
                stack: error.stack?.substring(0, 500)
              } : 'Unknown error',
              user: payload.user.id,
              actionType: payload.type,
              totalFlowTimeMs: totalFlowTime,
              errorAtMs: errorTime - asyncStartTime
            }, '[INTERACTIVE-FLOW-ERROR] Failed to process Slack interaction');
          }
        });

      } catch (error) {
        const parseErrorTime = Date.now() - startTime;
        
        request.log.error({
          actionFlowId: actionFlowId || 'unknown',
          error: error instanceof Error ? {
            name: error.name,
            message: error.message,
            stack: error.stack?.substring(0, 500)
          } : 'Unknown error',
          payloadParseTimeMs: parseErrorTime,
          rawPayload: typeof request.body?.payload === 'string' ?
            request.body.payload.substring(0, 200) : 'not_string'
        }, '[INTERACTIVE-FLOW-PARSE-ERROR] Failed to parse Slack interaction payload');
        
        return reply.status(400).send({
          error: 'INVALID_PAYLOAD',
          message: 'Failed to parse interaction payload'
        });
      }
    }
  );

  /**
   * Slack health check endpoint
   */
  fastify.get('/slack/health', async (_request, reply) => {
    try {
      if (!config.SLACK_BOT_TOKEN || !config.SLACK_SIGNING_SECRET) {
        return reply.status(503).send({
          status: 'unhealthy',
          message: 'Slack integration not configured'
        });
      }

      if (orchestrator && slackDelivery) {
        const [orchestratorHealth, deliveryHealth] = await Promise.all([
          orchestrator.healthCheck(),
          slackDelivery.healthCheck()
        ]);

        const isHealthy = orchestratorHealth.status === 'healthy' && deliveryHealth.healthy;

        return reply.send({
          status: isHealthy ? 'healthy' : 'unhealthy',
          components: {
            orchestrator: orchestratorHealth.status === 'healthy',
            delivery: deliveryHealth.healthy,
            ragPipeline: orchestratorHealth.ragPipeline
          },
          details: {
            orchestrator: orchestratorHealth.details,
            delivery: deliveryHealth
          }
        });
      }

      return reply.send({
        status: 'ready',
        message: 'Slack handler not initialized yet'
      });

    } catch (error) {
      return reply.status(500).send({
        status: 'error',
        message: error instanceof Error ? error.message : 'Health check failed'
      });
    }
  });
}

export default slackRoute;