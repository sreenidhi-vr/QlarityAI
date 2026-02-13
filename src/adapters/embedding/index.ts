/**
 * Embedding adapters export index
 */

export { BaseEmbeddingAdapter, EmbeddingUtils, EmbeddingAdapterFactory } from './base';
export { OpenAIEmbeddingAdapter, type OpenAIEmbeddingOptions } from './openai';
export { OpenRouterEmbeddingAdapter, type OpenRouterEmbeddingOptions } from './openrouter';
export { BedrockEmbeddingAdapter, type BedrockEmbeddingOptions } from './bedrock';
export { LocalEmbeddingAdapter, LocalEmbeddingFactory, type LocalEmbeddingOptions } from './local';

// Re-export types from the main types module
export type { EmbeddingAdapter } from '@/types';
import type { EmbeddingAdapter } from '@/types';

/**
 * Default embedding adapter factory function with fallback for testing
 */
export async function createEmbeddingAdapter(
  provider: 'openai' | 'openrouter' | 'bedrock' | 'local' = 'openai',
  options: Record<string, unknown> = {}
): Promise<EmbeddingAdapter> {
  const { EmbeddingAdapterFactory } = await import('./base');
  
  try {
    return EmbeddingAdapterFactory.create(provider, options);
  } catch (error) {
    // If primary provider fails, fall back to local for testing
    console.warn(`Primary embedding provider '${provider}' failed, falling back to local adapter for testing:`, error instanceof Error ? error.message : 'Unknown error');
    return EmbeddingAdapterFactory.create('local', options);
  }
}