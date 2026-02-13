/**
 * LLM adapters export index
 */

export { BaseLLMAdapter, LLMUtils, LLMAdapterFactory } from './base';
export { OpenAILLMAdapter, type OpenAILLMOptions } from './openai';
export { OpenRouterLLMAdapter, type OpenRouterLLMOptions } from './openrouter';
export { AnthropicLLMAdapter, type AnthropicLLMOptions } from './anthropic';
export { BedrockLLMAdapter, type BedrockLLMOptions } from './bedrock';
export { LocalLLMAdapter, type LocalLLMOptions } from './local';

// Re-export types from the main types module
export type { LLMAdapter, ChatMessage, GenerateOptions } from '@/types';
import type { LLMAdapter } from '@/types';

/**
 * Default LLM adapter factory function with fallback for testing
 */
export async function createLLMAdapter(
  provider: 'openai' | 'openrouter' | 'anthropic' | 'bedrock' | 'local' = 'openai',
  options: Record<string, unknown> = {}
): Promise<LLMAdapter> {
  const { LLMAdapterFactory } = await import('./base');
  
  try {
    return LLMAdapterFactory.create(provider, options);
  } catch (error) {
    // If primary provider fails, fall back to local for testing
    console.warn(`Primary LLM provider '${provider}' failed, falling back to local adapter for testing:`, error instanceof Error ? error.message : 'Unknown error');
    return LLMAdapterFactory.create('local', options);
  }
}

/**
 * Get recommended LLM provider based on environment and available API keys
 */
export function getRecommendedLLMProvider(): 'openai' | 'openrouter' | 'anthropic' | 'bedrock' | 'local' {
  try {
    // Check for available API keys (safely)
    const hasOpenAI = typeof globalThis !== 'undefined' && 'process' in globalThis ? Boolean((globalThis as any).process?.env?.OPENAI_API_KEY) : false;
    const hasOpenRouter = typeof globalThis !== 'undefined' && 'process' in globalThis ? Boolean((globalThis as any).process?.env?.OPENROUTER_API_KEY) : false;
    const hasAnthropic = typeof globalThis !== 'undefined' && 'process' in globalThis ? Boolean((globalThis as any).process?.env?.ANTHROPIC_API_KEY) : false;
    const hasAWS = typeof globalThis !== 'undefined' && 'process' in globalThis ? Boolean((globalThis as any).process?.env?.AWS_ACCESS_KEY_ID && (globalThis as any).process?.env?.AWS_SECRET_ACCESS_KEY) : false;
    const nodeEnv = typeof globalThis !== 'undefined' && 'process' in globalThis ? (globalThis as any).process?.env?.NODE_ENV : 'development';

    // Prefer OpenAI if available
    if (hasOpenAI) {
      return 'openai';
    }

    // Fall back to AWS Bedrock if available
    if (hasAWS) {
      return 'bedrock';
    }

    // Fall back to OpenRouter if available
    if (hasOpenRouter) {
      return 'openrouter';
    }

    // Fall back to Anthropic if available
    if (hasAnthropic) {
      return 'anthropic';
    }

    // Use local adapter for development/testing when no API keys are available
    if (nodeEnv === 'development' || nodeEnv === 'test') {
      return 'local';
    }

    // Default to OpenAI (will fail if no API key, but that's intentional)
    return 'openai';
  } catch {
    // Fallback to local adapter if process is not available
    return 'local';
  }
}