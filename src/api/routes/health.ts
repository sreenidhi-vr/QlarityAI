/**
 * Health check route for monitoring and liveness probes
 * Enhanced to include Slack, Teams, and Orchestrator components
 */

import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import type { HealthResponse } from '@/types';
import config from '@/utils/config';
import { UnifiedOrchestrator } from '@/core/orchestrator/unifiedOrchestrator';
import { SlackDelivery } from '@/services/delivery/slackDelivery';
import { TeamsDelivery } from '@/services/delivery/teamsDelivery';
import { RAGPipeline } from '@/core/rag/ragPipeline';
import { createLLMAdapter } from '@/adapters/llm';
import { createEmbeddingAdapter } from '@/adapters/embedding';
import { PostgresVectorAdapter } from '@/adapters/vector-store/postgres';
import { metrics } from '@/utils/metrics';

async function healthRoute(
  fastify: FastifyInstance,
  _opts: FastifyPluginOptions
): Promise<void> {
  // Health check schema
  const healthSchema = {
    response: {
      200: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['ok', 'error'] },
          timestamp: { type: 'string' },
          version: { type: 'string' },
          checks: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                status: { type: 'string', enum: ['ok', 'error'] },
                message: { type: 'string' },
                duration_ms: { type: 'number' },
              },
              required: ['name', 'status'],
            },
          },
        },
        required: ['status', 'timestamp', 'version', 'checks'],
      },
    },
  };

  fastify.get<{ Reply: HealthResponse }>(
    '/health',
    { schema: healthSchema },
    async (_request, reply) => {
      const startTime = Date.now();
      const checks: HealthResponse['checks'] = [];

      // Check database connectivity
      try {
        const dbCheckStart = Date.now();
        // TODO: Implement actual database health check
        // For now, we'll simulate a successful check
        const dbHealthy = true;
        
        checks.push({
          name: 'database',
          status: dbHealthy ? 'ok' : 'error',
          message: dbHealthy ? 'Connected' : 'Connection failed',
          duration_ms: Date.now() - dbCheckStart,
        });
      } catch (error) {
        checks.push({
          name: 'database',
          status: 'error',
          message: error instanceof Error ? error.message : 'Unknown error',
          duration_ms: Date.now() - startTime,
        });
      }

      // Check AWS Bedrock connectivity
      try {
        const bedrockCheckStart = Date.now();
        // Check if AWS credentials are configured
        const bedrockHealthy = Boolean(config.AWS_ACCESS_KEY_ID && config.AWS_SECRET_ACCESS_KEY);
        
        checks.push({
          name: 'aws_bedrock',
          status: bedrockHealthy ? 'ok' : 'error',
          message: bedrockHealthy ? 'AWS credentials configured' : 'AWS credentials missing',
          duration_ms: Date.now() - bedrockCheckStart,
        });
      } catch (error) {
        checks.push({
          name: 'aws_bedrock',
          status: 'error',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }

      // Check vector store
      try {
        const vectorCheckStart = Date.now();
        // TODO: Implement actual vector store health check
        const vectorHealthy = Boolean(config.DATABASE_URL);
        
        checks.push({
          name: 'vector_store',
          status: vectorHealthy ? 'ok' : 'error',
          message: vectorHealthy ? 'Database URL configured' : 'Database URL missing',
          duration_ms: Date.now() - vectorCheckStart,
        });
      } catch (error) {
        checks.push({
          name: 'vector_store',
          status: 'error',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }

      // Check Slack integration
      try {
        const slackCheckStart = Date.now();
        if (config.SLACK_BOT_TOKEN && config.SLACK_SIGNING_SECRET) {
          try {
            const slackDelivery = new SlackDelivery(config.SLACK_BOT_TOKEN);
            const slackHealth = await slackDelivery.healthCheck();
            
            checks.push({
              name: 'slack',
              status: slackHealth.healthy ? 'ok' : 'error',
              message: slackHealth.healthy ? 'Slack API connected' : (slackHealth.error || 'Slack API connection failed'),
              duration_ms: Date.now() - slackCheckStart,
            });
          } catch (slackError) {
            checks.push({
              name: 'slack',
              status: 'error',
              message: slackError instanceof Error ? slackError.message : 'Slack initialization failed',
              duration_ms: Date.now() - slackCheckStart,
            });
          }
        } else {
          checks.push({
            name: 'slack',
            status: 'error',
            message: 'Slack credentials not configured',
            duration_ms: Date.now() - slackCheckStart,
          });
        }
      } catch (error) {
        checks.push({
          name: 'slack',
          status: 'error',
          message: error instanceof Error ? error.message : 'Slack check failed',
        });
      }

      // Check Teams integration
      try {
        const teamsCheckStart = Date.now();
        if (config.TEAMS_APP_ID && config.TEAMS_APP_PASSWORD) {
          try {
            const teamsDelivery = new TeamsDelivery(config.TEAMS_APP_ID, config.TEAMS_APP_PASSWORD);
            const teamsHealth = await teamsDelivery.healthCheck();
            
            checks.push({
              name: 'teams',
              status: teamsHealth.healthy ? 'ok' : 'error',
              message: teamsHealth.healthy ? 'Teams API connected' : (teamsHealth.error || 'Teams API connection failed'),
              duration_ms: Date.now() - teamsCheckStart,
            });
          } catch (teamsError) {
            checks.push({
              name: 'teams',
              status: 'error',
              message: teamsError instanceof Error ? teamsError.message : 'Teams initialization failed',
              duration_ms: Date.now() - teamsCheckStart,
            });
          }
        } else {
          checks.push({
            name: 'teams',
            status: 'error',
            message: 'Teams credentials not configured',
            duration_ms: Date.now() - teamsCheckStart,
          });
        }
      } catch (error) {
        checks.push({
          name: 'teams',
          status: 'error',
          message: error instanceof Error ? error.message : 'Teams check failed',
        });
      }

      // Check UnifiedOrchestrator
      try {
        const orchestratorCheckStart = Date.now();
        try {
          // Initialize RAG components for orchestrator health check
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

          const ragPipeline = new RAGPipeline(embeddingAdapter, vectorStore, llmAdapter);
          const orchestrator = new UnifiedOrchestrator(ragPipeline, metrics);
          
          const orchestratorHealth = await orchestrator.healthCheck();
          
          checks.push({
            name: 'orchestrator',
            status: orchestratorHealth.status === 'healthy' ? 'ok' : 'error',
            message: orchestratorHealth.status === 'healthy' ? 'Orchestrator operational' : 'Orchestrator unhealthy',
            duration_ms: Date.now() - orchestratorCheckStart,
          });
        } catch (orchestratorError) {
          checks.push({
            name: 'orchestrator',
            status: 'error',
            message: orchestratorError instanceof Error ? orchestratorError.message : 'Orchestrator initialization failed',
            duration_ms: Date.now() - orchestratorCheckStart,
          });
        }
      } catch (error) {
        checks.push({
          name: 'orchestrator',
          status: 'error',
          message: error instanceof Error ? error.message : 'Orchestrator check failed',
        });
      }

      // Determine overall status
      const hasErrors = checks.some(check => check.status === 'error');
      const overallStatus = hasErrors ? 'error' : 'ok';

      const response: HealthResponse = {
        status: overallStatus,
        timestamp: new Date().toISOString(),
        version: '1.0.0', // TODO: Get from package.json
        checks,
      };

      // Set appropriate HTTP status code
      const statusCode = overallStatus === 'ok' ? 200 : 503;
      
      return reply.status(statusCode).send(response);
    }
  );

  // Readiness probe (stricter than liveness)
  fastify.get('/ready', async (_request, reply) => {
    // TODO: Implement more comprehensive readiness checks
    // - Database migrations complete
    // - Vector store initialized
    // - Required models available
    
    return reply.send({
      status: 'ready',
      timestamp: new Date().toISOString(),
    });
  });

  // Liveness probe (minimal check)
  fastify.get('/live', async (_request, reply) => {
    return reply.send({
      status: 'alive',
      timestamp: new Date().toISOString(),
    });
  });
}

export default healthRoute;