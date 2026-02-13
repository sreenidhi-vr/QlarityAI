# 🚀 Unified Slack + Teams RAG Integration

This document provides comprehensive guidance for integrating and using the unified RAG orchestration system that supports both **Microsoft Teams** and **Slack** platforms through a single, shared processing pipeline.

## 🏗️ Architecture Overview

The unified integration consists of several key components:

```
┌─────────────────┐    ┌─────────────────┐
│   Slack Events  │    │  Teams Events   │
└─────────┬───────┘    └─────────┬───────┘
          │                      │
          ▼                      ▼
┌─────────────────┐    ┌─────────────────┐
│  Slack Adapter  │    │  Teams Adapter  │
└─────────┬───────┘    └─────────┬───────┘
          │                      │
          └──────────┬───────────┘
                     ▼
          ┌─────────────────┐
          │ Unified         │
          │ Orchestrator    │
          └─────────┬───────┘
                    ▼
          ┌─────────────────┐
          │  RAG Pipeline   │
          └─────────┬───────┘
                    │
          ┌─────────┴───────┐
          ▼                 ▼
┌─────────────────┐ ┌─────────────────┐
│ Slack Delivery  │ │ Teams Delivery  │
└─────────────────┘ └─────────────────┘
```

### Core Components

- **UnifiedOrchestrator**: Central processing engine that coordinates RAG pipeline execution
- **Platform Adapters**: Convert platform-specific events to unified format
- **Delivery Services**: Handle platform-specific message sending with fallbacks
- **Validation**: Secure signature validation for both platforms
- **Metrics**: Unified telemetry and monitoring across platforms

## 🔧 Installation & Setup

### Prerequisites

```bash
# Required Node.js version
node >= 18.0.0
npm >= 9.0.0 or pnpm >= 8.0.0
```

### Environment Variables

Add the following to your `.env` file:

```bash
# Database Configuration
DATABASE_URL=postgresql://user:password@localhost:5432/rag_db
VECTOR_TABLE_NAME=documents

# RAG Pipeline Configuration
EMBEDDING_PROVIDER=bedrock
EMBEDDING_MODEL=amazon.titan-embed-text-v2:0
LLM_PROVIDER=bedrock
LLM_MODEL=anthropic.claude-v2
MAX_TOKENS=1500

# Slack Configuration
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_SIGNING_SECRET=your-signing-secret
SLACK_VERIFIED_WORKSPACES=T1234567890,T0987654321

# Microsoft Teams Configuration
TEAMS_APP_ID=12345678-1234-1234-1234-123456789012
TEAMS_APP_PASSWORD=your-app-password

# Optional: Rate Limiting
RATE_LIMIT_PER_MIN=60
MAX_QUERY_LENGTH=1000

# Metrics & Monitoring
LOG_LEVEL=info
```

### Dependencies

The unified integration requires these additional packages:

```bash
# Install Teams Bot Framework support
npm install botbuilder @microsoft/microsoft-graph-client

# Or if using pnpm
pnpm add botbuilder @microsoft/microsoft-graph-client
```

## 🚀 Quick Start

### 1. Initialize Components

```typescript
// src/index.ts
import { UnifiedOrchestrator } from './core/orchestrator/unifiedOrchestrator';
import { RAGPipeline } from './core/rag/ragPipeline';
import { SlackDelivery } from './services/delivery/slackDelivery';
import { TeamsDelivery } from './services/delivery/teamsDelivery';
import { metrics } from './utils/metrics';

// Initialize RAG components
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
  tableName: config.VECTOR_TABLE_NAME
});

// Create unified orchestrator
const ragPipeline = new RAGPipeline(embeddingAdapter, vectorStore, llmAdapter);
const orchestrator = new UnifiedOrchestrator(ragPipeline, metrics);

// Initialize delivery services
const slackDelivery = new SlackDelivery(config.SLACK_BOT_TOKEN);
const teamsDelivery = new TeamsDelivery(config.TEAMS_APP_ID, config.TEAMS_APP_PASSWORD);
```

### 2. Register Routes

```typescript
// Register Slack routes (unified)
fastify.register(require('./api/routes/slack'), { prefix: '/api' });

// Register Teams routes
fastify.register(require('./api/routes/teams'), { prefix: '/api' });

// Health check endpoints
fastify.get('/api/health', async (request, reply) => {
  const [slackHealth, teamsHealth, orchestratorHealth] = await Promise.all([
    slackDelivery.healthCheck(),
    teamsDelivery.healthCheck(),
    orchestrator.healthCheck()
  ]);

  return {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    components: {
      slack: slackHealth.healthy,
      teams: teamsHealth.healthy,
      orchestrator: orchestratorHealth.status === 'healthy'
    }
  };
});
```

### 3. Process Messages

The unified system automatically processes messages from both platforms:

```typescript
// Example: Processing a platform-agnostic query
const platformContext = {
  platform: 'slack', // or 'teams'
  userId: 'U123456',
  channelId: 'C123456', 
  query: 'How do I create a student record?',
  metadata: {
    responseUrl: 'https://hooks.slack.com/...' // Slack-specific
    // or
    // serviceUrl: 'https://smba.trafficmanager.net/...' // Teams-specific
  }
};

const result = await orchestrator.handlePlatformQuery(platformContext);

// Result contains unified format suitable for both platforms
console.log({
  text: result.text,
  confidence: result.confidence,
  sources: result.sources,
  intent: result.intent,
  processingTime: result.metadata.processingTimeMs
});
```

## 🔗 Platform Configuration

### Slack App Setup

1. **Create Slack App** at [api.slack.com](https://api.slack.com/apps)

2. **Configure Bot Scopes**:
   ```
   app_mentions:read
   channels:read
   chat:write
   chat:write.public
   commands
   im:read
   users:read
   ```

3. **Set Event Subscriptions**:
   ```
   Request URL: https://your-domain.com/api/slack/events
   
   Subscribe to Bot Events:
   - app_mention
   - message.im
   ```

4. **Configure Slash Commands**:
   ```
   Command: /ask
   Request URL: https://your-domain.com/api/slack/command
   Description: Ask questions about PowerSchool
   ```

5. **Set Interactivity**:
   ```
   Request URL: https://your-domain.com/api/slack/actions
   ```

### Teams App Setup

1. **Register App** in [Azure Portal](https://portal.azure.com)

2. **Bot Framework Registration**:
   ```
   Bot Handle: your-bot-name
   Messaging Endpoint: https://your-domain.com/api/teams/messages
   ```

3. **App Manifest** (`manifest.json`):
   ```json
   {
     "manifestVersion": "1.16",
     "version": "1.0.0",
     "id": "12345678-1234-1234-1234-123456789012",
     "packageName": "com.yourcompany.ragbot",
     "developer": {
       "name": "Your Company",
       "websiteUrl": "https://your-domain.com",
       "privacyUrl": "https://your-domain.com/privacy",
       "termsOfUseUrl": "https://your-domain.com/terms"
     },
     "name": {
       "short": "RAG Assistant",
       "full": "PowerSchool RAG Assistant"
     },
     "description": {
       "short": "AI assistant for PowerSchool queries",
       "full": "Intelligent assistant that answers questions about PowerSchool using RAG technology"
     },
     "icons": {
       "outline": "outline.png",
       "color": "color.png"
     },
     "accentColor": "#FFFFFF",
     "bots": [
       {
         "botId": "12345678-1234-1234-1234-123456789012",
         "scopes": ["personal", "team"],
         "supportsFiles": false,
         "isNotificationOnly": false
       }
     ],
     "permissions": ["identity", "messageTeamMembers"],
     "validDomains": ["your-domain.com"]
   }
   ```

## 💬 Usage Examples

### Basic Queries

Both platforms support the same query types:

**Slack:**
```
@RAGBot How do I enroll a new student?
/ask What are the steps to create a teacher account?
```

**Teams:**
```
@RAG Assistant How do I enroll a new student?
What are the steps to create a teacher account?
```

### Interactive Features

Both platforms support interactive follow-ups:

1. **Show Sources**: View detailed source information
2. **Ask Follow-up**: Ask related questions with context
3. **Collection Hints**: Specify PowerSchool vs Schoology

### Response Format Examples

**Slack Block Kit Response:**
```json
{
  "blocks": [
    {
      "type": "section",
      "text": {
        "type": "mrkdwn",
        "text": "To enroll a student:\n1. Navigate to Students > Enrollment\n2. Click 'Add Student'\n3. Fill required fields..."
      }
    },
    {
      "type": "actions",
      "elements": [
        {
          "type": "button",
          "text": { "type": "plain_text", "text": "🔍 Show Sources" },
          "action_id": "show_sources"
        },
        {
          "type": "button", 
          "text": { "type": "plain_text", "text": "💬 Ask Follow-up" },
          "action_id": "ask_followup"
        }
      ]
    }
  ]
}
```

**Teams Adaptive Card Response:**
```json
{
  "type": "AdaptiveCard",
  "version": "1.4",
  "body": [
    {
      "type": "TextBlock",
      "text": "To enroll a student:\n1. Navigate to Students > Enrollment\n2. Click 'Add Student'\n3. Fill required fields...",
      "wrap": true
    }
  ],
  "actions": [
    {
      "type": "Action.Submit",
      "title": "🔍 Show Sources",
      "data": { "action": "show_sources" }
    },
    {
      "type": "Action.Submit",
      "title": "💬 Ask Follow-up", 
      "data": { "action": "ask_followup" }
    }
  ]
}
```

## 🔍 Monitoring & Debugging

### Metrics Dashboard

View real-time metrics:

```bash
# Get metrics snapshot
curl https://your-domain.com/api/metrics

# Response includes:
{
  "counters": [
    { "name": "orchestrator_calls_total", "value": 150, "labels": { "platform": "slack" } },
    { "name": "slack_delivery_total", "value": 145, "labels": { "status": "success" } }
  ],
  "durations": [
    { "name": "rag_processing_duration_ms", "avgMs": 850, "count": 150 }
  ]
}
```

### Health Checks

```bash
# Overall health
curl https://your-domain.com/api/health

# Platform-specific health  
curl https://your-domain.com/api/slack/health
curl https://your-domain.com/api/teams/health
```

### Debug Logging

Enable detailed logging:

```bash
LOG_LEVEL=debug npm start
```

Logs include:
- Query processing flows
- Platform adapter transformations  
- Delivery success/failures
- Duplicate detection
- Processing times

## 🔒 Security & Validation

### Request Validation

Both platforms use signature validation:

**Slack**: HMAC-SHA256 with signing secret
```typescript
const validation = validateSlackRequest(body, timestamp, signature);
```

**Teams**: JWT token validation with Bot Framework
```typescript  
const validation = validateTeamsRequest(authHeader, body);
```

### Rate Limiting

Configurable per-user rate limits:

```typescript
// Slack rate limiting
const rateLimit = checkSlackRateLimit(userId, maxRequests, windowMs);

// Teams rate limiting  
const rateLimit = checkTeamsRateLimit(userId, maxRequests, windowMs);
```

### Access Control

**Workspace/Tenant Restrictions:**
```bash
# Slack - restrict to specific workspaces
SLACK_VERIFIED_WORKSPACES=T1234567890,T0987654321

# Teams - validate tenant IDs in code
const tenantValidation = validateTeamsTenant(activity, allowedTenants);
```

## 🚀 Deployment

### Production Checklist

- [ ] Set all environment variables
- [ ] Configure HTTPS with valid certificates
- [ ] Set up database with pgvector extension
- [ ] Configure reverse proxy (nginx/Apache)
- [ ] Set up monitoring and alerting
- [ ] Test both Slack and Teams integrations
- [ ] Verify webhook endpoints are accessible
- [ ] Test error handling and fallbacks

### Docker Deployment

```dockerfile
FROM node:18-alpine

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

COPY dist/ ./dist/
COPY src/types/ ./src/types/

EXPOSE 3000
CMD ["npm", "start"]
```

### Environment-Specific Configs

```bash
# Development
LOG_LEVEL=debug
NODE_ENV=development

# Staging  
LOG_LEVEL=info
NODE_ENV=staging

# Production
LOG_LEVEL=warn  
NODE_ENV=production
```

## 🔧 Troubleshooting

### Common Issues

**1. Slack Events Not Received**
```bash
# Check webhook URL is accessible
curl -X POST https://your-domain.com/api/slack/events \
  -H "Content-Type: application/json" \
  -d '{"type": "url_verification", "challenge": "test"}'

# Expected: {"challenge": "test"}
```

**2. Teams Messages Not Processing**
```bash  
# Check Teams endpoint
curl -X POST https://your-domain.com/api/teams/messages \
  -H "Authorization: Bearer test-token" \
  -H "Content-Type: application/json"

# Should return 401 with validation error
```

**3. RAG Pipeline Errors**
```bash
# Check vector database
curl https://your-domain.com/api/health

# Verify embeddings work
curl -X POST https://your-domain.com/api/ask \
  -H "Content-Type: application/json" \
  -d '{"query": "test query"}'
```

### Debug Commands

```bash
# Test Slack integration
npm run test:slack

# Test Teams integration  
npm run test:teams

# Test unified orchestrator
npm run test:orchestrator

# View metrics
npm run metrics:summary
```

## 📚 API Reference

### UnifiedOrchestrator

```typescript
class UnifiedOrchestrator {
  async handlePlatformQuery(context: PlatformQueryContext): Promise<OrchestratorResult>
  async getStats(): Promise<OrchestratorStats>
  async healthCheck(): Promise<HealthStatus>
}
```

### Platform Adapters

```typescript
// Slack Adapter
function toPlatformContext(payload: SlackEventPayload | SlackCommandPayload): PlatformQueryContext
function formatResponseForSlack(result: OrchestratorResult, options?: FormatOptions): SlackResponse

// Teams Adapter  
function toPlatformContext(activity: TeamsActivity): PlatformQueryContext
function formatResponseForTeams(result: OrchestratorResult, options?: FormatOptions): TeamsResponse
```

### Delivery Services

```typescript
// Slack Delivery
class SlackDelivery {
  async sendWithFallback(options: SlackDeliveryOptions, responseUrl?: string): Promise<SlackDeliveryResult>
  async postMessage(options: SlackDeliveryOptions): Promise<SlackDeliveryResult>
  async postEphemeral(options: SlackEphemeralOptions): Promise<SlackDeliveryResult>
}

// Teams Delivery
class TeamsDelivery {
  async replyToActivity(activity: TeamsActivity, options: TeamsDeliveryOptions): Promise<TeamsDeliveryResult>
  async sendProactive(serviceUrl: string, conversationId: string, options: TeamsDeliveryOptions): Promise<TeamsDeliveryResult>
}
```

## 🤝 Contributing

### Development Setup

```bash
# Clone and install
git clone <repository>
cd unified-rag-integration
pnpm install

# Set up development environment
cp .env.example .env
# Edit .env with your credentials

# Run in development mode
pnpm dev
```

### Testing

```bash
# Run all tests
pnpm test

# Run specific test suites
pnpm test:orchestrator
pnpm test:adapters  
pnpm test:delivery

# Run with coverage
pnpm test:coverage
```

### Code Standards

- TypeScript with strict mode
- ESLint + Prettier for formatting
- Jest for testing
- Comprehensive error handling
- Structured logging

---

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🆘 Support

For issues and questions:

1. Check this documentation
2. Review the troubleshooting section
3. Check existing GitHub issues
4. Create a new issue with detailed information

---

**Built with ❤️ for unified RAG experiences across Slack and Teams**