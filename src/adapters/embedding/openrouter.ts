/**
 * OpenRouter embedding adapter implementation
 * Allows using various embedding models through OpenRouter API
 */

import { BaseEmbeddingAdapter } from './base';
import config from '@/utils/config';
import { RAGError } from '@/types';
import axios, { type AxiosInstance } from 'axios';

export interface OpenRouterEmbeddingOptions {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  maxRetries?: number;
  timeout?: number;
}

/**
 * OpenRouter embedding adapter for accessing various embedding models
 */
export class OpenRouterEmbeddingAdapter extends BaseEmbeddingAdapter {
  private readonly client: AxiosInstance;
  private readonly maxRetries: number;

  // Supported models through OpenRouter
  private static readonly MODEL_CONFIGS = {
    'text-embedding-3-large': { dimensions: 3072, maxTokens: 8191 },
    'text-embedding-3-small': { dimensions: 1536, maxTokens: 8191 },
    'text-embedding-ada-002': { dimensions: 1536, maxTokens: 8191 },
  } as const;

  constructor(options: OpenRouterEmbeddingOptions = {}) {
    const model = options.model || 'text-embedding-3-large';
    const modelConfig = OpenRouterEmbeddingAdapter.MODEL_CONFIGS[model as keyof typeof OpenRouterEmbeddingAdapter.MODEL_CONFIGS];

    if (!modelConfig) {
      throw new RAGError(
        `Unsupported OpenRouter embedding model: ${model}`,
        'INVALID_EMBEDDING_MODEL',
        { supportedModels: Object.keys(OpenRouterEmbeddingAdapter.MODEL_CONFIGS) }
      );
    }

    super(model, modelConfig.dimensions);

    this.maxRetries = options.maxRetries || 3;

    // Initialize HTTP client for OpenRouter API
    this.client = axios.create({
      baseURL: options.baseUrl || 'https://openrouter.ai/api/v1',
      timeout: options.timeout || 30000,
      headers: {
        'Authorization': `Bearer ${options.apiKey || config.OPENROUTER_API_KEY || ''}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://powerschool-rag-api',
        'X-Title': 'PowerSchool RAG API',
      },
    });

    if (!this.client.defaults.headers['Authorization'] || this.client.defaults.headers['Authorization'] === 'Bearer ') {
      throw new RAGError(
        'OpenRouter API key is required for embedding generation',
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

    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        const response = await this.client.post('/embeddings', {
          model: this.model,
          input: preprocessedText,
          encoding_format: 'float',
        });

        if (!response.data?.data || response.data.data.length === 0) {
          throw new RAGError(
            'No embedding data returned from OpenRouter',
            'EMPTY_EMBEDDING_RESPONSE'
          );
        }

        const embedding = response.data.data[0].embedding;
        
        if (!embedding || embedding.length === 0) {
          throw new RAGError(
            'Invalid embedding vector received from OpenRouter',
            'INVALID_EMBEDDING_VECTOR'
          );
        }

        return this.postprocessEmbedding(embedding);

      } catch (error) {
        lastError = error instanceof Error ? error : new Error('Unknown error');

        if (axios.isAxiosError(error)) {
          const status = error.response?.status;
          
          // Don't retry on client errors (4xx)
          if (status && status >= 400 && status < 500) {
            throw new RAGError(
              `OpenRouter API error: ${error.response?.data?.error?.message || error.message}`,
              'OPENROUTER_API_ERROR',
              {
                status,
                code: error.code,
                response: error.response?.data,
              }
            );
          }
        }

        if (error instanceof RAGError) {
          throw error;
        }

        // Wait before retrying (exponential backoff)
        if (attempt < this.maxRetries - 1) {
          await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
        }
      }
    }

    throw new RAGError(
      `Failed to generate embedding after ${this.maxRetries} attempts: ${lastError?.message || 'Unknown error'}`,
      'EMBEDDING_GENERATION_FAILED',
      { originalError: lastError }
    );
  }

  /**
   * Embed multiple texts in batch for efficiency
   */
  async embedBatch(texts: string[]): Promise<number[][]> {
    this.validateBatch(texts);

    // Process in smaller batches to avoid API limits
    const batchSize = 50;
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
      const response = await this.client.post('/embeddings', {
        model: this.model,
        input: preprocessedTexts,
        encoding_format: 'float',
      });

      if (!response.data?.data || response.data.data.length !== texts.length) {
        throw new RAGError(
          `Embedding count mismatch: expected ${texts.length}, got ${response.data?.data?.length || 0}`,
          'EMBEDDING_COUNT_MISMATCH'
        );
      }

      return response.data.data.map((item: any, index: number) => {
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

      if (axios.isAxiosError(error)) {
        throw new RAGError(
          `OpenRouter API error in batch processing: ${error.response?.data?.error?.message || error.message}`,
          'OPENROUTER_BATCH_API_ERROR',
          {
            status: error.response?.status,
            code: error.code,
            batchSize: texts.length,
            response: error.response?.data,
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
    const modelConfig = OpenRouterEmbeddingAdapter.MODEL_CONFIGS[this.model as keyof typeof OpenRouterEmbeddingAdapter.MODEL_CONFIGS];
    
    return {
      model: this.model,
      dimensions: this.dimensions,
      maxTokens: modelConfig.maxTokens,
      provider: 'openrouter',
    };
  }
}