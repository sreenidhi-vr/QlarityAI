/**
 * Main Slack query handler that orchestrates RAG pipeline with Slack integration
 * Handles query processing, intent classification, and response formatting
 */

import { WebClient } from '@slack/web-api';
import type {
  SlackQueryContext,
  SlackRAGResponse,
  LLMAdapter,
  InteractiveButtonData,
  FollowupModalData,
  SlackViewSubmissionPayload
} from '@/types';
import { RAGError } from '@/types';
import { RAGPipeline } from '@/core/rag/ragPipeline';
import { SlackIntentClassifier } from './intentClassifier';
import { sourceCache, type CachedSource } from './sourceCache';
import {
  enhanceResponseWithButtons,
  generateResponseId,
  createSourcesModal,
  createFollowupModal
} from './messageBuilder';
import {
  validateWorkspace,
  checkSlackRateLimit,
  extractQueryFromSlackText,
  getCollectionHint
} from '@/utils/slackValidation';
import config from '@/utils/config';

export interface SlackQueryResult {
  success: boolean;
  response?: SlackRAGResponse;
  error?: string;
  rateLimited?: boolean;
  processingTimeMs?: number;
}

export class SlackQueryHandler {
  private slackClient: WebClient;
  private intentClassifier: SlackIntentClassifier;
  private ragPipeline: RAGPipeline;

  constructor(
    ragPipeline: RAGPipeline,
    llmAdapter: LLMAdapter,
    slackBotToken?: string
  ) {
    this.ragPipeline = ragPipeline;
    this.intentClassifier = new SlackIntentClassifier(llmAdapter);

    const token = slackBotToken || config.SLACK_BOT_TOKEN;
    if (!token) {
      throw new RAGError('SLACK_BOT_TOKEN is required', 'MISSING_SLACK_TOKEN');
    }

    this.slackClient = new WebClient(token);
  }

  /**
   * Process a Slack query through the complete pipeline
   */
  async processQuery(context: SlackQueryContext): Promise<SlackQueryResult> {
    const startTime = Date.now();
    const requestId = `${context.user_id}-${Date.now()}`;

    // DUPLICATE DIAGNOSIS: Log query start
    console.log('[DUPLICATE-DEBUG] processQuery started', {
      requestId,
      userId: context.user_id,
      channelId: context.channel_id,
      teamId: context.team_id,
      query: context.query.substring(0, 100),
      threadTs: context.thread_ts,
      responseUrl: !!context.response_url
    });

    try {
      // Validate workspace if configured
      if (!validateWorkspace(context.team_id)) {
        console.log('[DUPLICATE-DEBUG] Workspace validation failed', { requestId, teamId: context.team_id });
        return {
          success: false,
          error: 'Workspace not authorized',
          processingTimeMs: Date.now() - startTime
        };
      }

      // Check rate limiting
      const rateLimit = checkSlackRateLimit(context.user_id);
      if (!rateLimit.allowed) {
        console.log('[DUPLICATE-DEBUG] Rate limit exceeded', { requestId, userId: context.user_id });
        return {
          success: false,
          error: `Rate limit exceeded. Try again in ${Math.ceil((rateLimit.resetTime - Date.now()) / 1000)} seconds.`,
          rateLimited: true,
          processingTimeMs: Date.now() - startTime
        };
      }

      // Extract and clean query
      const cleanQuery = extractQueryFromSlackText(context.query);
      if (!cleanQuery || cleanQuery.length < 3) {
        return {
          success: false,
          error: 'Query too short or empty',
          processingTimeMs: Date.now() - startTime
        };
      }

      // Get collection hint from channel/query
      const { collection: collectionHint, cleanQuery: finalQuery } = getCollectionHint(
        context.channel_hint || '',
        cleanQuery
      );

      // Step 1: Classify intent
      console.debug('[Slack Handler] Classifying intent...', {
        query: finalQuery.substring(0, 100),
        userId: context.user_id
      });

      const intentResult = await this.intentClassifier.classifyIntent(finalQuery);

      // Step 2: Classify collection if no hint provided
      let selectedCollection = collectionHint;
      if (!selectedCollection) {
        console.debug('[Slack Handler] Classifying collection...');
        const collectionResult = await this.intentClassifier.classifyCollection(
          finalQuery,
          context.channel_hint
        );
        selectedCollection = collectionResult.collection;
      }

      // Step 3: Run RAG pipeline with collection filter
      console.debug('[Slack Handler] Running RAG pipeline...', {
        collection: selectedCollection,
        intent: intentResult.intent,
        confidence: intentResult.confidence
      });

      const ragOptions = {
        prefer_steps: intentResult.intent === 'instructions',
        max_tokens: 1500,
        top_k: 8,
        context_window_tokens: 3000,
        ...(selectedCollection && selectedCollection !== 'both' && {
          collections: [selectedCollection === 'pssis' ? 'pssis-admin' : 'schoology']
        })
      };

      const ragResponse = await this.ragPipeline.process(finalQuery, ragOptions);

      // Step 4: Format response for Slack
      console.debug('[Slack Handler] Formatting Slack response...');
      const slackResponse = await this.intentClassifier.formatSlackResponse(
        finalQuery,
        ragResponse,
        intentResult
      );

      // Step 5: Add metadata and enhance blocks
      const enhancedResponse = this.enhanceSlackResponse(
        slackResponse,
        context,
        intentResult,
        selectedCollection
      );

      const processingTime = Date.now() - startTime;

      console.debug('[Slack Handler] Query processed successfully', {
        userId: context.user_id,
        channelId: context.channel_id,
        processingTimeMs: processingTime,
        intent: intentResult.intent,
        collection: selectedCollection,
        confidence: slackResponse.confidence,
        sourcesCount: slackResponse.sources?.length || 0
      });

      return {
        success: true,
        response: enhancedResponse,
        processingTimeMs: processingTime
      };

    } catch (error) {
      const processingTime = Date.now() - startTime;

      console.error('[Slack Handler] Query processing failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        userId: context.user_id,
        channelId: context.channel_id,
        processingTimeMs: processingTime
      });

      // Return user-friendly error response
      const errorResponse = this.createErrorResponse(error, context);

      return {
        success: false,
        error: errorResponse.text,
        response: errorResponse,
        processingTimeMs: processingTime
      };
    }
  }

  /**
   * Send response back to Slack with interactive buttons and source caching
   */
  async sendSlackResponse(
    response: SlackRAGResponse,
    context: SlackQueryContext
  ): Promise<void> {
    const responseId = generateResponseId(context.user_id, context.channel_id);
    
    // DUPLICATE DIAGNOSIS: Log response sending attempt
    console.log('[DUPLICATE-DEBUG] sendSlackResponse called', {
      responseId,
      userId: context.user_id,
      channelId: context.channel_id,
      responseText: response.text.substring(0, 100),
      hasResponseUrl: !!context.response_url,
      threadTs: context.thread_ts,
      blocksCount: response.blocks?.length || 0
    });

    try {
      // Cache sources for interactive features
      const cachedSources: CachedSource[] = (response.sources || []).map(source => ({
        id: source.id,
        url: source.url,
        title: source.title,
        snippet: source.snippet,
        retrieval_score: source.retrieval_score
      }));

      sourceCache.store(responseId, {
        originalText: response.text,
        sources: cachedSources,
        userId: context.user_id,
        channelId: context.channel_id,
        ...(context.thread_ts && { threadTs: context.thread_ts })
      });

      // Enhance response with interactive buttons
      const enhancedResponse = enhanceResponseWithButtons(response, responseId);

      const message = {
        channel: context.channel_id,
        text: enhancedResponse.text,
        blocks: enhancedResponse.blocks,
        ...(context.thread_ts && { thread_ts: context.thread_ts })
      };

      if (context.response_url) {
        // Use response_url for slash commands (webhook)
        console.log('[DUPLICATE-DEBUG] Sending via response_url', { responseId, responseUrl: context.response_url });
        await fetch(context.response_url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(message)
        });
        console.log('[DUPLICATE-DEBUG] Response_url delivery successful', { responseId });
      } else {
        // Use Web API for events
        console.log('[DUPLICATE-DEBUG] Sending via Web API', { responseId, channel: context.channel_id });
        const result = await this.slackClient.chat.postMessage(message);
        console.log('[DUPLICATE-DEBUG] Web API delivery successful', {
          responseId,
          messageTs: result.ts,
          channel: result.channel
        });
      }

    } catch (error) {
      console.error('[DUPLICATE-DEBUG] Failed to send Slack response', {
        responseId,
        error: error instanceof Error ? error.message : 'Unknown error',
        channelId: context.channel_id,
        userId: context.user_id
      });
      throw new RAGError(
        'Failed to send Slack response',
        'SLACK_SEND_FAILED',
        { originalError: error }
      );
    }
  }

  /**
   * Handle interactive Slack actions (button clicks and modals)
   */
  async handleSlackAction(
    actionId: string,
    value: string,
    context: SlackQueryContext,
    triggerId?: string
  ): Promise<void> {
    const actionStartTime = Date.now();
    const actionTrackingId = `${context.user_id}_${actionId}_${Date.now()}`;
    
    try {
      console.log('[SLACK-ACTION-START] Processing action', {
        actionTrackingId,
        actionId,
        value: value?.substring(0, 100),
        userId: context.user_id,
        channelId: context.channel_id,
        triggerId,
        contextDetails: {
          team_id: context.team_id,
          query: context.query?.substring(0, 50),
          response_url: context.response_url ? 'present' : 'absent',
          thread_ts: context.thread_ts
        }
      });

      let actionResult: any = null;
      let actionError: any = null;

      switch (actionId) {
        case 'show_sources':
          console.log('[SLACK-ACTION-SOURCES] Handling show sources', {
            actionTrackingId,
            value: value?.substring(0, 200),
            triggerId
          });
          actionResult = await this.handleShowSources(value, triggerId!);
          break;
          
        case 'ask_followup':
          console.log('[SLACK-ACTION-FOLLOWUP] Handling ask followup', {
            actionTrackingId,
            value: value?.substring(0, 200),
            triggerId
          });
          actionResult = await this.handleAskFollowup(value, triggerId!);
          break;
          
        default:
          console.error('[SLACK-ACTION-UNKNOWN] Unknown action ID', {
            actionTrackingId,
            actionId,
            supportedActions: ['show_sources', 'ask_followup']
          });
          throw new RAGError(`Unknown action: ${actionId}`, 'UNKNOWN_SLACK_ACTION');
      }

      const processingTime = Date.now() - actionStartTime;
      console.log('[SLACK-ACTION-SUCCESS] Action completed successfully', {
        actionTrackingId,
        actionId,
        userId: context.user_id,
        processingTimeMs: processingTime,
        result: actionResult ? 'present' : 'void',
        triggerId
      });

    } catch (error) {
      const processingTime = Date.now() - actionStartTime;
      console.error('[SLACK-ACTION-ERROR] Failed to handle action', {
        actionTrackingId,
        actionId,
        error: error instanceof Error ? {
          name: error.name,
          message: error.message,
          stack: error.stack?.substring(0, 300)
        } : 'Unknown error',
        userId: context.user_id,
        processingTimeMs: processingTime,
        triggerId
      });
      
      // Send ephemeral error message
      try {
        await this.sendEphemeralError(
          context,
          'Sorry, something went wrong. Please try again in a moment.'
        );
        console.log('[SLACK-ACTION-ERROR-RECOVERY] Sent ephemeral error message', {
          actionTrackingId,
          userId: context.user_id
        });
      } catch (ephemeralError) {
        console.error('[SLACK-ACTION-ERROR-RECOVERY-FAILED] Failed to send ephemeral error', {
          actionTrackingId,
          ephemeralError: ephemeralError instanceof Error ? ephemeralError.message : 'Unknown error'
        });
      }
    }
  }

  /**
   * Handle follow-up modal submission
   */
  async handleFollowupSubmission(payload: SlackViewSubmissionPayload): Promise<void> {
    const submissionStartTime = Date.now();
    const submissionTrackingId = `${payload.user.id}_followup_${Date.now()}`;
    
    try {
      const followupQuestion = payload.view.state?.values?.followup_input?.followup_question?.value;
      const metadata = JSON.parse(payload.view.private_metadata || '{}');
      
      console.log('[SLACK-FOLLOWUP-START] Processing followup submission', {
        submissionTrackingId,
        userId: payload.user.id,
        userName: payload.user.name,
        viewId: payload.view.id,
        viewType: payload.view.type,
        callbackId: payload.view.callback_id,
        hasQuestion: !!followupQuestion,
        questionLength: followupQuestion?.length || 0,
        hasMetadata: !!metadata,
        metadataKeys: Object.keys(metadata || {}),
        teamId: payload.team.id
      });
      
      if (!followupQuestion || !metadata.originalResponseId) {
        console.error('[SLACK-FOLLOWUP-VALIDATION] Invalid followup submission data', {
          submissionTrackingId,
          hasQuestion: !!followupQuestion,
          hasOriginalResponseId: !!metadata.originalResponseId,
          metadata
        });
        throw new RAGError('Invalid followup submission data', 'INVALID_FOLLOWUP_DATA');
      }

      console.log('[SLACK-FOLLOWUP-VALIDATE] Followup question validated', {
        submissionTrackingId,
        userId: payload.user.id,
        question: followupQuestion.substring(0, 100),
        originalResponseId: metadata.originalResponseId,
        questionLength: followupQuestion.length
      });

      // Get cached response data
      const cacheStartTime = Date.now();
      const cachedResponse = sourceCache.get(metadata.originalResponseId);
      const cacheTime = Date.now() - cacheStartTime;
      
      if (!cachedResponse) {
        console.error('[SLACK-FOLLOWUP-CACHE-MISS] Original response not found or expired', {
          submissionTrackingId,
          originalResponseId: metadata.originalResponseId,
          cacheTimeMs: cacheTime
        });
        throw new RAGError('Original response not found or expired', 'RESPONSE_EXPIRED');
      }

      console.log('[SLACK-FOLLOWUP-CACHE-HIT] Retrieved cached original response', {
        submissionTrackingId,
        originalResponseId: metadata.originalResponseId,
        cacheTimeMs: cacheTime,
        cachedData: {
          userId: cachedResponse.userId,
          channelId: cachedResponse.channelId,
          sourcesCount: cachedResponse.sources?.length || 0,
          hasThreadTs: !!cachedResponse.threadTs,
          originalTextLength: cachedResponse.originalText?.length || 0
        }
      });

      // Construct enhanced context for followup
      const contextStartTime = Date.now();
      const contextualQuery = this.buildFollowupContext(
        followupQuestion,
        metadata.originalText,
        metadata.originalSources || []
      );
      const contextTime = Date.now() - contextStartTime;

      console.log('[SLACK-FOLLOWUP-CONTEXT] Built contextual query', {
        submissionTrackingId,
        originalQuestion: followupQuestion.substring(0, 100),
        contextualQueryLength: contextualQuery.length,
        contextBuildTimeMs: contextTime,
        originalSourcesCount: (metadata.originalSources || []).length
      });

      // Create followup context
      const followupContext: SlackQueryContext = {
        user_id: payload.user.id,
        channel_id: cachedResponse.channelId,
        team_id: payload.team.id,
        query: contextualQuery,
        ...(cachedResponse.threadTs && { thread_ts: cachedResponse.threadTs })
      };

      console.log('[SLACK-FOLLOWUP-RAG-START] Starting RAG processing for followup', {
        submissionTrackingId,
        context: {
          user_id: followupContext.user_id,
          channel_id: followupContext.channel_id,
          team_id: followupContext.team_id,
          thread_ts: followupContext.thread_ts,
          queryLength: followupContext.query.length
        }
      });

      // Process followup query through RAG pipeline
      const ragStartTime = Date.now();
      const result = await this.processQuery(followupContext);
      const ragTime = Date.now() - ragStartTime;
      
      console.log('[SLACK-FOLLOWUP-RAG-RESULT] RAG processing completed', {
        submissionTrackingId,
        ragProcessingTimeMs: ragTime,
        result: {
          success: result.success,
          hasResponse: !!result.response,
          error: result.error,
          processingTimeMs: result.processingTimeMs
        }
      });
      
      if (result.success && result.response) {
        console.log('[SLACK-FOLLOWUP-SEND-START] Sending followup response', {
          submissionTrackingId,
          responseText: result.response.text.substring(0, 100),
          blocksCount: result.response.blocks?.length || 0,
          channelId: followupContext.channel_id,
          threadTs: followupContext.thread_ts
        });

        // Send as threaded message
        const sendStartTime = Date.now();
        await this.sendSlackResponse(result.response, followupContext);
        const sendTime = Date.now() - sendStartTime;

        const totalTime = Date.now() - submissionStartTime;
        console.log('[SLACK-FOLLOWUP-SUCCESS] Followup submission completed successfully', {
          submissionTrackingId,
          userId: payload.user.id,
          sendTimeMs: sendTime,
          totalProcessingTimeMs: totalTime,
          ragTimeMs: ragTime,
          contextBuildTimeMs: contextTime,
          cacheTimeMs: cacheTime
        });
      } else {
        console.error('[SLACK-FOLLOWUP-RAG-FAILED] RAG processing failed', {
          submissionTrackingId,
          error: result.error,
          ragTimeMs: ragTime
        });
        throw new RAGError(result.error || 'Failed to process followup', 'FOLLOWUP_PROCESSING_FAILED');
      }

    } catch (error) {
      const totalTime = Date.now() - submissionStartTime;
      console.error('[SLACK-FOLLOWUP-ERROR] Failed to process submission', {
        submissionTrackingId,
        error: error instanceof Error ? {
          name: error.name,
          message: error.message,
          stack: error.stack?.substring(0, 300)
        } : 'Unknown error',
        userId: payload.user.id,
        totalProcessingTimeMs: totalTime
      });
      
      // Send error response in thread
      const errorContext: SlackQueryContext = {
        user_id: payload.user.id,
        channel_id: payload.view.team_id, // Fallback
        team_id: payload.team.id,
        query: ''
      };
      
      try {
        await this.sendEphemeralError(
          errorContext,
          'Sorry, I couldn\'t process your follow-up question. Please try asking again.'
        );
        console.log('[SLACK-FOLLOWUP-ERROR-RECOVERY] Sent ephemeral error message', {
          submissionTrackingId,
          userId: payload.user.id
        });
      } catch (ephemeralError) {
        console.error('[SLACK-FOLLOWUP-ERROR-RECOVERY-FAILED] Failed to send ephemeral error', {
          submissionTrackingId,
          ephemeralError: ephemeralError instanceof Error ? ephemeralError.message : 'Unknown error'
        });
      }
    }
  }

  /**
   * Handle show sources action - opens modal with sources
   */
  private async handleShowSources(value: string, triggerId: string): Promise<void> {
    try {
      const buttonData: InteractiveButtonData = JSON.parse(value);
      const cachedResponse = sourceCache.get(buttonData.responseId);
      
      if (!cachedResponse) {
        throw new RAGError('Response sources not found or expired', 'SOURCES_NOT_FOUND');
      }

      const sourcesForModal = cachedResponse.sources.map(source => ({
        id: source.id,
        title: source.title,
        url: source.url,
        snippet: source.snippet,
        score: source.retrieval_score
      }));

      const sourcesModal = createSourcesModal(sourcesForModal);
      
      await this.slackClient.views.open({
        trigger_id: triggerId,
        view: sourcesModal
      });

    } catch (error) {
      console.error('[Slack Action] Failed to show sources', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Handle ask followup action - opens modal for followup question
   */
  private async handleAskFollowup(value: string, triggerId: string): Promise<void> {
    try {
      const buttonData: InteractiveButtonData = JSON.parse(value);
      const cachedResponse = sourceCache.get(buttonData.responseId);
      
      if (!cachedResponse) {
        throw new RAGError('Original response not found or expired', 'RESPONSE_NOT_FOUND');
      }

      const sourcesForModal = cachedResponse.sources.map(source => ({
        id: source.id,
        title: source.title,
        url: source.url,
        snippet: source.snippet,
        score: source.retrieval_score
      }));

      const followupModalData: FollowupModalData = {
        originalResponseId: buttonData.responseId,
        originalText: cachedResponse.originalText,
        originalSources: sourcesForModal
      };

      const followupModal = createFollowupModal(followupModalData);
      
      await this.slackClient.views.open({
        trigger_id: triggerId,
        view: followupModal
      });

    } catch (error) {
      console.error('[Slack Action] Failed to show followup modal', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Send ephemeral error message to user
   */
  private async sendEphemeralError(context: SlackQueryContext, message: string): Promise<void> {
    try {
      await this.slackClient.chat.postEphemeral({
        channel: context.channel_id,
        user: context.user_id,
        text: message,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `❌ ${message}`
            }
          }
        ]
      });
    } catch (error) {
      console.error('[Slack Error] Failed to send ephemeral error', {
        error: error instanceof Error ? error.message : 'Unknown error',
        userId: context.user_id,
        channelId: context.channel_id
      });
    }
  }

  /**
   * Build contextual query for followup questions
   */
  private buildFollowupContext(
    followupQuestion: string,
    originalText: string,
    originalSources: CachedSource[]
  ): string {
    const sourceContext = originalSources.length > 0
      ? `\n\nRelevant sources from previous answer:\n${originalSources.slice(0, 3).map(s => `- ${s.title}: ${s.snippet.substring(0, 100)}...`).join('\n')}`
      : '';

    return `Follow-up question about: "${originalText.substring(0, 200)}..."${sourceContext}\n\nUser's follow-up question: ${followupQuestion}`;
  }

  /**
   * Enhance Slack response with metadata and context
   */
  private enhanceSlackResponse(
    response: SlackRAGResponse,
    _context: SlackQueryContext,
    _intent: any,
    collection?: string
  ): SlackRAGResponse {
    const enhanced = { ...response };

    // Add confidence indicator if low
    if (response.confidence < 0.7) {
      const warningText = `⚠️ *Low confidence answer* (${Math.round(response.confidence * 100)}%) - I may be missing some details.\n\n`;
      enhanced.blocks = [
        {
          type: 'context',
          elements: [{
            type: 'mrkdwn',
            text: warningText
          }]
        },
        ...enhanced.blocks
      ];
    }

    // Add collection source indicator
    if (collection && collection !== 'both') {
      const sourceText = collection === 'pssis' 
        ? '📊 *Source:* PowerSchool PSSIS-Admin Documentation'
        : '📚 *Source:* Schoology LMS Documentation';
      
      enhanced.blocks.push({
        type: 'context',
        elements: [{
          type: 'mrkdwn',
          text: sourceText
        }]
      });
    }

    return enhanced;
  }


  /**
   * Create error response for Slack
   */
  private createErrorResponse(error: unknown, context: SlackQueryContext): SlackRAGResponse {
    let errorMessage = 'An unexpected error occurred';
    let userMessage = 'Sorry, I encountered an error while processing your request. Please try again.';

    if (error instanceof RAGError) {
      errorMessage = error.message;
      
      switch (error.code) {
        case 'EMPTY_RETRIEVAL_RESULTS':
          userMessage = 'I couldn\'t find any relevant information for your query. Try rephrasing your question or being more specific.';
          break;
        case 'LLM_GENERATION_FAILED':
          userMessage = 'I\'m having trouble generating a response right now. Please try again in a moment.';
          break;
        case 'PIPELINE_FAILED':
          userMessage = 'There was an issue processing your request. Please try again or contact support if the problem persists.';
          break;
        default:
          userMessage = 'Something went wrong while processing your query. Please try again.';
      }
    } else if (error instanceof Error) {
      errorMessage = error.message;
    }

    console.error('[Slack Handler] Error response created', {
      errorMessage,
      userId: context.user_id,
      channelId: context.channel_id
    });

    return {
      text: userMessage,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `❌ ${userMessage}`
          }
        },
        {
          type: 'context',
          elements: [{
            type: 'mrkdwn',
            text: '💡 Try being more specific or check out our <https://support.powerschool.com/|support documentation>'
          }]
        }
      ],
      confidence: 0,
      intent: 'other'
    };
  }

  /**
   * Health check for Slack integration
   */
  async healthCheck(): Promise<{
    slack: boolean;
    ragPipeline: boolean;
    details: Record<string, any>;
  }> {
    try {
      // Test Slack API connection
      const slackTest = await this.slackClient.auth.test();
      const slackHealthy = Boolean(slackTest.ok);

      // Test RAG pipeline
      const ragTest = await this.ragPipeline.healthCheck();
      const ragHealthy = ragTest.status === 'healthy';

      return {
        slack: slackHealthy,
        ragPipeline: ragHealthy,
        details: {
          slackBotId: slackTest.user_id,
          slackTeam: slackTest.team,
          ragComponents: ragTest.components
        }
      };
    } catch (error) {
      return {
        slack: false,
        ragPipeline: false,
        details: {
          error: error instanceof Error ? error.message : 'Unknown error'
        }
      };
    }
  }
}