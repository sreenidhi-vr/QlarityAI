/**
 * LLM client wrapper for RAG pipeline
 * Handles LLM interactions with structured prompts and response parsing
 */

import type { LLMAdapter, ChatMessage, GenerateOptions } from '@/types';
import { RAGError } from '@/types';

export interface LLMGenerationOptions extends GenerateOptions {
  retries?: number;
  timeoutMs?: number;
}

export interface LLMResult {
  response: string;
  generationTimeMs: number;
  tokenCount: number;
  model: string;
}

export interface ParsedResponse {
  summary: string;
  steps?: string[];
  fullAnswer: string;
}

export class LLMClient {
  constructor(
    private llmAdapter: LLMAdapter
  ) {}

  /**
   * Generate response using the LLM with RAG context
   */
  async generate(
    systemPrompt: string,
    userPrompt: string,
    options: LLMGenerationOptions = {}
  ): Promise<LLMResult> {
    const startTime = Date.now();

    try {
      const {
        max_tokens = 1500,
        temperature = 0.1, // Lower temperature for more consistent responses
        top_p = 0.9,
        retries = 2,
        timeoutMs = 30000,
      } = options;

      const messages: ChatMessage[] = [
        {
          role: 'system',
          content: systemPrompt,
        },
        {
          role: 'user',
          content: userPrompt,
        },
      ];

      let lastError: Error | null = null;
      let response: string | null = null;

      console.debug('[LLM Client] Starting LLM generation', {
        model: this.llmAdapter.getModel(),
        maxTokens: max_tokens,
        temperature,
        retries,
        timeoutMs,
        systemPromptLength: systemPrompt.length,
        userPromptLength: userPrompt.length
      });

      // Retry logic for robustness
      for (let attempt = 0; attempt <= retries; attempt++) {
        try {
          console.debug(`[LLM Client] Generation attempt ${attempt + 1}/${retries + 1}`, {
            attempt: attempt + 1,
            timeoutMs
          });

          // Create timeout promise
          const timeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error('LLM request timeout')), timeoutMs);
          });

          // Race between LLM generation and timeout
          const generationPromise = this.llmAdapter.generate(messages, {
            max_tokens,
            temperature,
            top_p,
          });

          response = await Promise.race([generationPromise, timeoutPromise]);
          
          console.debug('[LLM Client] Generation successful', {
            attempt: attempt + 1,
            responseLength: response.length,
            responsePreview: response.substring(0, 200) + '...'
          });
          
          break; // Success, exit retry loop

        } catch (error) {
          lastError = error instanceof Error ? error : new Error('Unknown LLM error');
          
          console.warn(`[LLM Client] Generation attempt ${attempt + 1} failed`, {
            attempt: attempt + 1,
            error: lastError.message,
            errorType: lastError.constructor.name,
            willRetry: attempt < retries
          });
          
          if (attempt < retries) {
            const backoffMs = Math.pow(2, attempt) * 1000;
            console.debug(`[LLM Client] Waiting ${backoffMs}ms before retry...`);
            // Wait before retry with exponential backoff
            await new Promise(resolve => setTimeout(resolve, backoffMs));
          }
        }
      }

      if (!response) {
        console.error('[LLM Client] All generation attempts failed', {
          totalAttempts: retries + 1,
          finalError: lastError?.message,
          model: this.llmAdapter.getModel()
        });

        throw new RAGError(
          `LLM generation failed after ${retries + 1} attempts: ${lastError?.message || 'Unknown error'}`,
          'LLM_GENERATION_FAILED',
          {
            attempts: retries + 1,
            originalError: lastError,
            model: this.llmAdapter.getModel(),
          }
        );
      }

      const generationTime = Date.now() - startTime;

      // Estimate token count (rough approximation: 4 chars = 1 token)
      const tokenCount = Math.ceil(response.length / 4);

      console.debug('[LLM Client] Generation completed successfully', {
        generationTimeMs: generationTime,
        responseLength: response.length,
        estimatedTokens: tokenCount,
        model: this.llmAdapter.getModel(),
        responseStartsWith: response.substring(0, 50) + '...'
      });

      // Check for suspicious responses that might indicate issues
      const suspiciousPatterns = [
        'Create a fallback response',
        'I cannot',
        'I don\'t have',
        'No information available',
        'Unable to process'
      ];

      for (const pattern of suspiciousPatterns) {
        if (response.toLowerCase().includes(pattern.toLowerCase())) {
          console.warn('[LLM Client] Potentially problematic response detected', {
            suspiciousPattern: pattern,
            responsePreview: response.substring(0, 300)
          });
        }
      }

      return {
        response: response.trim(),
        generationTimeMs: generationTime,
        tokenCount,
        model: this.llmAdapter.getModel(),
      };

    } catch (error) {
      const generationTime = Date.now() - startTime;
      
      console.error('[LLM Client] Generation failed with unexpected error', {
        error: error instanceof Error ? error.message : 'Unknown error',
        errorType: error instanceof Error ? error.constructor.name : typeof error,
        generationTimeMs: generationTime,
        model: this.llmAdapter.getModel(),
        stack: error instanceof Error ? error.stack : undefined
      });

      if (error instanceof RAGError) {
        throw error;
      }

      throw new RAGError(
        `LLM generation error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'LLM_GENERATION_ERROR',
        {
          model: this.llmAdapter.getModel(),
          originalError: error,
          generationTimeMs: generationTime
        }
      );
    }
  }

  /**
   * Parse steps from LLM response
   */
  parseSteps(response: string): string[] {
    const steps: string[] = [];
    
    // Look for numbered lists in the response
    const numberedStepRegex = /^\s*(\d+)\.\s*(.+)$/gm;
    let match;

    while ((match = numberedStepRegex.exec(response)) !== null) {
      const stepText = match[2]?.trim();
      if (stepText) {
        steps.push(stepText);
      }
    }

    // If no numbered steps found, try to extract from bullet points
    if (steps.length === 0) {
      const bulletStepRegex = /^\s*[-*]\s*(.+)$/gm;
      while ((match = bulletStepRegex.exec(response)) !== null) {
        const stepText = match[1]?.trim();
        if (stepText && this.looksLikeStep(stepText)) {
          steps.push(stepText);
        }
      }
    }

    return steps;
  }

  /**
   * Extract summary from LLM response
   */
  parseSummary(response: string): string {
    // Look for summary section
    const summaryMatch = response.match(/##\s*Summary\s*\n\n?(.+?)(?=\n##|\n\n|$)/is);
    if (summaryMatch && summaryMatch[1]) {
      return summaryMatch[1].trim();
    }

    // Look for first sentence as fallback
    const firstSentenceMatch = response.match(/^([^.!?]*[.!?])/);
    if (firstSentenceMatch && firstSentenceMatch[1]) {
      return firstSentenceMatch[1].trim();
    }

    // Return first 200 characters as last resort
    return response.substring(0, 200).trim() + '...';
  }

  /**
   * Parse the complete response structure
   */
  parseResponse(response: string): ParsedResponse {
    const summary = this.parseSummary(response);
    const steps = this.parseSteps(response);

    const result: ParsedResponse = {
      summary,
      fullAnswer: response,
    };

    if (steps.length > 0) {
      result.steps = steps;
    }

    return result;
  }

  /**
   * Validate response quality
   */
  validateResponse(response: string, minLength: number = 50): {
    valid: boolean;
    issues: string[];
  } {
    const issues: string[] = [];

    // Check minimum length
    if (response.length < minLength) {
      issues.push(`Response too short (${response.length} chars, minimum ${minLength})`);
    }

    // Check for markdown formatting
    if (!response.includes('#') && !response.includes('##')) {
      issues.push('Response lacks proper markdown headings');
    }

    // Check for placeholder text that suggests incomplete processing
    const placeholders = ['TODO', 'TBD', '[placeholder]', '...'];
    for (const placeholder of placeholders) {
      if (response.toLowerCase().includes(placeholder.toLowerCase())) {
        issues.push(`Response contains placeholder text: ${placeholder}`);
      }
    }

    // Check for error indicators
    const errorIndicators = ['I cannot', 'I don\'t know', 'error occurred'];
    for (const indicator of errorIndicators) {
      if (response.toLowerCase().includes(indicator.toLowerCase())) {
        issues.push(`Response indicates generation issues: ${indicator}`);
      }
    }

    return {
      valid: issues.length === 0,
      issues,
    };
  }

  /**
   * Clean and format the response
   */
  cleanResponse(response: string): string {
    return response
      // Remove excessive whitespace
      .replace(/\n{3,}/g, '\n\n')
      // Fix markdown formatting issues
      .replace(/#{4,}/g, '###')
      // Ensure proper spacing around headings
      .replace(/\n##/g, '\n\n##')
      // Clean up list formatting
      .replace(/^\s*[\d]+\.\s+/gm, match => match.trim() + ' ')
      .trim();
  }

  /**
   * Get LLM adapter information
   */
  getAdapterInfo(): {
    model: string;
    maxTokens: number;
  } {
    return {
      model: this.llmAdapter.getModel(),
      maxTokens: this.llmAdapter.getMaxTokens(),
    };
  }

  /**
   * Check if text looks like a step instruction
   */
  private looksLikeStep(text: string): boolean {
    const stepIndicators = [
      'navigate to',
      'click on',
      'select',
      'enter',
      'choose',
      'go to',
      'open',
      'access',
      'configure',
      'set up',
    ];

    const lowerText = text.toLowerCase();
    return stepIndicators.some(indicator => lowerText.includes(indicator));
  }
}