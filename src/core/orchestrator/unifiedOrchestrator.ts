/**
 * Unified Orchestrator for Multi-Platform RAG Integration
 * Provides a single interface for both Slack and Teams to process queries
 * through the same RAG pipeline while maintaining platform-specific formatting
 */

import type {
  AskResponse,
  RetrievedDoc
} from '@/types';
import { RAGError } from '@/types';
import { RAGPipeline, type RAGPipelineOptions } from '@/core/rag/ragPipeline';

// Platform-agnostic query context
export interface PlatformQueryContext {
  platform: 'slack' | 'teams';
  userId: string;
  channelId: string;
  threadId?: string;
  query: string;
  metadata?: Record<string, any>;
}

// Platform-agnostic result
export interface OrchestratorResult {
  text: string;
  summary: string;
  sources: Array<{
    id: string;
    title: string;
    url: string;
    snippet: string;
    retrieval_score: number;
  }>;
  confidence: number;
  intent: 'details' | 'instructions' | 'other';
  platformHints: {
    preferSteps?: boolean;
    collection?: string;
    threadContext?: string;
  };
  metadata: {
    processingTimeMs: number;
    parentContextId?: string;
    contextId: string;
    platform: string;
    userId: string;
    channelId: string;
  };
}

// Metrics interface for tracking orchestrator usage
export interface OrchestratorMetrics {
  incrementCounter(metric: string, labels?: Record<string, string>): void;
  recordDuration(metric: string, duration: number, labels?: Record<string, string>): void;
}

// Default no-op metrics implementation
class NoOpMetrics implements OrchestratorMetrics {
  incrementCounter(): void {}
  recordDuration(): void {}
}

export class UnifiedOrchestrator {
  private ragPipeline: RAGPipeline;
  private metrics: OrchestratorMetrics;

  constructor(
    ragPipeline: RAGPipeline,
    metrics?: OrchestratorMetrics
  ) {
    this.ragPipeline = ragPipeline;
    this.metrics = metrics || new NoOpMetrics();
  }

  /**
   * Main entry point for platform queries
   * Processes queries through RAG pipeline and returns platform-agnostic results
   */
  async handlePlatformQuery(context: PlatformQueryContext): Promise<OrchestratorResult> {
    const startTime = Date.now();
    const contextId = this.generateContextId(context);
    
    console.log('[UnifiedOrchestrator] Processing platform query', {
      contextId,
      platform: context.platform,
      userId: context.userId,
      channelId: context.channelId,
      queryLength: context.query.length,
      hasMetadata: !!context.metadata,
      threadId: context.threadId
    });

    this.metrics.incrementCounter('orchestrator_calls_total', {
      platform: context.platform
    });

    try {
      // Step 1: Normalize and validate query
      const normalizedQuery = this.normalizeQuery(context.query);
      if (!normalizedQuery || normalizedQuery.length < 3) {
        throw new RAGError('Query too short or empty', 'INVALID_QUERY');
      }

      // Step 2: Extract platform hints and collection preferences
      const platformHints = this.extractPlatformHints(context);
      
      // Step 3: Prepare RAG options based on platform and context
      const ragOptions = this.buildRAGOptions(context, platformHints);

      console.log('[UnifiedOrchestrator] Prepared RAG options', {
        contextId,
        platform: context.platform,
        ragOptions: {
          topK: ragOptions.topK,
          contextWindowTokens: ragOptions.contextWindowTokens,
          collections: ragOptions.collections,
          similarityThreshold: ragOptions.similarityThreshold
        },
        platformHints
      });

      // Step 4: Process through RAG pipeline
      const ragStartTime = Date.now();
      const ragResponse = await this.ragPipeline.process(normalizedQuery, ragOptions);
      const ragDuration = Date.now() - ragStartTime;

      this.metrics.recordDuration('rag_processing_duration_ms', ragDuration, {
        platform: context.platform
      });

      console.log('[UnifiedOrchestrator] RAG processing completed', {
        contextId,
        platform: context.platform,
        ragDurationMs: ragDuration,
        citationsCount: ragResponse.citations.length,
        retrievedDocsCount: ragResponse.retrieved_docs.length,
        hasSteps: !!ragResponse.steps
      });

      // Step 5: Transform to unified result format
      const result = this.transformToOrchestratorResult(
        ragResponse,
        context,
        platformHints,
        contextId,
        Date.now() - startTime
      );

      console.log('[UnifiedOrchestrator] Query processed successfully', {
        contextId,
        platform: context.platform,
        userId: context.userId,
        totalProcessingTimeMs: result.metadata.processingTimeMs,
        confidence: result.confidence,
        intent: result.intent,
        sourcesCount: result.sources.length
      });

      this.metrics.incrementCounter('orchestrator_success_total', {
        platform: context.platform,
        intent: result.intent
      });

      return result;

    } catch (error) {
      const processingTime = Date.now() - startTime;
      
      console.error('[UnifiedOrchestrator] Query processing failed', {
        contextId,
        platform: context.platform,
        userId: context.userId,
        error: error instanceof Error ? error.message : 'Unknown error',
        processingTimeMs: processingTime
      });

      this.metrics.incrementCounter('orchestrator_error_total', {
        platform: context.platform,
        error_type: error instanceof RAGError ? error.code : 'unknown'
      });

      // Return error result in consistent format
      return this.createErrorResult(error, context, contextId, processingTime);
    }
  }

  /**
   * Generate unique context ID for tracking
   */
  private generateContextId(context: PlatformQueryContext): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 10);
    return `${context.platform}_${context.userId}_${timestamp}_${random}`;
  }

  /**
   * Normalize query text for processing
   */
  private normalizeQuery(query: string): string {
    if (!query) return '';
    
    // Remove platform-specific mentions and clean up
    return query
      .replace(/<@[UW][A-Z0-9]+>/g, '') // Remove Slack mentions
      .replace(/&lt;at&gt;.*?&lt;\/at&gt;/g, '') // Remove Teams mentions
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Extract platform-specific hints for processing
   */
  private extractPlatformHints(context: PlatformQueryContext): OrchestratorResult['platformHints'] {
    const hints: OrchestratorResult['platformHints'] = {};

    // Check for instruction-related keywords
    const query = context.query.toLowerCase();
    if (query.includes('how to') || query.includes('step') || query.includes('guide') || query.includes('tutorial')) {
      hints.preferSteps = true;
    }

    // Extract collection hints from metadata or channel context
    if (context.metadata?.collection) {
      hints.collection = context.metadata.collection;
    } else if (context.metadata?.channelName) {
      const channelName = context.metadata.channelName.toLowerCase();
      if (channelName.includes('pssis') || channelName.includes('powerschool')) {
        hints.collection = 'pssis-admin';
      } else if (channelName.includes('schoology') || channelName.includes('lms')) {
        hints.collection = 'schoology';
      }
    }

    // Handle follow-up context
    if (context.metadata?.parentContextId) {
      hints.threadContext = context.metadata.parentContextId;
    }

    return hints;
  }

  /**
   * Build RAG options based on platform context and hints
   */
  private buildRAGOptions(
    context: PlatformQueryContext,
    hints: OrchestratorResult['platformHints']
  ): Partial<RAGPipelineOptions> {
    const options: Partial<RAGPipelineOptions> = {
      topK: 8,
      contextWindowTokens: 3000,
      similarityThreshold: 0.3
    };

    // Set collection filter if specified
    if (hints.collection && hints.collection !== 'both') {
      options.collections = [hints.collection];
    }

    // Adjust parameters for follow-up queries
    if (context.metadata?.parentContextId) {
      options.contextWindowTokens = 4000; // More context for follow-ups
      options.topK = 10;
    }

    return options;
  }

  /**
   * Transform RAG response to unified orchestrator result
   */
  private transformToOrchestratorResult(
    ragResponse: AskResponse,
    context: PlatformQueryContext,
    platformHints: OrchestratorResult['platformHints'],
    contextId: string,
    processingTime: number
  ): OrchestratorResult {
    // Determine intent based on response characteristics
    const intent = this.determineIntent(ragResponse, context.query);
    
    // Calculate confidence based on multiple factors
    const confidence = this.calculateConfidence(ragResponse);

    // Transform sources to unified format
    const sources = this.transformSources(ragResponse);

    return {
      text: ragResponse.answer,
      summary: ragResponse.summary,
      sources,
      confidence,
      intent,
      platformHints,
      metadata: {
        processingTimeMs: processingTime,
        parentContextId: context.metadata?.parentContextId,
        contextId,
        platform: context.platform,
        userId: context.userId,
        channelId: context.channelId
      }
    };
  }

  /**
   * Determine intent from RAG response and query
   */
  private determineIntent(ragResponse: AskResponse, query: string): OrchestratorResult['intent'] {
    const queryLower = query.toLowerCase();
    
    // Check for instruction-seeking patterns
    if (ragResponse.steps && ragResponse.steps.length > 0) {
      return 'instructions';
    }
    
    if (queryLower.includes('how to') || queryLower.includes('step') || queryLower.includes('guide')) {
      return 'instructions';
    }

    // Check for detail-seeking patterns
    if (queryLower.includes('what is') || queryLower.includes('explain') || queryLower.includes('detail')) {
      return 'details';
    }

    return 'other';
  }

  /**
   * Calculate confidence score based on RAG response quality
   */
  private calculateConfidence(ragResponse: AskResponse): number {
    let confidence = 0.5; // Base confidence

    // Factor in number and quality of sources
    if (ragResponse.citations.length > 0) {
      confidence += 0.2;
    }
    
    if (ragResponse.retrieved_docs.length >= 3) {
      confidence += 0.1;
    }

    // Factor in response completeness
    if (ragResponse.answer.length > 200) {
      confidence += 0.1;
    }

    // Factor in step-by-step responses
    if (ragResponse.steps && ragResponse.steps.length > 0) {
      confidence += 0.1;
    }

    // Check debug info for fallback indicators
    if (ragResponse.debug_info?.is_fallback) {
      confidence = Math.max(0.2, confidence - 0.3);
    }

    return Math.min(1.0, Math.max(0.0, confidence));
  }

  /**
   * Transform RAG sources to unified format
   */
  private transformSources(ragResponse: AskResponse): OrchestratorResult['sources'] {
    const sources: OrchestratorResult['sources'] = [];

    // Add retrieved docs as sources
    ragResponse.retrieved_docs.forEach((doc: RetrievedDoc, index: number) => {
      // Try to find matching citation for URL
      const matchingCitation = ragResponse.citations.find(citation => 
        citation.title.toLowerCase().includes(doc.id.toLowerCase()) ||
        doc.excerpt.includes(citation.title.substring(0, 20))
      );

      sources.push({
        id: doc.id,
        title: matchingCitation?.title || `Source ${index + 1}`,
        url: matchingCitation?.url || '#',
        snippet: doc.excerpt,
        retrieval_score: doc.score
      });
    });

    // Add any citations not already included
    ragResponse.citations.forEach(citation => {
      const alreadyIncluded = sources.some(source => source.url === citation.url);
      if (!alreadyIncluded) {
        sources.push({
          id: `citation_${sources.length}`,
          title: citation.title,
          url: citation.url,
          snippet: citation.title,
          retrieval_score: 0.5 // Default score for citations without retrieval scores
        });
      }
    });

    return sources;
  }

  /**
   * Create error result in consistent format
   */
  private createErrorResult(
    error: unknown,
    context: PlatformQueryContext,
    contextId: string,
    processingTime: number
  ): OrchestratorResult {
    let errorMessage = 'An unexpected error occurred while processing your request.';
    let confidence = 0.0;

    if (error instanceof RAGError) {
      switch (error.code) {
        case 'INVALID_QUERY':
          errorMessage = 'Please provide a more detailed question.';
          break;
        case 'EMPTY_RETRIEVAL_RESULTS':
          errorMessage = 'I couldn\'t find relevant information for your query. Try rephrasing your question.';
          confidence = 0.1;
          break;
        case 'LLM_GENERATION_FAILED':
          errorMessage = 'I\'m having trouble generating a response right now. Please try again.';
          break;
        default:
          errorMessage = 'Something went wrong. Please try again or rephrase your question.';
      }
    }

    return {
      text: errorMessage,
      summary: 'Error processing query',
      sources: [],
      confidence,
      intent: 'other',
      platformHints: {},
      metadata: {
        processingTimeMs: processingTime,
        contextId,
        platform: context.platform,
        userId: context.userId,
        channelId: context.channelId
      }
    };
  }

  /**
   * Get orchestrator statistics and health information
   */
  async getStats(): Promise<{
    platform: string;
    ragPipeline: any;
    uptime: number;
  }> {
    const stats = this.ragPipeline.getStats();
    
    return {
      platform: 'unified',
      ragPipeline: stats,
      uptime: process.uptime() * 1000
    };
  }

  /**
   * Health check for the unified orchestrator
   */
  async healthCheck(): Promise<{
    status: 'healthy' | 'unhealthy';
    orchestrator: boolean;
    ragPipeline: boolean;
    details: Record<string, any>;
  }> {
    try {
      const ragHealth = await this.ragPipeline.healthCheck();
      const orchestratorHealthy = true; // Simple check - could be enhanced
      
      return {
        status: ragHealth.status === 'healthy' && orchestratorHealthy ? 'healthy' : 'unhealthy',
        orchestrator: orchestratorHealthy,
        ragPipeline: ragHealth.status === 'healthy',
        details: {
          ragComponents: ragHealth.components,
          ragDetails: ragHealth.details
        }
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        orchestrator: false,
        ragPipeline: false,
        details: {
          error: error instanceof Error ? error.message : 'Unknown error'
        }
      };
    }
  }
}