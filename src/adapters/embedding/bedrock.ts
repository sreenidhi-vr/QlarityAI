/**
 * AWS Bedrock embedding adapter implementation
 */

import {
  BedrockRuntimeClient,
  InvokeModelCommand,
  InvokeModelCommandInput,
} from '@aws-sdk/client-bedrock-runtime';
import { fromEnv, fromIni, fromInstanceMetadata } from '@aws-sdk/credential-providers';
import { BaseEmbeddingAdapter } from './base';
import { RAGError } from '@/types';

export interface BedrockEmbeddingOptions {
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
  region?: string;
  model?: string;
  maxRetries?: number;
  timeout?: number;
}

/**
 * AWS Bedrock embedding adapter using Amazon Titan embeddings by default
 */
export class BedrockEmbeddingAdapter extends BaseEmbeddingAdapter {
  private readonly client: BedrockRuntimeClient;
  private readonly maxRetries: number;

  // Model configurations for Bedrock embedding models
  private static readonly MODEL_CONFIGS = {
    'amazon.titan-embed-text-v1': { dimensions: 1536, maxInputLength: 8192 },
    'amazon.titan-embed-text-v2:0': { dimensions: 1024, maxInputLength: 8192 },
    'cohere.embed-english-v3': { dimensions: 1024, maxInputLength: 512 },
    'cohere.embed-multilingual-v3': { dimensions: 1024, maxInputLength: 512 },
  } as const;

  constructor(options: BedrockEmbeddingOptions = {}) {
    const model = options.model || 'amazon.titan-embed-text-v2:0';
    const modelConfig = BedrockEmbeddingAdapter.MODEL_CONFIGS[model as keyof typeof BedrockEmbeddingAdapter.MODEL_CONFIGS];

    if (!modelConfig) {
      throw new RAGError(
        `Unsupported Bedrock embedding model: ${model}`,
        'INVALID_EMBEDDING_MODEL',
        { supportedModels: Object.keys(BedrockEmbeddingAdapter.MODEL_CONFIGS) }
      );
    }

    super(model, modelConfig.dimensions);

    this.maxRetries = options.maxRetries || 3;

    // Initialize Bedrock client with improved credential handling
    const region = options.region || process.env.AWS_REGION || 'us-east-1';
    
    let credentials;
    if (options.accessKeyId && options.secretAccessKey) {
      // Use explicit credentials
      credentials = {
        accessKeyId: options.accessKeyId,
        secretAccessKey: options.secretAccessKey,
        ...(options.sessionToken && { sessionToken: options.sessionToken }),
      };
      console.debug('[Bedrock Auth] Using explicit credentials');
    } else {
      // Use comprehensive AWS credential chain
      console.debug('[Bedrock Auth] Using AWS credential chain...');
      
      // Try credentials in order of precedence
      try {
        // First try environment variables
        credentials = fromEnv();
        console.debug('[Bedrock Auth] Using environment variables');
      } catch {
        try {
          // Then try AWS credentials file (~/.aws/credentials)
          credentials = fromIni();
          console.debug('[Bedrock Auth] Using AWS credentials file');
        } catch {
          // Finally try EC2 instance metadata (for AWS environments)
          credentials = fromInstanceMetadata();
          console.debug('[Bedrock Auth] Using instance metadata');
        }
      }
    }

    this.client = new BedrockRuntimeClient({
      region,
      credentials,
      maxAttempts: this.maxRetries,
    });

    console.debug(`[Bedrock Auth] Initialized client for region: ${region}`);
  }

  /**
   * Embed a single text string using Bedrock
   */
  async embed(text: string): Promise<number[]> {
    this.validateText(text);
    const preprocessedText = this.preprocessText(text);

    try {
      let requestBody: any;
      let responseKey: string;

      // Different models have different request formats
      if (this.model.startsWith('amazon.titan-embed')) {
        requestBody = {
          inputText: preprocessedText,
        };
        responseKey = 'embedding';
      } else if (this.model.startsWith('cohere.embed')) {
        requestBody = {
          texts: [preprocessedText],
          input_type: 'search_document',
        };
        responseKey = 'embeddings';
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
          'EMPTY_EMBEDDING_RESPONSE'
        );
      }

      // Parse response
      const responseText = new TextDecoder().decode(response.body);
      const responseJson = JSON.parse(responseText);

      let embedding: number[];

      if (this.model.startsWith('amazon.titan-embed')) {
        embedding = responseJson[responseKey];
      } else if (this.model.startsWith('cohere.embed')) {
        embedding = responseJson[responseKey]?.[0];
      } else {
        throw new RAGError(
          'Unexpected response format from Bedrock',
          'INVALID_EMBEDDING_RESPONSE'
        );
      }

      if (!embedding || !Array.isArray(embedding) || embedding.length === 0) {
        throw new RAGError(
          'Invalid embedding vector received from Bedrock',
          'INVALID_EMBEDDING_VECTOR'
        );
      }

      return this.postprocessEmbedding(embedding);

    } catch (error) {
      if (error instanceof RAGError) {
        throw error;
      }

      // Handle AWS SDK errors with improved guidance
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
        
        if (awsError.name === 'UnrecognizedClientException') {
          console.error('[Bedrock Auth] Invalid AWS credentials detected');
          console.error('[Bedrock Auth] Fix: Update AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY in .env');
          console.error('[Bedrock Auth] Or run: aws configure');
          
          throw new RAGError(
            'AWS credentials are invalid or expired. Please update your AWS credentials.',
            'BEDROCK_INVALID_CREDENTIALS',
            {
              originalError: awsError,
              fixSuggestions: [
                'Update AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY in .env file',
                'Run "aws configure" to set up credentials',
                'Ensure credentials have bedrock:InvokeModel permissions',
                'Check if using temporary credentials that may have expired'
              ]
            }
          );
        }
        
        if (awsError.name === 'ThrottlingException') {
          throw new RAGError(
            'Bedrock API throttling limit exceeded. Please retry later.',
            'BEDROCK_THROTTLING',
            { originalError: awsError }
          );
        }
      }

      throw new RAGError(
        `Failed to generate embedding: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'EMBEDDING_GENERATION_FAILED',
        { originalError: error }
      );
    }
  }

  /**
   * Embed multiple texts in batch for efficiency
   */
  async embedBatch(texts: string[]): Promise<number[][]> {
    this.validateBatch(texts);

    // Bedrock embedding APIs don't always support true batching
    // For Cohere models, we can batch up to a certain limit
    if (this.model.startsWith('cohere.embed')) {
      return this.processCohereEmbedBatch(texts);
    }

    // For Titan models, process individually
    const results: number[][] = [];
    for (const text of texts) {
      const embedding = await this.embed(text);
      results.push(embedding);
    }

    return results;
  }

  /**
   * Process batch for Cohere embedding models
   */
  private async processCohereEmbedBatch(texts: string[]): Promise<number[][]> {
    const batchSize = 96; // Cohere batch limit
    const results: number[][] = [];

    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const preprocessedTexts = batch.map(text => this.preprocessText(text));

      try {
        const requestBody = {
          texts: preprocessedTexts,
          input_type: 'search_document',
        };

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
            'No response body returned from Bedrock batch request',
            'EMPTY_BATCH_RESPONSE'
          );
        }

        const responseText = new TextDecoder().decode(response.body);
        const responseJson = JSON.parse(responseText);

        if (!responseJson.embeddings || !Array.isArray(responseJson.embeddings)) {
          throw new RAGError(
            'Invalid batch embedding response from Bedrock',
            'INVALID_BATCH_RESPONSE'
          );
        }

        if (responseJson.embeddings.length !== batch.length) {
          throw new RAGError(
            `Embedding count mismatch: expected ${batch.length}, got ${responseJson.embeddings.length}`,
            'EMBEDDING_COUNT_MISMATCH'
          );
        }

        const batchResults = responseJson.embeddings.map((embedding: number[], index: number) => {
          if (!embedding || !Array.isArray(embedding) || embedding.length === 0) {
            throw new RAGError(
              `Invalid embedding vector at batch index ${index}`,
              'INVALID_EMBEDDING_VECTOR',
              { index }
            );
          }
          return this.postprocessEmbedding(embedding);
        });

        results.push(...batchResults);

      } catch (error) {
        if (error instanceof RAGError) {
          throw error;
        }

        throw new RAGError(
          `Failed to generate batch embeddings: ${error instanceof Error ? error.message : 'Unknown error'}`,
          'BATCH_EMBEDDING_FAILED',
          { 
            batchSize: batch.length,
            originalError: error,
          }
        );
      }
    }

    return results;
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
    maxInputLength: number;
    provider: string;
  } {
    const modelConfig = BedrockEmbeddingAdapter.MODEL_CONFIGS[this.model as keyof typeof BedrockEmbeddingAdapter.MODEL_CONFIGS];
    
    return {
      model: this.model,
      dimensions: this.dimensions,
      maxInputLength: modelConfig.maxInputLength,
      provider: 'aws-bedrock',
    };
  }

  /**
   * Get usage statistics from the client (if available)
   */
  getUsageStats(): { requestCount: number; tokenCount: number } | null {
    // AWS doesn't provide usage stats through the SDK
    return null;
  }
}