/**
 * Main application entry point with Unified Slack + Teams Integration
 * Configures Fastify server with both Slack and Teams routes using shared RAG orchestration
 */

import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import formbody from '@fastify/formbody';
import compress from '@fastify/compress';

import configObject, { validateConfig } from '@/utils/config';
import type { Environment } from '@/types';

// Explicitly type the config for better type safety
const config: Environment = configObject;

// Import routes
import slackRoute from '@/api/routes/slack';
import teamsRoute from '@/api/routes/teams';

// Import existing routes (maintain backward compatibility)
import askRoute from '@/api/routes/ask';
import healthRoute from '@/api/routes/health';

// Import metrics for monitoring
import { metrics } from '@/utils/metrics';

// Validate configuration on startup
const configValidation = validateConfig();
if (!configValidation.success) {
  console.error('Configuration validation failed:');
  configValidation.errors?.forEach(error => console.error(`  - ${error}`));
  process.exit(1);
}

console.log('✅ Configuration validated successfully');

// Create Fastify instance with logging
const loggerOptions = config.NODE_ENV === 'development' ? {
  level: config.LOG_LEVEL,
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      ignore: 'hostname,pid',
      translateTime: 'HH:MM:ss.l'
    }
  }
} : {
  level: config.LOG_LEVEL
};

const fastify = Fastify({
  logger: loggerOptions
});

// Register middleware plugins
async function registerMiddleware() {
  // CORS - allow cross-origin requests
  await fastify.register(cors, {
    origin: config.NODE_ENV === 'production' ? false : true,
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Slack-Signature', 'X-Slack-Request-Timestamp']
  });

  // Security headers
  await fastify.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'", "https:"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        mediaSrc: ["'self'"],
        frameSrc: ["'none'"]
      }
    }
  });

  // Rate limiting
  await fastify.register(rateLimit, {
    max: config.RATE_LIMIT_PER_MIN,
    timeWindow: '1 minute',
    allowList: ['127.0.0.1'], // Allow localhost for health checks
    addHeaders: {
      'x-ratelimit-limit': true,
      'x-ratelimit-remaining': true,
      'x-ratelimit-reset': true
    }
  });

  // Form body parser for Slack webhooks
  await fastify.register(formbody);

  // Response compression
  await fastify.register(compress, {
    encodings: ['gzip', 'deflate']
  });

  fastify.log.info('✅ Middleware registered successfully');
}

// Register API routes
async function registerRoutes() {
  // Health check route (always available)
  await fastify.register(healthRoute, { prefix: '/api' });

  // Legacy ask route (maintain backward compatibility)
  await fastify.register(askRoute, { prefix: '/api' });

  // Unified Slack routes (new implementation)
  if (config.SLACK_BOT_TOKEN && config.SLACK_SIGNING_SECRET) {
    await fastify.register(slackRoute, { prefix: '/api' });
    fastify.log.info('✅ Slack routes registered');
  } else {
    fastify.log.warn('⚠️  Slack integration disabled - missing SLACK_BOT_TOKEN or SLACK_SIGNING_SECRET');
  }

  // Teams routes
  if (config.TEAMS_APP_ID && config.TEAMS_APP_PASSWORD) {
    await fastify.register(teamsRoute, { prefix: '/api' });
    fastify.log.info('✅ Teams routes registered');
  } else {
    fastify.log.warn('⚠️  Teams integration disabled - missing TEAMS_APP_ID or TEAMS_APP_PASSWORD');
  }

  // Metrics endpoint
  fastify.get('/api/metrics', async (_request) => {
    const snapshot = metrics.getSnapshot();
    return {
      timestamp: snapshot.timestamp,
      uptime: snapshot.uptime,
      counters: snapshot.counters,
      durations: snapshot.durations,
      summary: metrics.getSummary()
    };
  });

  // Root endpoint with integration status
  fastify.get('/', async (_request) => {
    const integrations = {
      slack: !!(config.SLACK_BOT_TOKEN && config.SLACK_SIGNING_SECRET),
      teams: !!(config.TEAMS_APP_ID && config.TEAMS_APP_PASSWORD),
      n8n: !!config.N8N_WEBHOOK_URL
    };

    return {
      name: 'PowerSchool RAG API with Unified Integration',
      version: '2.0.0',
      timestamp: new Date().toISOString(),
      environment: config.NODE_ENV,
      integrations,
      features: {
        unifiedOrchestration: true,
        crossPlatformDeduplication: true,
        sharedRAGPipeline: true,
        adaptiveFormatting: true,
        fallbackDelivery: true,
        metricsAndTelemetry: true
      },
      endpoints: {
        health: '/api/health',
        metrics: '/api/metrics',
        ask: '/api/ask',
        ...(integrations.slack && {
          slack: {
            events: '/api/slack/events',
            commands: '/api/slack/command',
            actions: '/api/slack/actions',
            health: '/api/slack/health'
          }
        }),
        ...(integrations.teams && {
          teams: {
            messages: '/api/teams/messages',
            health: '/api/teams/health'
          }
        })
      }
    };
  });

  fastify.log.info('✅ API routes registered successfully');
}

// Error handling
function setupErrorHandling() {
  // Global error handler
  fastify.setErrorHandler(async (error, request, reply) => {
    fastify.log.error({
      error: {
        name: error.name,
        message: error.message,
        stack: error.stack
      },
      request: {
        method: request.method,
        url: request.url,
        headers: {
          'user-agent': request.headers['user-agent'],
          'content-type': request.headers['content-type']
        }
      }
    }, 'Unhandled error occurred');

    // Track error metrics
    metrics.incrementCounter('server_errors_total', {
      error_type: error.name,
      status_code: reply.statusCode.toString()
    });

    // Return appropriate error response
    const statusCode = error.statusCode || 500;
    const message = config.NODE_ENV === 'production' 
      ? 'Internal server error' 
      : error.message;

    reply.status(statusCode).send({
      error: error.name || 'InternalServerError',
      message,
      timestamp: new Date().toISOString(),
      ...(config.NODE_ENV === 'development' && { stack: error.stack })
    });
  });

  // 404 handler
  fastify.setNotFoundHandler(async (request, reply) => {
    reply.status(404).send({
      error: 'NotFound',
      message: `Route ${request.method} ${request.url} not found`,
      timestamp: new Date().toISOString()
    });
  });

  fastify.log.info('✅ Error handling configured');
}

// Graceful shutdown handling
function setupGracefulShutdown() {
  const gracefulShutdown = async (signal: string) => {
    fastify.log.info(`Received ${signal}, starting graceful shutdown...`);
    
    try {
      // Log final metrics
      const summary = metrics.getSummary();
      fastify.log.info({ metrics: summary }, 'Final metrics before shutdown');
      
      await fastify.close();
      fastify.log.info('✅ Server closed successfully');
      process.exit(0);
    } catch (error) {
      fastify.log.error({ error }, '❌ Error during shutdown');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  
  // Handle uncaught exceptions
  process.on('uncaughtException', (error) => {
    fastify.log.fatal({ error }, 'Uncaught exception occurred');
    metrics.incrementCounter('server_crashes_total', { reason: 'uncaught_exception' });
    process.exit(1);
  });

  process.on('unhandledRejection', (reason, promise) => {
    fastify.log.fatal({ reason, promise }, 'Unhandled promise rejection');
    metrics.incrementCounter('server_crashes_total', { reason: 'unhandled_rejection' });
    process.exit(1);
  });

  fastify.log.info('✅ Graceful shutdown handlers configured');
}

// Initialize and start server
async function start() {
  try {
    console.log('🚀 Starting PowerSchool RAG API with Unified Integration...');
    
    // Setup phases
    await registerMiddleware();
    await registerRoutes();
    setupErrorHandling();
    setupGracefulShutdown();

    // Start server
    const address = await fastify.listen({
      port: config.PORT,
      host: '0.0.0.0' // Listen on all interfaces for Docker compatibility
    });

    // Log startup information
    const integrationStatus = {
      slack: !!(config.SLACK_BOT_TOKEN && config.SLACK_SIGNING_SECRET),
      teams: !!(config.TEAMS_APP_ID && config.TEAMS_APP_PASSWORD),
      n8n: !!config.N8N_WEBHOOK_URL
    };

    fastify.log.info({
      address,
      environment: config.NODE_ENV,
      integrations: integrationStatus,
      features: {
        unifiedOrchestration: true,
        crossPlatformRAG: true,
        metricsAndTelemetry: true
      }
    }, '🎉 Server started successfully');

    console.log(`
🎉 PowerSchool RAG API with Unified Integration is running!

📊 Server Details:
   • Address: ${address}
   • Environment: ${config.NODE_ENV}
   • Log Level: ${config.LOG_LEVEL}

🔗 Platform Integrations:
   • Slack: ${integrationStatus.slack ? '✅ Enabled' : '❌ Disabled'}
   • Teams: ${integrationStatus.teams ? '✅ Enabled' : '❌ Disabled'}
   • n8n Webhook: ${integrationStatus.n8n ? '✅ Enabled' : '❌ Disabled'}

🚀 Key Features:
   • Unified RAG orchestration across platforms
   • Shared processing pipeline for Slack & Teams
   • Platform-specific formatting and delivery
   • Cross-platform deduplication
   • Comprehensive metrics and monitoring
   • Fallback delivery mechanisms

📡 API Endpoints:
   • Health: ${address}/api/health
   • Metrics: ${address}/api/metrics
   • Ask (Legacy): ${address}/api/ask
   ${integrationStatus.slack ? `• Slack Events: ${address}/api/slack/events\n   • Slack Commands: ${address}/api/slack/command\n   • Slack Actions: ${address}/api/slack/actions` : ''}
   ${integrationStatus.teams ? `• Teams Messages: ${address}/api/teams/messages` : ''}

📖 Documentation: See UNIFIED_INTEGRATION_README.md for detailed setup instructions.
    `);

    // Track startup metrics
    metrics.incrementCounter('server_starts_total', {
      environment: config.NODE_ENV,
      slack_enabled: integrationStatus.slack.toString(),
      teams_enabled: integrationStatus.teams.toString()
    });

  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

// Start the application
start();

export default fastify;