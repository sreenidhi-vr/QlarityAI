/**
 * Main RAG endpoint for answering PowerSchool PSSIS-Admin questions
 */

import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import type { AskRequest, AskResponse } from '@/types';
import { RAGError } from '@/types';
import config from '@/utils/config';
import { RAGPipeline } from '@/core/rag/ragPipeline';
import { createEmbeddingAdapter } from '@/adapters/embedding';
import { createLLMAdapter } from '@/adapters/llm';
import { PostgresVectorAdapter } from '@/adapters/vector-store/postgres';
import { crawlAndSeed } from '@/core/seeding/crawlAndSeed';

// Global RAG pipeline instance (initialized on first request)
let ragPipeline: RAGPipeline | null = null;

async function askRoute(
  fastify: FastifyInstance,
  _opts: FastifyPluginOptions
): Promise<void> {
  // Request schema validation
  const askRequestSchema = {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        minLength: 1,
        maxLength: config.MAX_QUERY_LENGTH,
        description: 'The question to ask about PowerSchool PSSIS-Admin',
      },
      userId: {
        type: 'string',
        minLength: 1,
        maxLength: 100,
        description: 'Optional user ID for tracking and analytics',
      },
      prefer_steps: {
        type: 'boolean',
        default: false,
        description: 'Whether to prefer step-by-step instructions in the response',
      },
      max_tokens: {
        type: 'number',
        minimum: 100,
        maximum: 4000,
        default: config.MAX_TOKENS,
        description: 'Maximum tokens for the response',
      },
      collection: {
        type: 'string',
        enum: ['pssis-admin', 'schoology'],
        description: 'Filter results to a specific knowledge base collection',
      },
    },
    required: ['query'],
    additionalProperties: false,
  };

  // Response schema
  const askResponseSchema = {
    type: 'object',
    properties: {
      answer: {
        type: 'string',
        description: 'Markdown-formatted answer to the query',
      },
      summary: {
        type: 'string',
        description: '1-2 sentence summary of the answer',
      },
      steps: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional step-by-step instructions',
      },
      citations: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            url: { type: 'string' },
          },
          required: ['title', 'url'],
        },
        description: 'Source citations from PowerSchool documentation',
      },
      retrieved_docs: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            score: { type: 'number' },
            excerpt: { type: 'string' },
          },
          required: ['id', 'score', 'excerpt'],
        },
        description: 'Documents retrieved from the vector store',
      },
      debug_info: {
        type: 'object',
        properties: {
          is_fallback: { type: 'boolean' },
          fallback_reason: { type: 'string' },
          pipeline_stage: { type: 'string' },
          processing_time_ms: { type: 'number' },
          documents_found: { type: 'number' },
          used_mock_embedding: { type: 'boolean' },
        },
        description: 'Debug information about the RAG pipeline execution',
      },
    },
    required: ['answer', 'summary', 'citations', 'retrieved_docs'],
  };

  // Error response schema
  const errorResponseSchema = {
    type: 'object',
    properties: {
      error: { type: 'string' },
      message: { type: 'string' },
      code: { type: 'string' },
      details: { type: 'object' },
    },
    required: ['error', 'message'],
  };

  fastify.post<{ Body: AskRequest; Reply: AskResponse }>(
    '/ask',
    {
      schema: {
        body: askRequestSchema,
        response: {
          200: askResponseSchema,
          400: errorResponseSchema,
          429: errorResponseSchema,
          500: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const startTime = Date.now();
      const { query, userId, prefer_steps = false, max_tokens = config.MAX_TOKENS } = request.body;
      let sanitizedQuery = '';

      try {
        request.log.info({
          query: query.substring(0, 100) + (query.length > 100 ? '...' : ''),
          userId,
          prefer_steps,
          max_tokens,
        }, 'Processing RAG query');

        // Input validation and sanitization
        if (!query?.trim()) {
          throw new RAGError('Query cannot be empty', 'EMPTY_QUERY');
        }

        sanitizedQuery = query.trim();

        // Initialize RAG pipeline on first request
        if (!ragPipeline) {
          request.log.info('Initializing RAG pipeline...');
          
          try {
            // Initialize adapters
            const embeddingAdapter = await createEmbeddingAdapter(
              config.EMBEDDING_PROVIDER,
              { model: config.EMBEDDING_MODEL }
            );
            
            const llmAdapter = await createLLMAdapter(
              config.LLM_PROVIDER,
              { model: config.LLM_MODEL }
            );
            
            const vectorStore = new PostgresVectorAdapter({
              connectionString: config.DATABASE_URL,
              tableName: config.VECTOR_TABLE_NAME,
            });

            // Test vector store connectivity
            const isHealthy = await vectorStore.health();
            if (!isHealthy) {
              throw new RAGError(
                'Vector database is not available or not properly configured',
                'VECTOR_DB_UNHEALTHY'
              );
            }

            ragPipeline = new RAGPipeline(embeddingAdapter, vectorStore, llmAdapter);
            
            request.log.info('RAG pipeline initialized successfully');
          } catch (error) {
            request.log.error({
              error: error instanceof Error ? error.message : 'Unknown initialization error',
              stack: error instanceof Error ? error.stack : undefined,
            }, 'Failed to initialize RAG pipeline');
            
            if (error instanceof RAGError) {
              throw error;
            }
            
            throw new RAGError(
              'RAG pipeline initialization failed',
              'INITIALIZATION_FAILED',
              { originalError: error instanceof Error ? error.message : 'Unknown error' }
            );
          }
        }

        // Process query through RAG pipeline
        const ragOptions = {
          prefer_steps,
          max_tokens,
          top_k: 10,
          context_window_tokens: 3000,
        };

        const response = await ragPipeline.process(sanitizedQuery, ragOptions);
        
        const processingTime = Date.now() - startTime;
        
        request.log.info({
          userId,
          processingTime,
          retrievedDocs: response.retrieved_docs.length,
          hasCitations: response.citations.length > 0,
          hasSteps: Boolean(response.steps),
        }, 'RAG query completed successfully');

        // Track query statistics
        if (userId) {
          request.log.debug({
            userId,
            query: sanitizedQuery.substring(0, 100),
            docsRetrieved: response.retrieved_docs.length,
          }, 'User query tracked');
        }

        return reply.send(response);

      } catch (error) {
        const processingTime = Date.now() - startTime;
        
        if (error instanceof RAGError) {
          request.log.warn({
            error: error.message,
            code: error.code,
            processingTime,
            userId,
            queryLength: sanitizedQuery.length || 0,
          }, 'RAG error occurred');

          // Handle specific error types with appropriate status codes
          if (error.code === 'VECTOR_DB_UNHEALTHY' || error.code === 'DATABASE_CONNECTION_FAILED') {
            return reply.status(503).send({
              error: 'Vector DB not available',
              message: 'The knowledge base is temporarily unavailable. Please try again later.',
              code: 'SERVICE_UNAVAILABLE',
            } as any);
          }

          if (error.code === 'LLM_GENERATION_FAILED' || error.code === 'LLM_GENERATION_ERROR') {
            return reply.status(500).send({
              error: 'LLM request failed',
              message: 'Unable to generate response. Please try again.',
              code: 'LLM_ERROR',
            } as any);
          }

          // Default to 500 for other RAG errors
          return reply.status(500).send({
            error: 'Processing failed',
            message: error.message,
            code: error.code,
          } as any);
        }

        request.log.error({
          error: error instanceof Error ? error.message : 'Unknown error',
          stack: error instanceof Error ? error.stack : undefined,
          processingTime,
          userId,
        }, 'Unexpected error in RAG query');

        return reply.status(500).send({
          error: 'Internal server error',
          message: 'An unexpected error occurred while processing your query.',
          code: 'INTERNAL_ERROR',
        } as any);
      }
    }
  );

  // Admin endpoint for reindexing documents
  fastify.post(
    '/admin/reindex',
    {
      preHandler: async (request, reply) => {
        // Simple API key authentication for admin endpoints
        const apiKey = request.headers['x-api-key'] as string;
        
        if (!apiKey || apiKey !== config.ADMIN_API_KEY) {
          return reply.status(401).send({
            error: 'UNAUTHORIZED',
            message: 'Invalid or missing admin API key',
          });
        }
      },
      schema: {
        headers: {
          type: 'object',
          properties: {
            'x-api-key': { type: 'string' },
          },
          required: ['x-api-key'],
        },
        response: {
          200: {
            type: 'object',
            properties: {
              message: { type: 'string' },
              status: { type: 'string' },
              timestamp: { type: 'string' },
            },
          },
          401: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      request.log.info('Admin reindex triggered');

      // TODO: Implement actual reindexing when crawler is ready
      
      return reply.send({
        message: 'Reindexing initiated successfully',
        status: 'started',
        timestamp: new Date().toISOString(),
      });
    }
  );

  // Admin endpoint for seeding Schoology documentation
  fastify.post(
    '/admin/seed/schoology',
    {
      preHandler: async (request, reply) => {
        // API key authentication for admin endpoints
        const apiKey = request.headers['x-api-key'] as string;
        
        if (!apiKey || apiKey !== config.ADMIN_API_KEY) {
          return reply.status(401).send({
            error: 'UNAUTHORIZED',
            message: 'Invalid or missing admin API key',
          });
        }
      },
      schema: {
        headers: {
          type: 'object',
          properties: {
            'x-api-key': { type: 'string' },
          },
          required: ['x-api-key'],
        },
        response: {
          200: {
            type: 'object',
            properties: {
              status: { type: 'string' },
              message: { type: 'string' },
              pagesCrawled: { type: 'number' },
              chunksInserted: { type: 'number' },
              duration_ms: { type: 'number' },
              errors: {
                type: 'array',
                items: { type: 'string' },
              },
            },
            required: ['status', 'message', 'pagesCrawled', 'chunksInserted', 'duration_ms'],
          },
          401: errorResponseSchema,
          500: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const startTime = Date.now();
      
      request.log.info('Admin Schoology seeding triggered');

      try {
        const result = await crawlAndSeed({
          baseUrl: 'https://uc.powerschool-docs.com/en/schoology/latest/',
          collection: 'schoology',
          maxPages: config.MAX_PAGES,
          delayMs: config.CRAWL_DELAY_MS,
          chunkSize: 4000,
        });

        const processingTime = Date.now() - startTime;
        
        request.log.info({
          success: result.success,
          pagesCrawled: result.pagesCrawled,
          chunksInserted: result.chunksInserted,
          processingTime,
        }, 'Schoology seeding completed');

        if (result.success) {
          return reply.send({
            status: 'success',
            message: result.message,
            pagesCrawled: result.pagesCrawled,
            chunksInserted: result.chunksInserted,
            duration_ms: result.duration_ms,
            ...(result.errors && { errors: result.errors }),
          });
        } else {
          return reply.status(500).send({
            error: 'SEEDING_FAILED',
            message: result.message,
            code: 'CRAWL_AND_SEED_ERROR',
          });
        }

      } catch (error) {
        const processingTime = Date.now() - startTime;
        
        request.log.error({
          error: error instanceof Error ? error.message : 'Unknown error',
          processingTime,
        }, 'Schoology seeding failed with unexpected error');

        return reply.status(500).send({
          error: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred during seeding',
          code: 'UNEXPECTED_SEEDING_ERROR',
        });
      }
    }
  );
}

export default askRoute;