/**
 * Base embedding adapter interface and utilities
 */

import type { EmbeddingAdapter } from '@/types';

/**
 * Base abstract class for embedding adapters
 */
export abstract class BaseEmbeddingAdapter implements EmbeddingAdapter {
  protected readonly model: string;
  protected readonly dimensions: number;

  constructor(model: string, dimensions: number) {
    this.model = model;
    this.dimensions = dimensions;
  }

  /**
   * Embed a single text string
   */
  abstract embed(text: string): Promise<number[]>;

  /**
   * Embed multiple texts in batch for efficiency
   */
  abstract embedBatch(texts: string[]): Promise<number[][]>;

  /**
   * Get embedding dimensions
   */
  getDimensions(): number {
    return this.dimensions;
  }

  /**
   * Get model name
   */
  getModel(): string {
    return this.model;
  }

  /**
   * Validate input text before embedding
   */
  protected validateText(text: string): void {
    if (!text || typeof text !== 'string') {
      throw new Error('Text must be a non-empty string');
    }

    if (text.length === 0) {
      throw new Error('Text cannot be empty');
    }

    // Check for extremely long texts that might cause issues
    if (text.length > 100000) {
      throw new Error('Text is too long for embedding (max 100,000 characters)');
    }
  }

  /**
   * Validate batch input
   */
  protected validateBatch(texts: string[]): void {
    if (!Array.isArray(texts)) {
      throw new Error('Texts must be an array');
    }

    if (texts.length === 0) {
      throw new Error('Texts array cannot be empty');
    }

    if (texts.length > 1000) {
      throw new Error('Batch size too large (max 1000 texts)');
    }

    texts.forEach((text, index) => {
      try {
        this.validateText(text);
      } catch (error) {
        throw new Error(`Invalid text at index ${index}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    });
  }

  /**
   * Preprocess text before embedding (can be overridden)
   */
  protected preprocessText(text: string): string {
    return text
      .trim()
      .replace(/\s+/g, ' ') // Normalize whitespace
      .replace(/[\r\n]+/g, ' '); // Replace line breaks with spaces
  }

  /**
   * Post-process embedding vector (can be overridden)
   */
  protected postprocessEmbedding(embedding: number[]): number[] {
    // Validate embedding dimensions
    if (embedding.length !== this.dimensions) {
      throw new Error(`Embedding dimension mismatch: expected ${this.dimensions}, got ${embedding.length}`);
    }

    // Normalize embedding vector (L2 normalization)
    const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
    
    if (magnitude === 0) {
      throw new Error('Received zero-magnitude embedding vector');
    }

    return embedding.map(val => val / magnitude);
  }
}

/**
 * Utility functions for embedding operations
 */
export class EmbeddingUtils {
  /**
   * Calculate cosine similarity between two embeddings
   */
  static cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      throw new Error('Embeddings must have the same dimensions');
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i]! * b[i]!;
      normA += a[i]! * a[i]!;
      normB += b[i]! * b[i]!;
    }

    const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
    
    if (magnitude === 0) {
      return 0;
    }

    return dotProduct / magnitude;
  }

  /**
   * Calculate dot product between two embeddings
   */
  static dotProduct(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      throw new Error('Embeddings must have the same dimensions');
    }

    return a.reduce((sum, val, i) => sum + val * b[i]!, 0);
  }

  /**
   * Normalize an embedding vector (L2 normalization)
   */
  static normalize(embedding: number[]): number[] {
    const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
    
    if (magnitude === 0) {
      return embedding;
    }

    return embedding.map(val => val / magnitude);
  }

  /**
   * Chunk text for embedding (useful for long texts)
   */
  static chunkText(
    text: string,
    maxChunkSize: number = 8000,
    overlapSize: number = 200
  ): string[] {
    if (text.length <= maxChunkSize) {
      return [text];
    }

    const chunks: string[] = [];
    let start = 0;

    while (start < text.length) {
      const end = Math.min(start + maxChunkSize, text.length);
      let chunk = text.slice(start, end);

      // Try to end chunk at a natural boundary (sentence, paragraph, etc.)
      if (end < text.length) {
        const lastPeriod = chunk.lastIndexOf('. ');
        const lastNewline = chunk.lastIndexOf('\n');
        const lastSpace = chunk.lastIndexOf(' ');

        const boundary = Math.max(lastPeriod, lastNewline, lastSpace);
        
        if (boundary > maxChunkSize * 0.5) {
          chunk = chunk.slice(0, boundary + (lastPeriod >= 0 ? 2 : 1));
        }
      }

      chunks.push(chunk.trim());

      // Move start position with overlap
      start = Math.max(start + chunk.length - overlapSize, start + 1);
    }

    return chunks.filter(chunk => chunk.length > 0);
  }
}

/**
 * Factory for creating embedding adapters
 */
export class EmbeddingAdapterFactory {
  /**
   * Create an embedding adapter based on provider and configuration
   */
  static async create(
    provider: 'openai' | 'openrouter' | 'bedrock' | 'local',
    options: {
      apiKey?: string;
      model?: string;
      baseUrl?: string;
      accessKeyId?: string;
      secretAccessKey?: string;
      sessionToken?: string;
      region?: string;
    } = {}
  ): Promise<EmbeddingAdapter> {
    switch (provider) {
      case 'openai':
        const { OpenAIEmbeddingAdapter } = await import('./openai');
        return new OpenAIEmbeddingAdapter(options);

      case 'openrouter':
        const { OpenRouterEmbeddingAdapter } = await import('./openrouter');
        return new OpenRouterEmbeddingAdapter(options);

      case 'bedrock':
        const { BedrockEmbeddingAdapter } = await import('./bedrock');
        return new BedrockEmbeddingAdapter(options);

      case 'local':
        const { LocalEmbeddingAdapter } = await import('./local');
        return new LocalEmbeddingAdapter(options);

      default:
        throw new Error(`Unsupported embedding provider: ${provider}`);
    }
  }
}