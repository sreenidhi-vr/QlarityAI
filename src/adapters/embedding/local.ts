/**
 * Local embedding adapter implementation
 * Placeholder for local/offline embedding models
 */

import { BaseEmbeddingAdapter } from './base';

export interface LocalEmbeddingOptions {
  model?: string;
  modelPath?: string;
  dimensions?: number;
}

/**
 * Local embedding adapter for offline embedding generation
 * This is a placeholder implementation that can be extended with actual local models
 */
export class LocalEmbeddingAdapter extends BaseEmbeddingAdapter {
  private readonly modelPath: string | undefined;

  // Mock configurations for demonstration
  private static readonly MODEL_CONFIGS = {
    'sentence-transformers/all-MiniLM-L6-v2': { dimensions: 384, maxTokens: 512 },
    'sentence-transformers/all-mpnet-base-v2': { dimensions: 768, maxTokens: 512 },
    'mock-local-model': { dimensions: 768, maxTokens: 1024 },
  } as const;

  constructor(options: LocalEmbeddingOptions = {}) {
    const model = options.model || 'mock-local-model';
    const dimensions = options.dimensions || 768;
    
    // Use provided dimensions or fall back to model config
    const modelConfig = LocalEmbeddingAdapter.MODEL_CONFIGS[model as keyof typeof LocalEmbeddingAdapter.MODEL_CONFIGS];
    const finalDimensions = dimensions || modelConfig?.dimensions || 768;

    super(model, finalDimensions);
    this.modelPath = options.modelPath;
  }

  /**
   * Embed a single text string
   * This is a mock implementation - replace with actual local model inference
   */
  async embed(text: string): Promise<number[]> {
    this.validateText(text);
    const preprocessedText = this.preprocessText(text);

    // Mock implementation - generates deterministic embeddings based on text hash
    const embedding = this.generateMockEmbedding(preprocessedText);
    return this.postprocessEmbedding(embedding);
  }

  /**
   * Embed multiple texts in batch for efficiency
   */
  async embedBatch(texts: string[]): Promise<number[][]> {
    this.validateBatch(texts);

    // Process all texts (mock implementation)
    const results: number[][] = [];
    
    for (const text of texts) {
      const preprocessedText = this.preprocessText(text);
      const embedding = this.generateMockEmbedding(preprocessedText);
      results.push(this.postprocessEmbedding(embedding));
    }

    return results;
  }

  /**
   * Generate a mock embedding vector based on text content
   * Replace this with actual local model inference
   */
  private generateMockEmbedding(text: string): number[] {
    const embedding = new Array(this.dimensions);
    
    // Generate deterministic embedding based on text hash
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }

    // Use hash as seed for pseudo-random number generation
    let seed = Math.abs(hash);
    
    for (let i = 0; i < this.dimensions; i++) {
      // Linear congruential generator for pseudo-random numbers
      seed = (seed * 1664525 + 1013904223) % Math.pow(2, 32);
      embedding[i] = (seed / Math.pow(2, 32)) * 2 - 1; // Normalize to [-1, 1]
    }

    return embedding;
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
    const modelConfig = LocalEmbeddingAdapter.MODEL_CONFIGS[this.model as keyof typeof LocalEmbeddingAdapter.MODEL_CONFIGS];
    
    return {
      model: this.model,
      dimensions: this.dimensions,
      maxTokens: modelConfig?.maxTokens || 1024,
      provider: 'local',
    };
  }

  /**
   * Initialize local model (placeholder for actual model loading)
   */
  async initialize(): Promise<void> {
    // TODO: Implement actual model initialization
    // This would load the model from modelPath or download if needed
    
    if (this.modelPath) {
      // Mock model loading - would load model from path
      // In production: load actual model from this.modelPath
    } else {
      // Using mock local model - would use default model
      // In production: use default embedded model
    }
  }

  /**
   * Check if model is loaded and ready
   */
  isReady(): boolean {
    // TODO: Implement actual readiness check
    return true; // Mock implementation always ready
  }

  /**
   * Get memory usage statistics (useful for local models)
   */
  getMemoryUsage(): {
    modelSize?: number;
    currentMemory?: number;
    maxMemory?: number;
  } {
    // TODO: Implement actual memory monitoring
    return {
      modelSize: 100 * 1024 * 1024, // Mock: 100MB
      currentMemory: 50 * 1024 * 1024, // Mock: 50MB
      maxMemory: 500 * 1024 * 1024, // Mock: 500MB
    };
  }
}

/**
 * Factory function for creating local embedding adapters with common models
 */
export class LocalEmbeddingFactory {
  /**
   * Create a sentence transformer adapter (placeholder)
   */
  static createSentenceTransformer(
    model: 'all-MiniLM-L6-v2' | 'all-mpnet-base-v2' = 'all-MiniLM-L6-v2',
    options: Omit<LocalEmbeddingOptions, 'model'> = {}
  ): LocalEmbeddingAdapter {
    return new LocalEmbeddingAdapter({
      ...options,
      model: `sentence-transformers/${model}`,
    });
  }

  /**
   * Create a custom local model adapter
   */
  static createCustomModel(
    modelPath: string,
    dimensions: number,
    options: Omit<LocalEmbeddingOptions, 'modelPath' | 'dimensions'> = {}
  ): LocalEmbeddingAdapter {
    return new LocalEmbeddingAdapter({
      ...options,
      modelPath,
      dimensions,
      model: `custom-${modelPath.split('/').pop() || 'model'}`,
    });
  }
}