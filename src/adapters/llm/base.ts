/**
 * Base LLM adapter interface and utilities
 */

import type { LLMAdapter, ChatMessage, GenerateOptions } from '@/types';
import { RAGError } from '@/types';

/**
 * Base abstract class for LLM adapters
 */
export abstract class BaseLLMAdapter implements LLMAdapter {
  protected readonly model: string;
  protected readonly maxTokens: number;
  protected readonly defaultOptions: Partial<GenerateOptions>;

  constructor(
    model: string, 
    maxTokens: number, 
    defaultOptions: Partial<GenerateOptions> = {}
  ) {
    this.model = model;
    this.maxTokens = maxTokens;
    this.defaultOptions = {
      temperature: 0.1, // Low temperature for factual responses
      top_p: 0.9,
      stop: [],
      stream: false,
      ...defaultOptions,
    };
  }

  /**
   * Generate response from messages
   */
  abstract generate(messages: ChatMessage[], options?: GenerateOptions): Promise<string>;

  /**
   * Get maximum tokens for this model
   */
  getMaxTokens(): number {
    return this.maxTokens;
  }

  /**
   * Get model name
   */
  getModel(): string {
    return this.model;
  }

  /**
   * Validate chat messages
   */
  protected validateMessages(messages: ChatMessage[]): void {
    if (!Array.isArray(messages) || messages.length === 0) {
      throw new RAGError('Messages must be a non-empty array', 'INVALID_MESSAGES');
    }

    for (const [index, message] of messages.entries()) {
      if (!message || typeof message !== 'object') {
        throw new RAGError(`Message at index ${index} must be an object`, 'INVALID_MESSAGE_FORMAT');
      }

      if (!message.role || !['system', 'user', 'assistant'].includes(message.role)) {
        throw new RAGError(
          `Message at index ${index} must have a valid role (system, user, or assistant)`,
          'INVALID_MESSAGE_ROLE'
        );
      }

      if (!message.content || typeof message.content !== 'string') {
        throw new RAGError(
          `Message at index ${index} must have non-empty string content`,
          'INVALID_MESSAGE_CONTENT'
        );
      }

      if (message.content.length > 100000) {
        throw new RAGError(
          `Message at index ${index} is too long (max 100,000 characters)`,
          'MESSAGE_TOO_LONG'
        );
      }
    }
  }

  /**
   * Merge generation options with defaults
   */
  protected mergeOptions(options: GenerateOptions = {}): GenerateOptions {
    return {
      ...this.defaultOptions,
      ...options,
    };
  }

  /**
   * Estimate token count for messages (rough approximation)
   */
  protected estimateTokenCount(messages: ChatMessage[]): number {
    // Rough estimation: ~4 characters per token for English text
    const totalChars = messages.reduce((sum, msg) => {
      return sum + msg.content.length + msg.role.length + 10; // +10 for formatting
    }, 0);

    return Math.ceil(totalChars / 4);
  }

  /**
   * Check if request would exceed token limits
   */
  protected validateTokenBudget(messages: ChatMessage[], options: GenerateOptions): void {
    const estimatedInputTokens = this.estimateTokenCount(messages);
    const maxOutputTokens = options.max_tokens || this.defaultOptions.max_tokens || 1500;
    
    const totalEstimated = estimatedInputTokens + maxOutputTokens;
    
    if (totalEstimated > this.maxTokens) {
      throw new RAGError(
        `Request would exceed token limit: ${totalEstimated} > ${this.maxTokens}`,
        'TOKEN_LIMIT_EXCEEDED',
        {
          estimatedInputTokens,
          maxOutputTokens,
          totalEstimated,
          maxTokens: this.maxTokens,
        }
      );
    }
  }

  /**
   * Clean and prepare response text
   */
  protected cleanResponse(response: string): string {
    return response
      .trim()
      .replace(/\r\n/g, '\n')  // Normalize line endings
      .replace(/\n{3,}/g, '\n\n'); // Limit consecutive newlines
  }

  /**
   * Handle streaming response (to be implemented by subclasses if needed)
   */
  protected async handleStream(
    _messages: ChatMessage[],
    _options: GenerateOptions,
    _onChunk?: (chunk: string) => void
  ): Promise<string> {
    throw new RAGError(
      'Streaming not implemented for this LLM adapter',
      'STREAMING_NOT_IMPLEMENTED'
    );
  }
}

/**
 * Utility functions for LLM operations
 */
export class LLMUtils {
  /**
   * Build a system message for RAG responses
   */
  static buildRAGSystemMessage(
    context: string,
    preferSteps: boolean = false,
    additionalInstructions: string = ''
  ): ChatMessage {
    const baseInstructions = `You are a helpful assistant that provides accurate information about PowerSchool PSSIS-Admin based on the provided documentation context.

IMPORTANT INSTRUCTIONS:
1. Always start your response with a brief 1-line summary
2. Use ONLY the information provided in the context below
3. If the context doesn't contain relevant information, say "I couldn't find information about this in the PowerSchool PSSIS-Admin documentation"
4. Format your response in clean markdown with proper headings and structure
5. Include specific references to documentation sections when available
${preferSteps ? '6. Provide step-by-step instructions when explaining procedures or configurations' : '6. Provide clear explanations and overviews of features'}

${additionalInstructions ? `ADDITIONAL INSTRUCTIONS:\n${additionalInstructions}\n` : ''}

CONTEXT DOCUMENTATION:
${context}

Remember: Base your response only on the provided context and always maintain a professional, helpful tone.`;

    return {
      role: 'system',
      content: baseInstructions,
    };
  }

  /**
   * Build user message for query
   */
  static buildUserMessage(query: string, preferSteps: boolean = false): ChatMessage {
    const stepInstruction = preferSteps ? ' Please provide step-by-step instructions if this involves a procedure or configuration.' : '';
    
    return {
      role: 'user',
      content: `${query}${stepInstruction}`,
    };
  }

  /**
   * Extract and parse structured response
   */
  static parseRAGResponse(response: string): {
    summary: string;
    answer: string;
    steps?: string[];
  } {
    const lines = response.split('\n');
    
    // Extract summary (first meaningful line)
    let summary = '';
    let answerStartIndex = 0;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]?.trim();
      if (line && !line.startsWith('#') && !line.startsWith('*')) {
        summary = line;
        answerStartIndex = i + 1;
        break;
      }
    }

    if (!summary) {
      // Fallback: use first 100 characters as summary
      summary = response.substring(0, 100).replace(/\n/g, ' ').trim() + '...';
    }

    // Extract full answer
    const answer = lines.slice(answerStartIndex).join('\n').trim() || response;

    // Try to extract steps if present
    const steps: string[] = [];
    const stepRegex = /^\s*\d+\.\s+(.+)$/gm;
    let match;
    
    while ((match = stepRegex.exec(answer)) !== null) {
      steps.push(match[1]?.trim() || '');
    }

    return {
      summary: summary.replace(/^(Summary:|Overview:)\s*/i, ''),
      answer,
      ...(steps.length > 0 && { steps }),
    };
  }

  /**
   * Count tokens more accurately (simplified version)
   */
  static countTokens(text: string): number {
    // More sophisticated token counting - still approximation
    // In production, use tiktoken or similar library
    // More sophisticated token counting - still approximation
    // In production, use tiktoken or similar library
    const avgCharsPerToken = 4;
    const punctuationCount = (text.match(/[.,!?;:]/g) || []).length;
    
    return Math.ceil((text.length + punctuationCount) / avgCharsPerToken);
  }

  /**
   * Truncate messages to fit within token budget
   */
  static truncateMessages(
    messages: ChatMessage[],
    maxTokens: number,
    reserveTokensForResponse: number = 1500
  ): ChatMessage[] {
    const budget = maxTokens - reserveTokensForResponse;
    const truncatedMessages: ChatMessage[] = [];
    let currentTokens = 0;

    // Always keep system message if present
    if (messages.length > 0 && messages[0]?.role === 'system') {
      const systemTokens = LLMUtils.countTokens(messages[0].content);
      truncatedMessages.push(messages[0]);
      currentTokens += systemTokens;
    }

    // Add messages from the end (most recent first) until we hit budget
    for (let i = messages.length - 1; i >= (messages[0]?.role === 'system' ? 1 : 0); i--) {
      const message = messages[i];
      if (!message) continue;
      
      const messageTokens = LLMUtils.countTokens(message.content);
      
      if (currentTokens + messageTokens <= budget) {
        truncatedMessages.splice(messages[0]?.role === 'system' ? 1 : 0, 0, message);
        currentTokens += messageTokens;
      } else {
        break;
      }
    }

    return truncatedMessages;
  }
}

/**
 * Factory for creating LLM adapters
 */
export class LLMAdapterFactory {
  /**
   * Create an LLM adapter based on provider and configuration
   */
  static async create(
    provider: 'openai' | 'openrouter' | 'anthropic' | 'bedrock' | 'local',
    options: {
      apiKey?: string;
      model?: string;
      baseUrl?: string;
      maxTokens?: number;
      accessKeyId?: string;
      secretAccessKey?: string;
      sessionToken?: string;
      region?: string;
    } = {}
  ): Promise<LLMAdapter> {
    switch (provider) {
      case 'openai':
        // Dynamic import with full path
        const openaiModule = await import('@/adapters/llm/openai');
        return new openaiModule.OpenAILLMAdapter(options);

      case 'openrouter':
        const openrouterModule = await import('@/adapters/llm/openrouter');
        return new openrouterModule.OpenRouterLLMAdapter(options);

      case 'anthropic':
        const anthropicModule = await import('@/adapters/llm/anthropic');
        return new anthropicModule.AnthropicLLMAdapter(options);

      case 'bedrock':
        const bedrockModule = await import('@/adapters/llm/bedrock');
        return new bedrockModule.BedrockLLMAdapter(options);

      case 'local':
        const localModule = await import('@/adapters/llm/local');
        return new localModule.LocalLLMAdapter(options);

      default:
        throw new RAGError(`Unsupported LLM provider: ${provider}`, 'UNSUPPORTED_LLM_PROVIDER');
    }
  }
}