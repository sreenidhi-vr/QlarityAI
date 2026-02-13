/**
 * OpenAI embedding adapter implementation
 */

import OpenAI from 'openai';
import { BaseEmbeddingAdapter } from './base';
import config from '@/utils/config';
import { RAGError } from '@/types';

export interface OpenAIEmbeddingOptions {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  maxRetries?: number;
  timeout?: number;
}

/**
 * OpenAI embedding adapter using text-embedding-3-large by default
 */
export class OpenAIEmbeddingAdapter extends BaseEmbeddingAdapter {
  private readonly client: OpenAI;
  private readonly maxRetries: number;
  private readonly timeout: number;

  // Model configurations
  private static readonly MODEL_CONFIGS = {
    'text-embedding-3-large': { dimensions: 3072, maxTokens: 8191 },
    'text-embedding-3-small': { dimensions: 1536, maxTokens: 8191 },
    'text-embedding-ada-002': { dimensions: 1536, maxTokens: 8191 },
  } as const;

  constructor(options: OpenAIEmbeddingOptions = {}) {
    const model = options.model || config.EMBEDDING_MODEL || 'text-embedding-3-large';
    const modelConfig = OpenAIEmbeddingAdapter.MODEL_CONFIGS[model as keyof typeof OpenAIEmbeddingAdapter.MODEL_CONFIGS];

    if (!modelConfig) {
      throw new RAGError(
        `Unsupported OpenAI embedding model: ${model}`,
        'INVALID_EMBEDDING_MODEL',
        { supportedModels: Object.keys(OpenAIEmbeddingAdapter.MODEL_CONFIGS) }
      );
    }

    super(model, modelConfig.dimensions);

    this.maxRetries = options.maxRetries || 3;
    this.timeout = options.timeout || 30000; // 30 seconds

    // Initialize OpenAI client
    this.client = new OpenAI({
      apiKey: options.apiKey || config.OPENAI_API_KEY,
      baseURL: options.baseUrl,
      maxRetries: this.maxRetries,
      timeout: this.timeout,
    });

    if (!this.client.apiKey) {
      throw new RAGError(
        'OpenAI API key is required for embedding generation',
        'MISSING_API_KEY'
      );
    }
  }

  /**
   * Embed a single text string
   */
  async embed(text: string): Promise<number[]> {
    this.validateText(text);
    const preprocessedText = this.preprocessText(text);

    try {
      const createParams: any = {
        model: this.model,
        input: preprocessedText,
        encoding_format: 'float',
      };
      
      if (this.model === 'text-embedding-3-large') {
        createParams.dimensions = 1536; // Use 1536 for compatibility
      }
      
      const response = await this.client.embeddings.create(createParams);

      if (!response.data || response.data.length === 0) {
        throw new RAGError(
          'No embedding data returned from OpenAI',
          'EMPTY_EMBEDDING_RESPONSE'
        );
      }

      const embedding = response.data[0]!.embedding;
      
      if (!embedding || embedding.length === 0) {
        throw new RAGError(
          'Invalid embedding vector received from OpenAI',
          'INVALID_EMBEDDING_VECTOR'
        );
      }

      return this.postprocessEmbedding(embedding);

    } catch (error) {
      if (error instanceof RAGError) {
        throw error;
      }

      if (error instanceof OpenAI.APIError) {
        throw new RAGError(
          `OpenAI API error: ${error.message}`,
          'OPENAI_API_ERROR',
          {
            status: error.status,
            code: error.code,
            type: error.type,
          }
        );
      }

      throw new RAGError(
        `Failed to generate embedding: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'EMBEDDING_GENERATION_FAILED',
        { originalError: error }
      );
    }
  }

  /**
   * Embed multiple texts in batch for efficiency
   */
  async embedBatch(texts: string[]): Promise<number[][]> {
    this.validateBatch(texts);

    // OpenAI has a batch limit, so we'll process in chunks
    const batchSize = 100; // Conservative batch size
    const results: number[][] = [];

    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const batchResults = await this.processBatch(batch);
      results.push(...batchResults);
    }

    return results;
  }

  /**
   * Process a single batch of texts
   */
  private async processBatch(texts: string[]): Promise<number[][]> {
    const preprocessedTexts = texts.map(text => this.preprocessText(text));

    try {
      const createParams: any = {
        model: this.model,
        input: preprocessedTexts,
        encoding_format: 'float',
      };
      
      if (this.model === 'text-embedding-3-large') {
        createParams.dimensions = 1536; // Use 1536 for compatibility
      }
      
      const response = await this.client.embeddings.create(createParams);

      if (!response.data || response.data.length !== texts.length) {
        throw new RAGError(
          `Embedding count mismatch: expected ${texts.length}, got ${response.data?.length || 0}`,
          'EMBEDDING_COUNT_MISMATCH'
        );
      }

      return response.data.map((item: any, index: number) => {
        if (!item.embedding || item.embedding.length === 0) {
          throw new RAGError(
            `Invalid embedding vector at index ${index}`,
            'INVALID_EMBEDDING_VECTOR',
            { index }
          );
        }
        return this.postprocessEmbedding(item.embedding);
      });

    } catch (error) {
      if (error instanceof RAGError) {
        throw error;
      }

      if (error instanceof OpenAI.APIError) {
        throw new RAGError(
          `OpenAI API error in batch processing: ${error.message}`,
          'OPENAI_BATCH_API_ERROR',
          {
            status: error.status,
            code: error.code,
            type: error.type,
            batchSize: texts.length,
          }
        );
      }

      throw new RAGError(
        `Failed to generate batch embeddings: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'BATCH_EMBEDDING_FAILED',
        { 
          batchSize: texts.length,
          originalError: error,
        }
      );
    }
  }

  /**
   * Override postprocessing for OpenAI embeddings (already normalized)
   */
  protected override postprocessEmbedding(embedding: number[]): number[] {
    // Validate dimensions (use actual dimensions for compatibility)
    const expectedDimensions = this.model === 'text-embedding-3-large' ? 1536 : this.dimensions;
    
    if (embedding.length !== expectedDimensions) {
      throw new RAGError(
        `Embedding dimension mismatch: expected ${expectedDimensions}, got ${embedding.length}`,
        'EMBEDDING_DIMENSION_MISMATCH'
      );
    }

    // OpenAI embeddings are already normalized, so we don't need to normalize again
    return embedding;
  }

  /**
   * Get usage statistics from the client (if available)
   */
  getUsageStats(): { requestCount: number; tokenCount: number } | null {
    // This would require implementing usage tracking in a real scenario
    return null;
  }

  /**
   * Test the connection and model availability
   */
  async testConnection(): Promise<boolean> {
    try {
      await this.embed('Test connection');
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Get model information
   */
  getModelInfo(): {
    model: string;
    dimensions: number;
    maxTokens: number;
    provider: string;
  } {
    const modelConfig = OpenAIEmbeddingAdapter.MODEL_CONFIGS[this.model as keyof typeof OpenAIEmbeddingAdapter.MODEL_CONFIGS];
    
    return {
      model: this.model,
      dimensions: this.model === 'text-embedding-3-large' ? 1536 : this.dimensions, // Return actual used dimensions
      maxTokens: modelConfig.maxTokens,
      provider: 'openai',
    };
  }
}