/**
 * OpenRouter LLM adapter implementation
 */

import { BaseLLMAdapter } from './base';
import { RAGError } from '@/types';
import config from '@/utils/config';
import type { ChatMessage, GenerateOptions } from '@/types';
import axios, { type AxiosInstance } from 'axios';

export interface OpenRouterLLMOptions {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  maxRetries?: number;
  timeout?: number;
  defaultOptions?: Partial<GenerateOptions>;
}

/**
 * OpenRouter LLM adapter for accessing various models through OpenRouter API
 */
export class OpenRouterLLMAdapter extends BaseLLMAdapter {
  private readonly client: AxiosInstance;
  private readonly maxRetries: number;

  constructor(options: OpenRouterLLMOptions = {}) {
    const model = options.model || 'openai/gpt-4';
    const maxTokens = 8192; // Default context window

    super(model, maxTokens, {
      max_tokens: config.MAX_TOKENS || 1500,
      temperature: 0.1,
      top_p: 0.9,
      ...options.defaultOptions,
    });

    this.maxRetries = options.maxRetries || 3;

    // Initialize HTTP client for OpenRouter API
    this.client = axios.create({
      baseURL: options.baseUrl || 'https://openrouter.ai/api/v1',
      timeout: options.timeout || 60000, // 60 seconds for LLM requests
      headers: {
        'Authorization': `Bearer ${options.apiKey || config.OPENROUTER_API_KEY || ''}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://powerschool-rag-api',
        'X-Title': 'PowerSchool RAG API',
      },
    });

    if (!this.client.defaults.headers['Authorization'] || this.client.defaults.headers['Authorization'] === 'Bearer ') {
      throw new RAGError(
        'OpenRouter API key is required for LLM generation',
        'MISSING_API_KEY'
      );
    }
  }

  /**
   * Generate response using OpenRouter API
   */
  async generate(messages: ChatMessage[], options: GenerateOptions = {}): Promise<string> {
    this.validateMessages(messages);
    const mergedOptions = this.mergeOptions(options);
    this.validateTokenBudget(messages, mergedOptions);

    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        const response = await this.client.post('/chat/completions', {
          model: this.model,
          messages: messages.map(msg => ({
            role: msg.role,
            content: msg.content,
          })),
          max_tokens: mergedOptions.max_tokens,
          temperature: mergedOptions.temperature,
          top_p: mergedOptions.top_p,
          stop: mergedOptions.stop && mergedOptions.stop.length > 0 ? mergedOptions.stop : undefined,
        });

        if (!response.data?.choices || response.data.choices.length === 0) {
          throw new RAGError(
            'No response choices returned from OpenRouter',
            'EMPTY_LLM_RESPONSE'
          );
        }

        const choice = response.data.choices[0];
        if (!choice?.message?.content) {
          throw new RAGError(
            'Invalid response format from OpenRouter',
            'INVALID_LLM_RESPONSE'
          );
        }

        return this.cleanResponse(choice.message.content);

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
      `Failed to generate LLM response after ${this.maxRetries} attempts: ${lastError?.message || 'Unknown error'}`,
      'LLM_GENERATION_FAILED',
      { originalError: lastError }
    );
  }

  /**
   * Test connection
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
   * Get model information
   */
  getModelInfo(): {
    model: string;
    maxTokens: number;
    contextWindow: number;
    provider: string;
    supportsStreaming: boolean;
    supportsSystemMessages: boolean;
  } {
    return {
      model: this.model,
      maxTokens: this.maxTokens,
      contextWindow: this.maxTokens,
      provider: 'openrouter',
      supportsStreaming: false, // Could be implemented
      supportsSystemMessages: true,
    };
  }
}