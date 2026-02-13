/**
 * Main RAG pipeline orchestrator
 * Coordinates retrieval, prompt building, and LLM generation
 */

import type {
  EmbeddingAdapter,
  VectorStoreAdapter,
  LLMAdapter,
  RAGOptions,
  AskResponse,
  RetrievedDoc,
  SearchResult
} from '@/types';
import { RAGError } from '@/types';
import { Retriever, type RetrievalOptions } from './retriever';
import { PromptBuilder, type PromptOptions } from './promptBuilder';
import { LLMClient } from './llmClient';
import config from '@/utils/config';

export interface RAGPipelineOptions {
  topK?: number;
  contextWindowTokens?: number;
  similarityThreshold?: number;
  contentTypes?: string[];
  sections?: string[];
  collections?: string[];
  useHybridSearch?: boolean;
  vectorWeight?: number;
  textWeight?: number;
}

export class RAGPipeline {
  private retriever: Retriever;
  private promptBuilder: PromptBuilder;
  private llmClient: LLMClient;

  constructor(
    embeddingAdapter: EmbeddingAdapter,
    vectorStore: VectorStoreAdapter,
    llmAdapter: LLMAdapter
  ) {
    this.retriever = new Retriever(embeddingAdapter, vectorStore);
    this.promptBuilder = new PromptBuilder();
    this.llmClient = new LLMClient(llmAdapter);
  }

  /**
   * Process a query through the complete RAG pipeline
   */
  async process(
    query: string,
    options: Partial<RAGOptions & RAGPipelineOptions> = {}
  ): Promise<AskResponse> {
    const pipelineStartTime = Date.now();
    let debugInfo = {
      is_fallback: false,
      pipeline_stage: 'initialization',
      processing_time_ms: 0,
      documents_found: 0,
      used_mock_embedding: false
    };

    try {
      const {
        prefer_steps = false,
        max_tokens = config.MAX_TOKENS,
        top_k = 10,
        context_window_tokens = 3000,
        similarityThreshold = 0.3, // CHANGED: Lowered from 0.7 to 0.3 for better recall
        contentTypes,
        sections,
        collections,
        useHybridSearch = false,
        vectorWeight = 0.7,
        textWeight = 0.3,
      } = options;

      // Step 1: Retrieve relevant documents
      console.debug('[RAG Pipeline] Starting document retrieval...', {
        query: query.substring(0, 100),
        retrievalOptions: {
          topK: top_k,
          similarityThreshold,
          contentTypes,
          sections,
          collections,
          useHybridSearch
        }
      });
      const retrievalStartTime = Date.now();
      
      const retrievalOptions: RetrievalOptions = {
        topK: top_k,
        similarityThreshold,
        ...(contentTypes && { contentTypes }),
        ...(sections && { sections }),
        ...(collections && { collections }),
      };

      const retrievalResult = useHybridSearch
        ? await this.retriever.hybridRetrieve(query, {
            ...retrievalOptions,
            vectorWeight,
            textWeight,
          })
        : await this.retriever.retrieve(query, retrievalOptions);

      const retrievalTime = Date.now() - retrievalStartTime;

      // Update debug info
      debugInfo.pipeline_stage = 'retrieval_completed';
      debugInfo.documents_found = retrievalResult.results.length;
      debugInfo.used_mock_embedding = (retrievalResult as any).usedMockEmbedding || false;

      console.debug('[RAG Pipeline] Retrieval completed', {
        documentsFound: retrievalResult.results.length,
        retrievalTimeMs: retrievalTime,
        topScores: retrievalResult.results.slice(0, 3).map(r => ({
          id: r.id,
          score: r.score,
          title: r.metadata.title
        }))
      });

      // Check if we found any relevant documents
      if (retrievalResult.results.length === 0) {
        console.debug('[RAG Pipeline] No documents retrieved - attempting hybrid search fallback', {
          reason: 'EMPTY_RETRIEVAL_RESULTS',
          query: query.substring(0, 100),
          searchOptions: retrievalOptions,
          willTryHybrid: !useHybridSearch
        });
        
        // Try hybrid search as fallback if not already used
        if (!useHybridSearch) {
          console.debug('[RAG Pipeline] Attempting hybrid search fallback...');
          try {
            const hybridResult = await this.retriever.hybridRetrieve(query, {
              ...retrievalOptions,
              vectorWeight: 0.5,
              textWeight: 0.5,
            });
            
            if (hybridResult.results.length > 0) {
              console.debug('[RAG Pipeline] Hybrid search found results', {
                resultsCount: hybridResult.results.length,
                topScores: hybridResult.results.slice(0, 3).map(r => ({
                  score: r.score,
                  title: r.metadata.title.substring(0, 50)
                }))
              });
              
              // Update results and continue with pipeline
              retrievalResult.results = hybridResult.results;
              debugInfo.documents_found = hybridResult.results.length;
              debugInfo.pipeline_stage = 'hybrid_search_fallback';
            } else {
              console.debug('[RAG Pipeline] Hybrid search also returned no results');
              return this.createFallbackResponse(query, pipelineStartTime, 'HYBRID_SEARCH_ALSO_EMPTY', debugInfo);
            }
          } catch (error) {
            console.warn('[RAG Pipeline] Hybrid search fallback failed', {
              error: error instanceof Error ? error.message : 'Unknown error'
            });
            return this.createFallbackResponse(query, pipelineStartTime, 'HYBRID_SEARCH_FAILED', debugInfo);
          }
        } else {
          return this.createFallbackResponse(query, pipelineStartTime, 'EMPTY_RETRIEVAL_RESULTS', debugInfo);
        }
      }

      // Step 2: Build context from retrieved documents
      console.debug('[RAG Pipeline] Building context from retrieved documents...', {
        documentsCount: retrievalResult.results.length,
        contextWindowTokens: context_window_tokens
      });
      const contextResult = this.retriever.buildContext(
        retrievalResult.results,
        context_window_tokens
      );

      console.debug('[RAG Pipeline] Context built successfully', {
        contextTokens: contextResult.tokenCount,
        documentsUsed: contextResult.usedResults.length,
        contextLength: contextResult.context.length
      });

      // Step 3: Build prompts
      console.debug('[RAG Pipeline] Building prompts...', {
        preferSteps: prefer_steps,
        maxTokens: max_tokens,
        includeReferences: true
      });
      const promptOptions: PromptOptions = {
        preferSteps: prefer_steps,
        maxTokens: max_tokens,
        includeReferences: true,
      };

      const promptResult = this.promptBuilder.buildPrompt(
        query,
        contextResult.context,
        contextResult.usedResults,
        promptOptions
      );

      console.debug('[RAG Pipeline] Prompts built successfully', {
        systemPromptLength: promptResult.systemPrompt.length,
        userPromptLength: promptResult.userPrompt.length,
        citationsCount: promptResult.citations.length
      });

      // Step 4: Generate response with LLM
      console.debug('[RAG Pipeline] Generating LLM response...', {
        model: this.llmClient.getAdapterInfo().model,
        maxTokens: max_tokens,
        temperature: 0.1
      });
      const llmStartTime = Date.now();
      
      const llmResult = await this.llmClient.generate(
        promptResult.systemPrompt,
        promptResult.userPrompt,
        {
          max_tokens,
          temperature: 0.1,
          top_p: 0.9,
        }
      );

      const llmTime = Date.now() - llmStartTime;

      console.debug('[RAG Pipeline] LLM response generated', {
        responseLength: llmResult.response.length,
        tokenCount: llmResult.tokenCount,
        generationTimeMs: llmTime,
        model: llmResult.model,
        responsePreview: llmResult.response.substring(0, 200) + '...'
      });

      // Step 5: Parse and validate response
      console.debug('[RAG Pipeline] Parsing and validating response...');
      const parsedResponse = this.llmClient.parseResponse(llmResult.response);
      
      console.debug('[RAG Pipeline] Response parsed', {
        summaryLength: parsedResponse.summary.length,
        hasSteps: Boolean(parsedResponse.steps),
        stepsCount: parsedResponse.steps?.length || 0
      });
      
      // Validate response quality
      const validation = this.llmClient.validateResponse(llmResult.response);
      if (!validation.valid) {
        console.warn('[RAG Pipeline] Response validation issues detected:', {
          issues: validation.issues,
          responsePreview: llmResult.response.substring(0, 300)
        });
      }

      // Clean and format response
      const cleanedResponse = this.llmClient.cleanResponse(llmResult.response);

      console.debug('[RAG Pipeline] Response cleaned', {
        originalLength: llmResult.response.length,
        cleanedLength: cleanedResponse.length,
        cleanedPreview: cleanedResponse.substring(0, 200) + '...'
      });

      // Step 6: Prepare final response
      const totalTime = Date.now() - pipelineStartTime;
      
      // Update final debug info
      debugInfo.pipeline_stage = 'completed';
      debugInfo.processing_time_ms = totalTime;

      const response: AskResponse = {
        answer: cleanedResponse,
        summary: parsedResponse.summary,
        ...(parsedResponse.steps && { steps: parsedResponse.steps }),
        citations: promptResult.citations,
        retrieved_docs: this.formatRetrievedDocs(contextResult.usedResults),
        debug_info: debugInfo,
      };

      // Log pipeline performance and final response
      console.debug('[RAG Pipeline] Pipeline completed successfully', {
        totalTimeMs: totalTime,
        retrievalTimeMs: retrievalTime,
        llmTimeMs: llmTime,
        documentsUsed: contextResult.usedResults.length,
        contextTokens: contextResult.tokenCount,
        responseTokens: llmResult.tokenCount,
        finalAnswerLength: response.answer.length,
        hasCitations: response.citations.length > 0,
        hasSteps: Boolean(response.steps),
        debugInfo
      });

      return response;

    } catch (error) {
      const totalTime = Date.now() - pipelineStartTime;
      debugInfo.processing_time_ms = totalTime;

      console.error('[RAG Pipeline] Pipeline failed with error', {
        error: error instanceof Error ? error.message : 'Unknown error',
        errorType: error instanceof Error ? error.constructor.name : typeof error,
        processingTimeMs: totalTime,
        query: query.substring(0, 100),
        debugInfo,
        stack: error instanceof Error ? error.stack : undefined
      });
      
      if (error instanceof RAGError) {
        // Add debug info to RAG errors
        (error as any).debugInfo = debugInfo;
        throw error;
      }

      throw new RAGError(
        `RAG pipeline failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'PIPELINE_FAILED',
        {
          query: query.substring(0, 100),
          originalError: error,
          processingTimeMs: totalTime,
          debugInfo
        }
      );
    }
  }

  /**
   * Health check for the RAG pipeline
   */
  async healthCheck(): Promise<{
    status: 'healthy' | 'unhealthy';
    components: {
      vectorStore: boolean;
      embedding: boolean;
      llm: boolean;
    };
    details?: Record<string, unknown>;
  }> {
    try {
      const checks = await Promise.allSettled([
        // Check vector store
        this.retriever['vectorStore'].health(),
        
        // Check embedding adapter with a test query
        this.retriever['embeddingAdapter'].embed('test query'),
        
        // Check LLM adapter with a simple test
        this.llmClient['llmAdapter'].generate([
          { role: 'user', content: 'Say "OK" if you can process this message.' }
        ], { max_tokens: 10 }),
      ]);

      const componentStatus = {
        vectorStore: checks[0].status === 'fulfilled' && checks[0].value === true,
        embedding: checks[1].status === 'fulfilled' && Array.isArray(checks[1].value),
        llm: checks[2].status === 'fulfilled' && typeof checks[2].value === 'string',
      };

      const allHealthy = Object.values(componentStatus).every(status => status === true);

      return {
        status: allHealthy ? 'healthy' : 'unhealthy',
        components: componentStatus,
        details: {
          embeddingDimensions: checks[1].status === 'fulfilled' ? (checks[1].value as number[]).length : 0,
          llmModel: this.llmClient.getAdapterInfo().model,
        },
      };

    } catch (error) {
      return {
        status: 'unhealthy',
        components: {
          vectorStore: false,
          embedding: false,
          llm: false,
        },
        details: {
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      };
    }
  }

  /**
   * Create a fallback response when no documents are found
   */
  private createFallbackResponse(
    query: string,
    startTime: number,
    reason: string = 'NO_DOCUMENTS_RETRIEVED',
    debugInfo: any
  ): AskResponse {
    const totalTime = Date.now() - startTime;
    
    // Update debug info for fallback
    debugInfo.is_fallback = true;
    debugInfo.fallback_reason = reason;
    debugInfo.pipeline_stage = 'fallback';
    debugInfo.processing_time_ms = totalTime;

    console.debug('[RAG Pipeline] Creating enhanced fallback response', {
      reason,
      query: query.substring(0, 100),
      processingTimeMs: totalTime,
      debugInfo
    });

    // Create more helpful fallback message based on the reason
    let fallbackAnswer: string;
    let summary: string;
    
    switch (reason) {
      case 'HYBRID_SEARCH_ALSO_EMPTY':
        fallbackAnswer = this.buildEnhancedFallbackAnswer(query, 'Both vector and text search returned no results.');
        summary = `No matching documentation found for "${query}" using advanced search methods.`;
        break;
        
      case 'HYBRID_SEARCH_FAILED':
        fallbackAnswer = this.buildEnhancedFallbackAnswer(query, 'Search system encountered an error.');
        summary = `Search temporarily unavailable for "${query}" - please try again.`;
        break;
        
      default:
        fallbackAnswer = this.buildEnhancedFallbackAnswer(query);
        summary = `I couldn't find a documented answer for "${query}" in the PSSIS-Admin documentation.`;
    }

    console.debug('[RAG Pipeline] Enhanced fallback response created', {
      answerLength: fallbackAnswer.length,
      answerPreview: fallbackAnswer.substring(0, 200) + '...',
      fallbackReason: reason,
      debugInfo
    });

    return {
      answer: fallbackAnswer,
      summary,
      citations: [
        {
          title: 'PowerSchool Support',
          url: 'https://support.powerschool.com/',
        },
        {
          title: 'PowerSchool Community',
          url: 'https://community.powerschool.com/',
        },
      ],
      retrieved_docs: [],
      debug_info: debugInfo,
    };
  }

  /**
   * Build enhanced fallback answer with helpful suggestions
   */
  private buildEnhancedFallbackAnswer(query: string, issue?: string): string {
    const lowerQuery = query.toLowerCase();
    
    // Suggest alternative search terms based on common PowerSchool concepts
    const suggestions: string[] = [];
    
    if (lowerQuery.includes('enroll') || lowerQuery.includes('enrollment')) {
      suggestions.push('Try searching for "student enrollment", "school enrollment", or "mass register"');
    }
    if (lowerQuery.includes('schedule') || lowerQuery.includes('class')) {
      suggestions.push('Try "course requests", "scheduling", or "class management"');
    }
    if (lowerQuery.includes('grade') || lowerQuery.includes('report')) {
      suggestions.push('Try "grade reporting", "report cards", or "academic reports"');
    }
    if (lowerQuery.includes('student')) {
      suggestions.push('Try "student information", "student records", or "student management"');
    }
    
    // Default suggestions if no specific matches
    if (suggestions.length === 0) {
      suggestions.push('Try using more specific terms related to PowerSchool features');
      suggestions.push('Browse the PowerSchool documentation sections directly');
    }

    const issueText = issue ? `\n\n**Issue**: ${issue}` : '';
    const suggestionText = suggestions.length > 0 ?
      `\n\n**Try these alternative searches:**\n${suggestions.map(s => `• ${s}`).join('\n')}` : '';

    return `I couldn't find specific documentation for "${query}" in the PowerSchool PSSIS-Admin guides.${issueText}${suggestionText}

**Resources to help:**
• **PowerSchool Support**: Visit the official support portal for detailed documentation
• **PowerSchool Community**: Connect with other users and experts
• **Contact Support**: For specific technical questions about your PowerSchool instance

**Search Tips:**
• Use specific PowerSchool terminology (e.g., "student enrollment" instead of "add student")
• Try broader terms first, then narrow down
• Check if the feature exists in your PowerSchool version`;
  }

  /**
   * Format retrieved documents for the API response
   */
  private formatRetrievedDocs(searchResults: SearchResult[]): RetrievedDoc[] {
    return searchResults.map(result => ({
      id: result.id,
      score: Math.round(result.score * 1000) / 1000, // Round to 3 decimal places
      excerpt: this.createExcerpt(result.content, 200),
    }));
  }

  /**
   * Create a short excerpt from content
   */
  private createExcerpt(content: string, maxLength: number): string {
    if (content.length <= maxLength) {
      return content.trim();
    }

    // Try to break at sentence boundary
    const truncated = content.substring(0, maxLength);
    const lastSentenceEnd = Math.max(
      truncated.lastIndexOf('.'),
      truncated.lastIndexOf('!'),
      truncated.lastIndexOf('?')
    );

    if (lastSentenceEnd > maxLength * 0.6) {
      return truncated.substring(0, lastSentenceEnd + 1).trim();
    }

    // Fall back to word boundary
    const lastSpace = truncated.lastIndexOf(' ');
    if (lastSpace > maxLength * 0.8) {
      return truncated.substring(0, lastSpace).trim() + '...';
    }

    // Last resort: hard truncate
    return truncated.trim() + '...';
  }

  /**
   * Get pipeline statistics
   */
  getStats(): {
    embeddingModel: string;
    embeddingDimensions: number;
    llmModel: string;
    llmMaxTokens: number;
  } {
    return {
      embeddingModel: this.retriever['embeddingAdapter'].getModel(),
      embeddingDimensions: this.retriever['embeddingAdapter'].getDimensions(),
      llmModel: this.llmClient.getAdapterInfo().model,
      llmMaxTokens: this.llmClient.getAdapterInfo().maxTokens,
    };
  }
}