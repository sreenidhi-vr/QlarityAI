/**
 * OpenAI LLM adapter implementation
 */

import OpenAI from 'openai';
import { BaseLLMAdapter } from './base';
import config from '@/utils/config';
import { RAGError } from '@/types';
import type { ChatMessage, GenerateOptions } from '@/types';

export interface OpenAILLMOptions {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  maxRetries?: number;
  timeout?: number;
  defaultOptions?: Partial<GenerateOptions>;
}

/**
 * OpenAI LLM adapter using GPT-4 by default
 */
export class OpenAILLMAdapter extends BaseLLMAdapter {
  private readonly client: OpenAI;
  private readonly maxRetries: number;
  private readonly timeout: number;

  // Model configurations
  private static readonly MODEL_CONFIGS = {
    'gpt-4': { maxTokens: 8192, contextWindow: 8192 },
    'gpt-4-0125-preview': { maxTokens: 4096, contextWindow: 128000 },
    'gpt-4-turbo-preview': { maxTokens: 4096, contextWindow: 128000 },
    'gpt-3.5-turbo': { maxTokens: 4096, contextWindow: 16384 },
    'gpt-3.5-turbo-0125': { maxTokens: 4096, contextWindow: 16384 },
  } as const;

  constructor(options: OpenAILLMOptions = {}) {
    const model = options.model || config.LLM_MODEL || 'gpt-4';
    const modelConfig = OpenAILLMAdapter.MODEL_CONFIGS[model as keyof typeof OpenAILLMAdapter.MODEL_CONFIGS];

    if (!modelConfig) {
      throw new RAGError(
        `Unsupported OpenAI model: ${model}`,
        'INVALID_LLM_MODEL',
        { supportedModels: Object.keys(OpenAILLMAdapter.MODEL_CONFIGS) }
      );
    }

    super(model, modelConfig.contextWindow, {
      max_tokens: Math.min(config.MAX_TOKENS || 1500, modelConfig.maxTokens),
      temperature: 0.1, // Low temperature for factual responses
      top_p: 0.9,
      ...options.defaultOptions,
    });

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
        'OpenAI API key is required for LLM generation',
        'MISSING_API_KEY'
      );
    }
  }

  /**
   * Generate response from messages using OpenAI Chat Completions API
   */
  async generate(messages: ChatMessage[], options: GenerateOptions = {}): Promise<string> {
    this.validateMessages(messages);
    const mergedOptions = this.mergeOptions(options);
    this.validateTokenBudget(messages, mergedOptions);

    try {
      // Convert messages to OpenAI format
      const openaiMessages = messages.map(msg => ({
        role: msg.role as 'system' | 'user' | 'assistant',
        content: msg.content,
      }));

      const createParams: any = {
        model: this.model,
        messages: openaiMessages,
        stream: false,
      };
      
      if (mergedOptions.max_tokens) createParams.max_tokens = mergedOptions.max_tokens;
      if (mergedOptions.temperature !== undefined) createParams.temperature = mergedOptions.temperature;
      if (mergedOptions.top_p !== undefined) createParams.top_p = mergedOptions.top_p;
      if (mergedOptions.stop && mergedOptions.stop.length > 0) createParams.stop = mergedOptions.stop;
      
      const response = await this.client.chat.completions.create(createParams);

      if (!response.choices || response.choices.length === 0) {
        throw new RAGError(
          'No response choices returned from OpenAI',
          'EMPTY_LLM_RESPONSE'
        );
      }

      const choice = response.choices[0];
      if (!choice?.message?.content) {
        throw new RAGError(
          'Invalid response format from OpenAI',
          'INVALID_LLM_RESPONSE'
        );
      }

      return this.cleanResponse(choice.message.content);

    } catch (error) {
      if (error instanceof RAGError) {
        throw error;
      }

      if (error instanceof OpenAI.APIError) {
        // Handle specific OpenAI API errors
        let errorCode = 'OPENAI_API_ERROR';
        let errorMessage = `OpenAI API error: ${error.message}`;

        switch (error.status) {
          case 400:
            errorCode = 'OPENAI_BAD_REQUEST';
            break;
          case 401:
            errorCode = 'OPENAI_UNAUTHORIZED';
            errorMessage = 'Invalid OpenAI API key';
            break;
          case 429:
            errorCode = 'OPENAI_RATE_LIMIT';
            errorMessage = 'OpenAI API rate limit exceeded';
            break;
          case 500:
          case 502:
          case 503:
            errorCode = 'OPENAI_SERVER_ERROR';
            errorMessage = 'OpenAI API server error';
            break;
        }

        throw new RAGError(
          errorMessage,
          errorCode,
          {
            status: error.status,
            code: error.code,
            type: error.type,
            originalMessage: error.message,
          }
        );
      }

      throw new RAGError(
        `Failed to generate LLM response: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'LLM_GENERATION_FAILED',
        { originalError: error }
      );
    }
  }

  /**
   * Generate streaming response (future implementation)
   */
  async generateStream(
    messages: ChatMessage[],
    options: GenerateOptions = {},
    onChunk?: (chunk: string) => void
  ): Promise<string> {
    this.validateMessages(messages);
    const mergedOptions = this.mergeOptions({ ...options, stream: true });
    this.validateTokenBudget(messages, mergedOptions);

    try {
      const openaiMessages = messages.map(msg => ({
        role: msg.role as 'system' | 'user' | 'assistant',
        content: msg.content,
      }));

      const createParams: any = {
        model: this.model,
        messages: openaiMessages,
        stream: true,
      };
      
      if (mergedOptions.max_tokens) createParams.max_tokens = mergedOptions.max_tokens;
      if (mergedOptions.temperature !== undefined) createParams.temperature = mergedOptions.temperature;
      if (mergedOptions.top_p !== undefined) createParams.top_p = mergedOptions.top_p;
      if (mergedOptions.stop && mergedOptions.stop.length > 0) createParams.stop = mergedOptions.stop;
      
      const stream = await this.client.chat.completions.create(createParams) as any;

      let fullResponse = '';

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content || '';
        if (delta) {
          fullResponse += delta;
          onChunk?.(delta);
        }
      }

      return this.cleanResponse(fullResponse);

    } catch (error) {
      if (error instanceof RAGError) {
        throw error;
      }

      throw new RAGError(
        `Failed to generate streaming LLM response: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'LLM_STREAM_FAILED',
        { originalError: error }
      );
    }
  }

  /**
   * Test the connection and model availability
   */
  async testConnection(): Promise<boolean> {
    try {
      const testMessages: ChatMessage[] = [
        { role: 'user', content: 'Hello, can you respond with just "OK"?' }
      ];

      const response = await this.generate(testMessages, { max_tokens: 10 });
      return response.trim().toLowerCase().includes('ok');
    } catch (error) {
      return false;
    }
  }

  /**
   * Get model information and capabilities
   */
  getModelInfo(): {
    model: string;
    maxTokens: number;
    contextWindow: number;
    provider: string;
    supportsStreaming: boolean;
    supportsSystemMessages: boolean;
  } {
    const modelConfig = OpenAILLMAdapter.MODEL_CONFIGS[this.model as keyof typeof OpenAILLMAdapter.MODEL_CONFIGS];
    
    return {
      model: this.model,
      maxTokens: modelConfig.maxTokens,
      contextWindow: modelConfig.contextWindow,
      provider: 'openai',
      supportsStreaming: true,
      supportsSystemMessages: true,
    };
  }

  /**
   * Estimate cost for a request (approximate)
   */
  estimateRequestCost(messages: ChatMessage[], options: GenerateOptions = {}): {
    inputTokens: number;
    outputTokens: number;
    estimatedCostUSD: number;
  } {
    const inputTokens = this.estimateTokenCount(messages);
    const outputTokens = options.max_tokens || this.defaultOptions.max_tokens || 1500;

    // Rough pricing estimates (as of 2024 - would need to be updated)
    const pricing = {
      'gpt-4': { input: 0.03, output: 0.06 }, // per 1K tokens
      'gpt-4-0125-preview': { input: 0.01, output: 0.03 },
      'gpt-4-turbo-preview': { input: 0.01, output: 0.03 },
      'gpt-3.5-turbo': { input: 0.0005, output: 0.0015 },
      'gpt-3.5-turbo-0125': { input: 0.0005, output: 0.0015 },
    };

    const modelPricing = pricing[this.model as keyof typeof pricing] || pricing['gpt-4'];
    
    const estimatedCostUSD = 
      (inputTokens / 1000) * modelPricing.input +
      (outputTokens / 1000) * modelPricing.output;

    return {
      inputTokens,
      outputTokens,
      estimatedCostUSD: Math.round(estimatedCostUSD * 10000) / 10000, // Round to 4 decimal places
    };
  }

  /**
   * Get usage statistics (if tracking is implemented)
   */
  getUsageStats(): {
    totalRequests: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCostUSD: number;
  } | null {
    // This would require implementing usage tracking
    // For now, return null
    return null;
  }
}