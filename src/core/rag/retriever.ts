/**
 * Retrieval component for RAG pipeline
 * Handles query embedding and vector similarity search
 */

import type { EmbeddingAdapter, VectorStoreAdapter, SearchResult } from '@/types';
import { RAGError } from '@/types';

export interface RetrievalOptions {
  topK?: number;
  similarityThreshold?: number;
  contentTypes?: string[];
  sections?: string[];
  collections?: string[];
}

export interface RetrievalResult {
  results: SearchResult[];
  queryEmbedding: number[];
  retrievalTimeMs: number;
  usedMockEmbedding?: boolean;
}

export class Retriever {
  constructor(
    private embeddingAdapter: EmbeddingAdapter,
    private vectorStore: VectorStoreAdapter
  ) {}

  /**
   * Retrieve relevant documents for a query
   */
  async retrieve(
    query: string,
    options: RetrievalOptions = {}
  ): Promise<RetrievalResult> {
    const startTime = Date.now();

    try {
      // Default options - LOWERED SIMILARITY THRESHOLD
      const {
        topK = 10,
        similarityThreshold = 0.3, // CHANGED: Lowered from 0.7 to 0.3 for better recall
        contentTypes,
        sections,
        collections,
      } = options;

      // Embed the query with enhanced debugging
      console.debug('[Retriever] Starting query embedding...', {
        query: query.substring(0, 100),
        queryLength: query.length,
        embeddingAdapter: this.embeddingAdapter.getModel(),
        similarityThreshold,
        topK
      });
      const embeddingStartTime = Date.now();
      let queryEmbedding: number[];
      let usedMockEmbedding = false;
      
      try {
        queryEmbedding = await this.embeddingAdapter.embed(query);
        console.debug('[Retriever] Query embedded successfully', {
          embeddingDimensions: queryEmbedding.length,
          embeddingPreview: queryEmbedding.slice(0, 5),
          embeddingMagnitude: Math.sqrt(queryEmbedding.reduce((sum, val) => sum + val * val, 0))
        });
      } catch (error) {
        console.warn('[Retriever] Primary embedding failed, using mock embedding for testing', {
          error: error instanceof Error ? error.message : 'Unknown error',
          fallbackAction: 'Using random 1024-dimensional vector for Titan v2'
        });
        // Create a mock embedding vector for testing (1024 dimensions for Titan v2, random values)
        queryEmbedding = Array.from({ length: 1024 }, () => Math.random() * 2 - 1);
        usedMockEmbedding = true;
      }
      
      const embeddingTime = Date.now() - embeddingStartTime;

      // Perform vector search with enhanced debugging
      console.debug('[Retriever] Starting vector search...', {
        embeddingDimensions: queryEmbedding.length,
        topK,
        similarityThreshold,
        usedMockEmbedding,
        hasFilters: Boolean(contentTypes?.length || sections?.length),
        queryPreview: query.substring(0, 50)
      });
      const searchStartTime = Date.now();
      let searchResults: SearchResult[];

      // Always try basic search first for debugging
      console.debug('[Retriever] Attempting basic vector search without filters...');
      const basicResults = await this.vectorStore.search(queryEmbedding, topK * 3); // Get more results for analysis
      console.debug('[Retriever] Basic vector search results:', {
        resultsFound: basicResults.length,
        topScores: basicResults.slice(0, 5).map(r => ({
          id: r.id.substring(0, 8),
          score: r.score,
          title: r.metadata.title.substring(0, 50)
        }))
      });

      // Use filtered search if filters are provided
      if (contentTypes?.length || sections?.length || collections?.length || similarityThreshold > 0) {
        const filters = {
          ...(contentTypes && { contentTypes }),
          ...(sections && { sections }),
          ...(collections && { collections }),
          ...(similarityThreshold > 0 && { similarityThreshold }),
        };

        console.debug('[Retriever] Applying filters to results...', { filters });

        // Check if the vector store supports filtered search
        if ('searchWithFilters' in this.vectorStore) {
          console.debug('[Retriever] Using native filtered search');
          searchResults = await (this.vectorStore as any).searchWithFilters(
            queryEmbedding,
            topK,
            filters
          );
        } else {
          console.debug('[Retriever] Using client-side filtering');
          const preFilterCount = basicResults.length;
          searchResults = this.filterResults(basicResults, filters);
          searchResults = searchResults.slice(0, topK);
          console.debug('[Retriever] Applied client-side filtering', {
            preFilterCount,
            postFilterCount: searchResults.length,
            filteredOutByThreshold: basicResults.filter(r => r.score < similarityThreshold).length,
            filtersApplied: filters
          });
        }
      } else {
        console.debug('[Retriever] Using basic vector search results (no filters)');
        searchResults = basicResults.slice(0, topK);
      }

      const searchTime = Date.now() - searchStartTime;
      const totalTime = Date.now() - startTime;

      // Enhanced logging for debugging
      console.debug('[Retriever] Vector search completed', {
        totalTimeMs: totalTime,
        embeddingTimeMs: embeddingTime,
        searchTimeMs: searchTime,
        resultsFound: searchResults.length,
        usedMockEmbedding,
        similarityThreshold,
        queryLength: query.length,
        topScores: searchResults.slice(0, 5).map(r => ({
          id: r.id.substring(0, 8),
          score: r.score,
          title: r.metadata.title.substring(0, 50),
          section: r.metadata.section
        }))
      });

      if (searchResults.length === 0) {
        console.warn('[Retriever] No search results found - DETAILED ANALYSIS', {
          query: query.substring(0, 100),
          similarityThreshold,
          usedMockEmbedding,
          embeddingDimensions: queryEmbedding.length,
          basicResultsCount: basicResults?.length || 0,
          basicTopScores: basicResults?.slice(0, 3).map(r => ({
            score: r.score,
            title: r.metadata.title.substring(0, 50)
          })) || [],
          possibleCauses: [
            `Similarity threshold too high (${similarityThreshold})`,
            'Poor embedding quality or model mismatch',
            'Query preprocessing issues',
            'Vector dimension mismatch',
            usedMockEmbedding ? 'Using mock embedding (auth issues)' : 'Real embedding used'
          ],
          recommendations: [
            'Try lowering similarity threshold to 0.1-0.3',
            'Check if embedding model matches seeded documents',
            'Verify AWS credentials for Bedrock',
            'Test with hybrid search as fallback'
          ]
        });
      } else {
        console.debug('[Retriever] ✅ Successfully retrieved documents', {
          count: searchResults.length,
          scoreRange: {
            highest: Math.max(...searchResults.map(r => r.score)),
            lowest: Math.min(...searchResults.map(r => r.score))
          }
        });
      }

      return {
        results: searchResults,
        queryEmbedding,
        retrievalTimeMs: totalTime,
        usedMockEmbedding,
      };

    } catch (error) {
      throw new RAGError(
        `Retrieval failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'RETRIEVAL_FAILED',
        { 
          query: query.substring(0, 100),
          options,
          originalError: error,
        }
      );
    }
  }

  /**
   * Filter search results based on criteria
   */
  private filterResults(
    results: SearchResult[],
    filters: {
      similarityThreshold?: number;
      contentTypes?: string[];
      sections?: string[];
      collections?: string[];
    }
  ): SearchResult[] {
    return results.filter(result => {
      // Filter by similarity threshold
      if (filters.similarityThreshold !== undefined && result.score < filters.similarityThreshold) {
        return false;
      }

      // Filter by content types
      if (filters.contentTypes?.length && !filters.contentTypes.includes(result.metadata.content_type)) {
        return false;
      }

      // Filter by sections
      if (filters.sections?.length && result.metadata.section && !filters.sections.includes(result.metadata.section)) {
        return false;
      }

      // Filter by collections
      if (filters.collections?.length && result.metadata.collection && !filters.collections.includes(result.metadata.collection)) {
        return false;
      }

      return true;
    });
  }

  /**
   * Get context string from retrieved documents
   */
  buildContext(results: SearchResult[], maxTokens: number = 4000): {
    context: string;
    usedResults: SearchResult[];
    tokenCount: number;
  } {
    const usedResults: SearchResult[] = [];
    const contextParts: string[] = [];
    let currentTokens = 0;

    // Rough token estimation (4 chars = 1 token)
    const estimateTokens = (text: string): number => Math.ceil(text.length / 4);

    for (const result of results) {
      // Format the context piece
      const contextPiece = this.formatContextPiece(result);
      const pieceTokens = estimateTokens(contextPiece);

      // Check if adding this piece would exceed token limit
      if (currentTokens + pieceTokens > maxTokens) {
        break;
      }

      contextParts.push(contextPiece);
      usedResults.push(result);
      currentTokens += pieceTokens;
    }

    return {
      context: contextParts.join('\n\n'),
      usedResults,
      tokenCount: currentTokens,
    };
  }

  /**
   * Format a single search result for context
   */
  private formatContextPiece(result: SearchResult): string {
    const { metadata, content } = result;
    
    let contextPiece = `## ${metadata.title}`;
    
    if (metadata.section) {
      contextPiece += ` - ${metadata.section}`;
    }
    
    if (metadata.subsection) {
      contextPiece += ` > ${metadata.subsection}`;
    }
    
    contextPiece += `\n\n${content.trim()}`;
    
    if (metadata.url) {
      contextPiece += `\n\n**Source**: ${metadata.url}`;
    }
    
    return contextPiece;
  }

  /**
   * Perform hybrid search if supported
   */
  async hybridRetrieve(
    query: string,
    options: RetrievalOptions & {
      vectorWeight?: number;
      textWeight?: number;
    } = {}
  ): Promise<RetrievalResult> {
    const startTime = Date.now();

    try {
      const {
        topK = 10,
        vectorWeight = 0.7,
        textWeight = 0.3,
      } = options;

      // Check if vector store supports hybrid search
      if ('hybridSearch' in this.vectorStore) {
        const queryEmbedding = await this.embeddingAdapter.embed(query);
        
        const searchResults = await (this.vectorStore as any).hybridSearch(
          queryEmbedding,
          query,
          topK,
          { vector: vectorWeight, text: textWeight }
        );

        return {
          results: searchResults,
          queryEmbedding,
          retrievalTimeMs: Date.now() - startTime,
        };
      } else {
        // Fall back to vector-only search
        return this.retrieve(query, options);
      }

    } catch (error) {
      throw new RAGError(
        `Hybrid retrieval failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'HYBRID_RETRIEVAL_FAILED',
        { 
          query: query.substring(0, 100),
          options,
          originalError: error,
        }
      );
    }
  }
}