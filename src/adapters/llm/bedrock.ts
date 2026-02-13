/**
 * AWS Bedrock LLM adapter implementation
 */

import {
  BedrockRuntimeClient,
  InvokeModelCommand,
  InvokeModelCommandInput,
} from '@aws-sdk/client-bedrock-runtime';
import { fromEnv, fromIni, fromInstanceMetadata } from '@aws-sdk/credential-providers';
import { BaseLLMAdapter } from './base';
import config from '@/utils/config';
import { RAGError } from '@/types';
import type { ChatMessage, GenerateOptions } from '@/types';

export interface BedrockLLMOptions {
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
  region?: string;
  model?: string;
  maxRetries?: number;
  timeout?: number;
  defaultOptions?: Partial<GenerateOptions>;
}

/**
 * AWS Bedrock LLM adapter using Claude 3 by default
 */
export class BedrockLLMAdapter extends BaseLLMAdapter {
  private readonly client: BedrockRuntimeClient;
  private readonly maxRetries: number;

  // Model configurations for Bedrock LLM models
  private static readonly MODEL_CONFIGS = {
    'anthropic.claude-3-sonnet-20240229-v1:0': { 
      maxTokens: 4096, 
      contextWindow: 200000,
      inputTokenCost: 0.003,
      outputTokenCost: 0.015
    },
    'anthropic.claude-3-haiku-20240307-v1:0': { 
      maxTokens: 4096, 
      contextWindow: 200000,
      inputTokenCost: 0.00025,
      outputTokenCost: 0.00125
    },
    'anthropic.claude-3-opus-20240229-v1:0': { 
      maxTokens: 4096, 
      contextWindow: 200000,
      inputTokenCost: 0.015,
      outputTokenCost: 0.075
    },
    'anthropic.claude-v2:1': { 
      maxTokens: 4096, 
      contextWindow: 100000,
      inputTokenCost: 0.008,
      outputTokenCost: 0.024
    },
    'anthropic.claude-v2': { 
      maxTokens: 4096, 
      contextWindow: 100000,
      inputTokenCost: 0.008,
      outputTokenCost: 0.024
    },
    'amazon.titan-text-lite-v1': { 
      maxTokens: 4000, 
      contextWindow: 4000,
      inputTokenCost: 0.0003,
      outputTokenCost: 0.0004
    },
    'amazon.titan-text-express-v1': { 
      maxTokens: 8000, 
      contextWindow: 8000,
      inputTokenCost: 0.0008,
      outputTokenCost: 0.0016
    },
    'cohere.command-text-v14': { 
      maxTokens: 4000, 
      contextWindow: 4000,
      inputTokenCost: 0.0015,
      outputTokenCost: 0.002
    },
    'cohere.command-light-text-v14': { 
      maxTokens: 4000, 
      contextWindow: 4000,
      inputTokenCost: 0.0003,
      outputTokenCost: 0.0006
    },
  } as const;

  constructor(options: BedrockLLMOptions = {}) {
    const model = options.model || 'anthropic.claude-3-haiku-20240307-v1:0';
    const modelConfig = BedrockLLMAdapter.MODEL_CONFIGS[model as keyof typeof BedrockLLMAdapter.MODEL_CONFIGS];

    if (!modelConfig) {
      throw new RAGError(
        `Unsupported Bedrock LLM model: ${model}`,
        'INVALID_LLM_MODEL',
        { supportedModels: Object.keys(BedrockLLMAdapter.MODEL_CONFIGS) }
      );
    }

    super(model, modelConfig.contextWindow, {
      max_tokens: Math.min(config.MAX_TOKENS || 1500, modelConfig.maxTokens),
      temperature: 0.1, // Low temperature for factual responses
      top_p: 0.9,
      ...options.defaultOptions,
    });

    this.maxRetries = options.maxRetries || 3;

    // Initialize Bedrock client with credentials
    const region = options.region || process.env.AWS_REGION || 'us-east-1';
    
    let credentials;
    if (options.accessKeyId && options.secretAccessKey) {
      // Use explicit credentials
      credentials = {
        accessKeyId: options.accessKeyId,
        secretAccessKey: options.secretAccessKey,
        ...(options.sessionToken && { sessionToken: options.sessionToken }),
      };
    } else {
      // Use credential chain (env vars, profile, instance metadata)
      credentials = fromEnv() || fromIni() || fromInstanceMetadata();
    }

    this.client = new BedrockRuntimeClient({
      region,
      credentials,
      maxAttempts: this.maxRetries,
    });
  }

  /**
   * Generate response from messages using Bedrock
   */
  async generate(messages: ChatMessage[], options: GenerateOptions = {}): Promise<string> {
    this.validateMessages(messages);
    const mergedOptions = this.mergeOptions(options);
    this.validateTokenBudget(messages, mergedOptions);

    try {
      let requestBody: any;
      
      // Different models have different request formats
      if (this.model.startsWith('anthropic.claude')) {
        requestBody = this.buildAnthropicRequest(messages, mergedOptions);
      } else if (this.model.startsWith('amazon.titan')) {
        requestBody = this.buildTitanRequest(messages, mergedOptions);
      } else if (this.model.startsWith('cohere.command')) {
        requestBody = this.buildCohereRequest(messages, mergedOptions);
      } else {
        throw new RAGError(
          `Unsupported model format: ${this.model}`,
          'UNSUPPORTED_MODEL_FORMAT'
        );
      }

      const input: InvokeModelCommandInput = {
        modelId: this.model,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify(requestBody),
      };

      const command = new InvokeModelCommand(input);
      const response = await this.client.send(command);

      if (!response.body) {
        throw new RAGError(
          'No response body returned from Bedrock',
          'EMPTY_LLM_RESPONSE'
        );
      }

      // Parse response
      const responseText = new TextDecoder().decode(response.body);
      const responseJson = JSON.parse(responseText);

      let generatedText: string;

      if (this.model.startsWith('anthropic.claude')) {
        generatedText = responseJson.content?.[0]?.text || responseJson.completion;
      } else if (this.model.startsWith('amazon.titan')) {
        generatedText = responseJson.results?.[0]?.outputText;
      } else if (this.model.startsWith('cohere.command')) {
        generatedText = responseJson.generations?.[0]?.text;
      } else {
        throw new RAGError(
          'Unexpected response format from Bedrock',
          'INVALID_LLM_RESPONSE'
        );
      }

      if (!generatedText) {
        throw new RAGError(
          'No generated text in Bedrock response',
          'EMPTY_GENERATED_TEXT'
        );
      }

      return this.cleanResponse(generatedText);

    } catch (error) {
      if (error instanceof RAGError) {
        throw error;
      }

      // Handle AWS SDK errors
      if (error && typeof error === 'object' && 'name' in error) {
        const awsError = error as any;
        
        if (awsError.name === 'ValidationException') {
          throw new RAGError(
            `Bedrock validation error: ${awsError.message}`,
            'BEDROCK_VALIDATION_ERROR',
            { originalError: awsError }
          );
        }
        
        if (awsError.name === 'AccessDeniedException') {
          throw new RAGError(
            'Access denied to Bedrock service. Check your AWS credentials and permissions.',
            'BEDROCK_ACCESS_DENIED',
            { originalError: awsError }
          );
        }
        
        if (awsError.name === 'ThrottlingException') {
          throw new RAGError(
            'Bedrock API throttling limit exceeded. Please retry later.',
            'BEDROCK_THROTTLING',
            { originalError: awsError }
          );
        }

        if (awsError.name === 'ModelTimeoutException') {
          throw new RAGError(
            'Bedrock model request timed out. Try reducing input length or max tokens.',
            'BEDROCK_MODEL_TIMEOUT',
            { originalError: awsError }
          );
        }
      }

      throw new RAGError(
        `Failed to generate LLM response: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'LLM_GENERATION_FAILED',
        { originalError: error }
      );
    }
  }

  /**
   * Build request body for Anthropic Claude models
   */
  private buildAnthropicRequest(messages: ChatMessage[], options: GenerateOptions): any {
    const systemMessage = messages.find(m => m.role === 'system');
    const conversationMessages = messages.filter(m => m.role !== 'system');

    if (this.model.includes('claude-3')) {
      // Claude 3 format (Messages API)
      return {
        messages: conversationMessages.map(msg => ({
          role: msg.role === 'assistant' ? 'assistant' : 'user',
          content: msg.content,
        })),
        ...(systemMessage && { system: systemMessage.content }),
        max_tokens: options.max_tokens || 1500,
        temperature: options.temperature || 0.1,
        top_p: options.top_p || 0.9,
        ...(options.stop && options.stop.length > 0 && { stop_sequences: options.stop }),
        anthropic_version: 'bedrock-2023-05-31',
      };
    } else {
      // Claude 2 format (Completions API)
      const prompt = this.buildClaudePrompt(messages);
      return {
        prompt,
        max_tokens_to_sample: options.max_tokens || 1500,
        temperature: options.temperature || 0.1,
        top_p: options.top_p || 0.9,
        ...(options.stop && options.stop.length > 0 && { stop_sequences: options.stop }),
      };
    }
  }

  /**
   * Build request body for Amazon Titan models
   */
  private buildTitanRequest(messages: ChatMessage[], options: GenerateOptions): any {
    const prompt = this.buildConversationPrompt(messages);
    
    return {
      inputText: prompt,
      textGenerationConfig: {
        maxTokenCount: options.max_tokens || 1500,
        temperature: options.temperature || 0.1,
        topP: options.top_p || 0.9,
        ...(options.stop && options.stop.length > 0 && { stopSequences: options.stop }),
      },
    };
  }

  /**
   * Build request body for Cohere Command models
   */
  private buildCohereRequest(messages: ChatMessage[], options: GenerateOptions): any {
    const prompt = this.buildConversationPrompt(messages);
    
    return {
      prompt,
      max_tokens: options.max_tokens || 1500,
      temperature: options.temperature || 0.1,
      p: options.top_p || 0.9,
      ...(options.stop && options.stop.length > 0 && { stop_sequences: options.stop }),
    };
  }

  /**
   * Build Claude-style conversation prompt
   */
  private buildClaudePrompt(messages: ChatMessage[]): string {
    let prompt = '';
    
    for (const message of messages) {
      if (message.role === 'system') {
        prompt += `${message.content}\n\n`;
      } else if (message.role === 'user') {
        prompt += `Human: ${message.content}\n\n`;
      } else if (message.role === 'assistant') {
        prompt += `Assistant: ${message.content}\n\n`;
      }
    }
    
    prompt += 'Assistant:';
    return prompt;
  }

  /**
   * Build generic conversation prompt for other models
   */
  private buildConversationPrompt(messages: ChatMessage[]): string {
    return messages.map(msg => {
      const roleLabel = msg.role === 'system' ? 'System' : 
                       msg.role === 'user' ? 'User' : 'Assistant';
      return `${roleLabel}: ${msg.content}`;
    }).join('\n\n') + '\n\nAssistant:';
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
    const modelConfig = BedrockLLMAdapter.MODEL_CONFIGS[this.model as keyof typeof BedrockLLMAdapter.MODEL_CONFIGS];
    
    return {
      model: this.model,
      maxTokens: modelConfig.maxTokens,
      contextWindow: modelConfig.contextWindow,
      provider: 'aws-bedrock',
      supportsStreaming: false, // Bedrock streaming would require additional implementation
      supportsSystemMessages: true,
    };
  }

  /**
   * Estimate cost for a request
   */
  estimateRequestCost(messages: ChatMessage[], options: GenerateOptions = {}): {
    inputTokens: number;
    outputTokens: number;
    estimatedCostUSD: number;
  } {
    const inputTokens = this.estimateTokenCount(messages);
    const outputTokens = options.max_tokens || this.defaultOptions.max_tokens || 1500;

    const modelConfig = BedrockLLMAdapter.MODEL_CONFIGS[this.model as keyof typeof BedrockLLMAdapter.MODEL_CONFIGS];
    
    const estimatedCostUSD = 
      (inputTokens / 1000) * modelConfig.inputTokenCost +
      (outputTokens / 1000) * modelConfig.outputTokenCost;

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
    // AWS doesn't provide usage stats through the SDK
    return null;
  }
}