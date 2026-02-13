/**
 * Microsoft Teams API routes for Bot Framework activities
 * Handles Teams webhook endpoints with proper validation and async processing
 */

import type { FastifyInstance, FastifyPluginOptions, FastifyRequest } from 'fastify';
import type { TeamsActivity } from '@/adapters/platform/teamsAdapter';
import type { PlatformQueryContext, OrchestratorResult } from '@/core/orchestrator/unifiedOrchestrator';
import { RAGError } from '@/types';
import config from '@/utils/config';
import { UnifiedOrchestrator } from '@/core/orchestrator/unifiedOrchestrator';
import { RAGPipeline } from '@/core/rag/ragPipeline';
import { createLLMAdapter } from '@/adapters/llm';
import { createEmbeddingAdapter } from '@/adapters/embedding';
import { PostgresVectorAdapter } from '@/adapters/vector-store/postgres';
import { TeamsDelivery } from '@/services/delivery/teamsDelivery';
import { 
  toPlatformContext,
  formatResponseForTeams,
  createTeamsErrorResponse,
  validateTeamsActivity,
  extractTeamsActionData,
  extractTeamsFollowupData,
  createSourcesAdaptiveCard,
  createFollowupAdaptiveCard
} from '@/adapters/platform/teamsAdapter';
import { 
  validateTeamsRequest,
  checkTeamsRateLimit,
  isTeamsActivitySupported,
  cleanTeamsText
} from '@/utils/validation/teamsValidation';
import { metrics, MetricNames, startTimer } from '@/utils/metrics';

// Global instances
let orchestrator: UnifiedOrchestrator | null = null;
let teamsDelivery: TeamsDelivery | null = null;

// Teams activity processing queue and deduplication
const processingActivities = new Map<string, Promise<void>>();
const processedActivities = new Map<string, number>();
const DEDUP_WINDOW_MS = 5000; // 5 seconds
const PROCESSING_TIMEOUT_MS = 30000; // 30 seconds

// Clean up old entries periodically
setInterval(() => {
  const now = Date.now();
  
  // Clean up processed activities
  for (const [key, timestamp] of processedActivities.entries()) {
    if (now - timestamp > DEDUP_WINDOW_MS) {
      processedActivities.delete(key);
    }
  }
  
  // Clean up stale processing activities
  for (const key of processingActivities.keys()) {
    const [, , timestamp] = key.split('|');
    if (timestamp && now - parseInt(timestamp) > PROCESSING_TIMEOUT_MS) {
      console.warn('[Teams] Removing stale processing activity', { key });
      processingActivities.delete(key);
    }
  }
}, 30000);

/**
 * Check if activity should be processed (deduplication)
 */
function shouldProcessActivity(activity: TeamsActivity): {
  shouldProcess: boolean;
  reason?: string;
  existingPromise?: Promise<void>;
} {
  const now = Date.now();
  const contentKey = `${activity.from.id}|${cleanTeamsText(activity.text || '').substring(0, 100)}`;
  
  // Check if identical activity is currently being processed
  for (const [processingKey, promise] of processingActivities.entries()) {
    const processingContentKey = processingKey.split('|').slice(0, 2).join('|');
    if (processingContentKey === contentKey) {
      console.warn('[Teams] Activity already processing', {
        activityId: activity.id,
        fromId: activity.from.id,
        existingKey: processingKey
      });
      return {
        shouldProcess: false,
        reason: 'already_processing',
        existingPromise: promise
      };
    }
  }
  
  // Check if same activity was recently processed
  if (processedActivities.has(contentKey)) {
    const timestamp = processedActivities.get(contentKey)!;
    if (now - timestamp < DEDUP_WINDOW_MS) {
      console.warn('[Teams] Activity recently processed', {
        activityId: activity.id,
        fromId: activity.from.id,
        timeSinceLastMs: now - timestamp
      });
      return { shouldProcess: false, reason: 'recently_processed' };
    }
  }
  
  return { shouldProcess: true };
}

/**
 * Mark activity as processing
 */
function markActivityAsProcessing(activity: TeamsActivity, promise: Promise<void>): string {
  const now = Date.now();
  const contentKey = `${activity.from.id}|${cleanTeamsText(activity.text || '').substring(0, 100)}`;
  const uniqueKey = `${contentKey}|${activity.id}|${now}`;
  processingActivities.set(uniqueKey, promise);
  return uniqueKey;
}

/**
 * Mark activity as completed
 */
function markActivityAsCompleted(processingKey: string, activity: TeamsActivity): void {
  const now = Date.now();
  const contentKey = `${activity.from.id}|${cleanTeamsText(activity.text || '').substring(0, 100)}`;
  
  // Remove from processing
  processingActivities.delete(processingKey);
  
  // Mark as recently processed
  processedActivities.set(contentKey, now);
  
  console.log('[Teams] Activity completed', {
    activityId: activity.id,
    fromId: activity.from.id,
    contentKey
  });
}

/**
 * Initialize Teams components on first request
 */
async function initializeTeamsComponents(request: FastifyRequest): Promise<{
  orchestrator: UnifiedOrchestrator;
  delivery: TeamsDelivery;
}> {
  if (!orchestrator || !teamsDelivery) {
    request.log.info('Initializing Teams components...');
    
    // Check if Teams is configured
    if (!config.TEAMS_APP_ID || !config.TEAMS_APP_PASSWORD) {
      throw new RAGError(
        'Teams integration not configured - missing TEAMS_APP_ID or TEAMS_APP_PASSWORD',
        'TEAMS_NOT_CONFIGURED'
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
          'Vector database is not available for Teams integration',
          'VECTOR_DB_UNHEALTHY'
        );
      }

      const ragPipeline = new RAGPipeline(embeddingAdapter, vectorStore, llmAdapter);
      orchestrator = new UnifiedOrchestrator(ragPipeline, metrics);
      teamsDelivery = new TeamsDelivery(config.TEAMS_APP_ID, config.TEAMS_APP_PASSWORD);
      
      request.log.info('Teams components initialized successfully');
    } catch (error) {
      request.log.error({
        error: error instanceof Error ? error.message : 'Unknown error'
      }, 'Failed to initialize Teams components');
      throw error;
    }
  }
  
  return {
    orchestrator: orchestrator!,
    delivery: teamsDelivery!
  };
}

/**
 * Process Teams message activity through unified orchestrator
 */
async function processTeamsMessage(
  activity: TeamsActivity,
  orchestrator: UnifiedOrchestrator,
  delivery: TeamsDelivery,
  request: FastifyRequest
): Promise<void> {
  const timer = startTimer();
  
  try {
    // Convert to platform context
    const platformContext: PlatformQueryContext = toPlatformContext(activity);
    
    request.log.info({
      activityId: activity.id,
      fromId: activity.from.id,
      conversationId: activity.conversation.id,
      query: platformContext.query.substring(0, 100),
      conversationType: activity.conversation.conversationType
    }, '[Teams] Processing message activity');

    metrics.incrementCounter(MetricNames.TEAMS_ACTIVITIES_TOTAL, {
      type: 'message',
      conversationType: activity.conversation.conversationType || 'unknown'
    });

    // Send typing indicator
    await delivery.sendTypingIndicator(
      activity.serviceUrl,
      activity.conversation.id,
      activity.from
    );

    // Process through unified orchestrator
    const result: OrchestratorResult = await orchestrator.handlePlatformQuery(platformContext);

    // Format response for Teams
    const teamsResponse = formatResponseForTeams(result, {
      includeAdaptiveCard: true,
      includeActions: true
    });

    request.log.info({
      activityId: activity.id,
      success: true,
      confidence: result.confidence,
      intent: result.intent,
      sourcesCount: result.sources.length,
      processingTimeMs: result.metadata.processingTimeMs
    }, '[Teams] Orchestrator processing completed');

    // Send response
    const deliveryOptions: any = {
      text: teamsResponse.text
    };
    
    if (teamsResponse.adaptiveCard) {
      deliveryOptions.adaptiveCard = teamsResponse.adaptiveCard;
    }
    
    if (teamsResponse.attachments) {
      deliveryOptions.attachments = teamsResponse.attachments;
    }
    
    const deliveryResult = await delivery.replyToActivity(activity, deliveryOptions);

    const totalTime = timer();
    
    if (deliveryResult.success) {
      metrics.incrementCounter(MetricNames.TEAMS_DELIVERY_TOTAL, { status: 'success' });
      metrics.recordDuration(MetricNames.TEAMS_DELIVERY_DURATION_MS, deliveryResult.deliveryTimeMs);
      
      request.log.info({
        activityId: activity.id,
        responseActivityId: deliveryResult.activityId,
        totalTimeMs: totalTime,
        deliveryTimeMs: deliveryResult.deliveryTimeMs
      }, '[Teams] Response delivered successfully');
    } else {
      metrics.incrementCounter(MetricNames.TEAMS_DELIVERY_TOTAL, { status: 'error' });
      
      request.log.error({
        activityId: activity.id,
        error: deliveryResult.error,
        totalTimeMs: totalTime
      }, '[Teams] Response delivery failed');
    }

  } catch (error) {
    const totalTime = timer();
    
    request.log.error({
      activityId: activity.id,
      error: error instanceof Error ? error.message : 'Unknown error',
      totalTimeMs: totalTime
    }, '[Teams] Message processing failed');

    metrics.incrementCounter(MetricNames.TEAMS_DELIVERY_TOTAL, { status: 'error' });

    // Send error response
    try {
      const errorResponse = createTeamsErrorResponse(
        'Sorry, I encountered an error processing your message. Please try again.',
        true
      );
      
      const errorOptions: any = {
        text: errorResponse.text
      };
      
      if (errorResponse.adaptiveCard) {
        errorOptions.adaptiveCard = errorResponse.adaptiveCard;
      }
      
      if (errorResponse.attachments) {
        errorOptions.attachments = errorResponse.attachments;
      }
      
      await delivery.replyToActivity(activity, errorOptions);
    } catch (deliveryError) {
      request.log.error({
        activityId: activity.id,
        deliveryError: deliveryError instanceof Error ? deliveryError.message : 'Unknown error'
      }, '[Teams] Failed to send error response');
    }
  }
}

/**
 * Process Teams invoke activity (interactive actions)
 */
async function processTeamsInvoke(
  activity: TeamsActivity,
  orchestrator: UnifiedOrchestrator,
  delivery: TeamsDelivery,
  request: FastifyRequest
): Promise<any> {
  request.log.info({
    activityId: activity.id,
    fromId: activity.from.id,
    valueKeys: activity.value ? Object.keys(activity.value) : []
  }, '[Teams] Processing invoke activity');

  metrics.incrementCounter(MetricNames.TEAMS_ACTIVITIES_TOTAL, { type: 'invoke' });

  const actionData = extractTeamsActionData(activity);
  if (!actionData) {
    request.log.warn({
      activityId: activity.id
    }, '[Teams] No valid action data in invoke activity');
    return { status: 400 };
  }

  try {
    switch (actionData.action) {
      case 'show_sources':
        return await handleShowSources(actionData.data, delivery, activity, request);
        
      case 'ask_followup':
        return await handleAskFollowup(actionData.data, delivery, activity, request);
        
      case 'submit_followup':
        return await handleSubmitFollowup(activity, orchestrator, delivery, request);
        
      default:
        request.log.warn({
          action: actionData.action,
          activityId: activity.id
        }, '[Teams] Unknown invoke action');
        return { status: 400 };
    }
  } catch (error) {
    request.log.error({
      activityId: activity.id,
      action: actionData.action,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, '[Teams] Invoke processing failed');
    return { status: 500 };
  }
}

/**
 * Handle show sources invoke action
 */
async function handleShowSources(
  data: any,
  delivery: TeamsDelivery,
  activity: TeamsActivity,
  request: FastifyRequest
): Promise<any> {
  // In a real implementation, you'd retrieve the sources from cache using data.contextId
  // For now, validate the data and return a placeholder response
  request.log.info({
    contextId: data?.contextId,
    activityId: activity.id,
    fromId: activity.from.id
  }, '[Teams] Show sources requested');

  // Validate that we have the expected data structure
  if (!data || !data.contextId) {
    request.log.warn({
      activityId: activity.id,
      data: data
    }, '[Teams] Show sources called without valid contextId');
  }

  const sourcesCard = createSourcesAdaptiveCard([
    {
      id: 'example',
      title: 'Example Source',
      url: 'https://support.powerschool.com/',
      snippet: 'This is an example source snippet...',
      retrieval_score: 0.95
    }
  ]);

  const result = await delivery.replyToActivity(activity, {
    text: 'Here are the sources used to generate that answer:',
    adaptiveCard: sourcesCard
  });

  return result.success ? { status: 200 } : { status: 500 };
}

/**
 * Handle ask followup invoke action
 */
async function handleAskFollowup(
  data: any,
  delivery: TeamsDelivery,
  activity: TeamsActivity,
  request: FastifyRequest
): Promise<any> {
  request.log.info({
    contextId: data?.contextId,
    activityId: activity.id,
    fromId: activity.from.id
  }, '[Teams] Ask followup requested');

  // Validate that we have the expected data structure
  if (!data || !data.contextId) {
    request.log.warn({
      activityId: activity.id,
      data: data
    }, '[Teams] Ask followup called without valid contextId');
  }

  // Create followup form
  const followupCard = createFollowupAdaptiveCard({
    text: 'Original answer text would be here...',
    summary: 'Original summary',
    sources: [],
    confidence: 0.8,
    intent: 'other',
    platformHints: {},
    metadata: {
      processingTimeMs: 1000,
      contextId: data.contextId || 'example',
      platform: 'teams',
      userId: activity.from.id,
      channelId: activity.conversation.id
    }
  } as any);

  const result = await delivery.replyToActivity(activity, {
    text: 'Ask a follow-up question:',
    adaptiveCard: followupCard
  });

  if (result.success) {
    request.log.info({
      activityId: activity.id,
      responseActivityId: result.activityId
    }, '[Teams] Followup form delivered successfully');
    return { status: 200 };
  } else {
    request.log.error({
      activityId: activity.id,
      error: result.error
    }, '[Teams] Followup form delivery failed');
    return { status: 500 };
  }
}

/**
 * Handle submit followup invoke action
 */
async function handleSubmitFollowup(
  activity: TeamsActivity,
  orchestrator: UnifiedOrchestrator,
  delivery: TeamsDelivery,
  request: FastifyRequest
): Promise<any> {
  request.log.info({
    activityId: activity.id,
    fromId: activity.from.id
  }, '[Teams] Submit followup requested');

  const followupData = extractTeamsFollowupData(activity);
  if (!followupData) {
    request.log.warn({
      activityId: activity.id
    }, '[Teams] No valid followup data in submit activity');
    return { status: 400 };
  }

  // Create followup context with parent context reference
  const followupContext: PlatformQueryContext = {
    platform: 'teams',
    userId: activity.from.id,
    channelId: activity.conversation.id,
    query: followupData.followupQuestion,
    metadata: {
      parentContextId: followupData.metadata.originalResponseId,
      originalText: followupData.metadata.originalText
    }
  };

  // Process followup through orchestrator
  const result = await orchestrator.handlePlatformQuery(followupContext);
  
  // Format and send response
  const teamsResponse = formatResponseForTeams(result, {
    includeAdaptiveCard: true,
    includeActions: true
  });

  const deliveryOptions: any = {
    text: teamsResponse.text
  };
  
  if (teamsResponse.adaptiveCard) {
    deliveryOptions.adaptiveCard = teamsResponse.adaptiveCard;
  }
  
  if (teamsResponse.attachments) {
    deliveryOptions.attachments = teamsResponse.attachments;
  }
  
  const deliveryResult = await delivery.replyToActivity(activity, deliveryOptions);

  if (deliveryResult.success) {
    request.log.info({
      activityId: activity.id,
      responseActivityId: deliveryResult.activityId,
      query: followupData.followupQuestion.substring(0, 100),
      confidence: result.confidence,
      intent: result.intent
    }, '[Teams] Followup response delivered successfully');
    return { status: 200 };
  } else {
    request.log.error({
      activityId: activity.id,
      error: deliveryResult.error
    }, '[Teams] Followup response delivery failed');
    return { status: 500 };
  }
}

async function teamsRoute(
  fastify: FastifyInstance,
  _opts: FastifyPluginOptions
): Promise<void> {
  
  /**
   * Microsoft Teams Bot Framework endpoint
   * Handles all Teams activities (messages, invokes, etc.)
   */
  fastify.post<{ Body: TeamsActivity }>(
    '/teams/messages',
    {
      schema: {
        body: {
          type: 'object',
          properties: {
            type: { type: 'string' },
            id: { type: 'string' },
            timestamp: { type: 'string' },
            serviceUrl: { type: 'string' },
            channelId: { type: 'string' },
            from: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                name: { type: 'string' }
              },
              required: ['id', 'name']
            },
            conversation: {
              type: 'object',
              properties: {
                id: { type: 'string' }
              },
              required: ['id']
            }
          },
          required: ['type', 'id', 'from', 'conversation']
        },
        response: {
          200: {
            type: 'object',
            properties: {
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
      const activity = request.body;
      const authHeader = request.headers.authorization || '';

      request.log.info({
        type: activity.type,
        id: activity.id,
        fromId: activity.from.id,
        conversationId: activity.conversation.id,
        hasText: !!activity.text,
        hasValue: !!activity.value
      }, '[Teams] Activity received');

      // Validate request
      const validation = validateTeamsRequest(authHeader, activity);
      if (!validation.isValid) {
        request.log.error({
          error: validation.error,
          activityId: activity.id
        }, '[Teams] Request validation failed');

        metrics.incrementCounter(MetricNames.VALIDATION_FAILURES_TOTAL, {
          platform: 'teams',
          reason: validation.error || 'unknown'
        });

        return reply.status(401).send({
          error: 'INVALID_REQUEST',
          message: validation.error || 'Request validation failed'
        });
      }

      // Validate activity structure
      const activityValidation = validateTeamsActivity(activity);
      if (!activityValidation.isValid) {
        request.log.error({
          error: activityValidation.error,
          activityId: activity.id
        }, '[Teams] Activity validation failed');

        return reply.status(400).send({
          error: 'INVALID_ACTIVITY',
          message: activityValidation.error || 'Invalid activity structure'
        });
      }

      // Check if activity is supported
      if (!isTeamsActivitySupported(activity)) {
        request.log.info({
          type: activity.type,
          id: activity.id,
          fromId: activity.from.id
        }, '[Teams] Activity not supported');

        return reply.send({ status: 'ok' });
      }

      // Check rate limiting
      const rateLimit = checkTeamsRateLimit(activity.from.id);
      if (!rateLimit.allowed) {
        request.log.warn({
          userId: activity.from.id,
          remaining: rateLimit.remaining,
          resetTime: rateLimit.resetTime
        }, '[Teams] Rate limit exceeded');

        metrics.incrementCounter(MetricNames.RATE_LIMIT_HITS_TOTAL, {
          platform: 'teams'
        });

        return reply.status(429).send({
          error: 'RATE_LIMIT_EXCEEDED',
          message: `Rate limit exceeded. Try again in ${Math.ceil((rateLimit.resetTime - Date.now()) / 1000)} seconds.`
        });
      }

      // Handle invoke activities immediately (they expect synchronous responses)
      if (activity.type === 'invoke') {
        try {
          const { orchestrator, delivery } = await initializeTeamsComponents(request);
          const result = await processTeamsInvoke(activity, orchestrator, delivery, request);
          return reply.status(result.status || 200).send(result);
        } catch (error) {
          request.log.error({
            error: error instanceof Error ? error.message : 'Unknown error',
            activityId: activity.id
          }, '[Teams] Invoke processing failed');
          return reply.status(500).send({ error: 'PROCESSING_FAILED' });
        }
      }

      // Acknowledge message activities immediately
      reply.send({ status: 'ok' });

      // Process message activities asynchronously
      if (activity.type === 'message') {
        setImmediate(async () => {
          try {
            // Check for duplicates
            const duplicationCheck = shouldProcessActivity(activity);
            if (!duplicationCheck.shouldProcess) {
              request.log.warn({
                activityId: activity.id,
                reason: duplicationCheck.reason
              }, '[Teams] Activity duplicate detected');
              return;
            }

            // Initialize components
            const { orchestrator, delivery } = await initializeTeamsComponents(request);

            // Mark as processing and create promise
            const processingPromise = processTeamsMessage(activity, orchestrator, delivery, request);
            const processingKey = markActivityAsProcessing(activity, processingPromise);

            try {
              await processingPromise;
              markActivityAsCompleted(processingKey, activity);
            } catch (processingError) {
              markActivityAsCompleted(processingKey, activity);
              throw processingError;
            }

          } catch (error) {
            request.log.error({
              error: error instanceof Error ? error.message : 'Unknown error',
              activityId: activity.id,
              fromId: activity.from.id
            }, '[Teams] Async processing failed');
          }
        });
      }
    }
  );

  /**
   * Teams health check endpoint
   */
  fastify.get('/teams/health', async (_request, reply) => {
    try {
      if (!config.TEAMS_APP_ID || !config.TEAMS_APP_PASSWORD) {
        return reply.status(503).send({
          status: 'unhealthy',
          message: 'Teams integration not configured'
        });
      }

      if (orchestrator && teamsDelivery) {
        const [orchestratorHealth, deliveryHealth] = await Promise.all([
          orchestrator.healthCheck(),
          teamsDelivery.healthCheck()
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
        message: 'Teams components not initialized yet'
      });

    } catch (error) {
      return reply.status(500).send({
        status: 'error',
        message: error instanceof Error ? error.message : 'Health check failed'
      });
    }
  });
}

export default teamsRoute;