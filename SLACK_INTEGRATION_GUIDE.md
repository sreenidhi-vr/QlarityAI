# Slack RAG Integration Guide

This guide provides complete instructions for setting up and deploying the Slack integration for the PowerSchool RAG API service.

## Overview

The Slack integration extends the existing RAG API to accept queries from Slack channels, process them through the RAG pipeline (PSSIS and Schoology knowledge bases), and return formatted responses with intelligent intent-based formatting.

### Key Features

- **Secure Request Validation**: All Slack requests are validated using signature verification
- **Intent Classification**: LLM-based classification of user intent (details vs instructions)
- **Collection Selection**: Automatic routing to appropriate knowledge base (PSSIS, Schoology, or both)
- **Rich Formatting**: Slack Block Kit responses with interactive buttons
- **Rate Limiting**: Per-user rate limiting to prevent abuse
- **Error Handling**: Graceful error handling with user-friendly messages
- **Async Processing**: Non-blocking request processing to meet Slack's 3-second response requirement

## Architecture

```
Slack → Request Validation → Intent Classification → Collection Selection → RAG Pipeline → Response Formatting → Slack
```

### Components

1. **Slack Routes** (`/api/v1/slack/*`): Handle incoming webhooks
2. **Request Validation**: Verify Slack signatures and prevent replay attacks
3. **Intent Classifier**: LLM-powered intent and collection classification
4. **Query Handler**: Orchestrates the complete pipeline
5. **Response Formatter**: Creates Slack Block Kit responses

## Setup Instructions

### 1. Create Slack App

1. Go to [Slack API](https://api.slack.com/apps) and create a new app
2. Choose "From scratch" and provide:
   - App Name: "PowerSchool RAG Assistant"
   - Workspace: Your target workspace

### 2. Configure App Permissions

Navigate to **OAuth & Permissions** and add these scopes:

**Bot Token Scopes:**
- `chat:write` - Send messages
- `app_mentions:read` - Read mentions
- `im:history` - Read direct messages
- `channels:history` - Read channel messages (if needed)
- `commands` - Handle slash commands

### 3. Enable Events

1. Go to **Event Subscriptions** and enable events
2. Set Request URL: `https://your-domain.com/api/v1/slack/events`
3. Subscribe to Bot Events:
   - `app_mention` - When bot is mentioned
   - `message.im` - Direct messages to bot

### 4. Create Slash Command (Optional)

1. Go to **Slash Commands** and create a new command:
   - Command: `/ask-powerschool`
   - Request URL: `https://your-domain.com/api/v1/slack/commands`
   - Short Description: "Ask PowerSchool documentation questions"
   - Usage Hint: "How do I enroll students?"

### 5. Enable Interactive Components

1. Go to **Interactivity & Shortcuts**
2. Enable Interactivity
3. Set Request URL: `https://your-domain.com/api/v1/slack/actions`

### 6. Install App to Workspace

1. Go to **Install App**
2. Click "Install to Workspace"
3. Authorize the app
4. Copy the **Bot User OAuth Token** (starts with `xoxb-`)
5. Copy the **Signing Secret** from **Basic Information**

## Environment Configuration

Add these variables to your `.env` file:

```bash
# Slack Configuration
SLACK_SIGNING_SECRET=your_slack_signing_secret_here
SLACK_BOT_TOKEN=xoxb-your-slack-bot-token-here
SLACK_APP_TOKEN=xapp-your-slack-app-token-here
SLACK_VERIFIED_WORKSPACES=T1234567890,T0987654321

# Existing RAG configuration remains the same
DATABASE_URL=postgresql://...
EMBEDDING_PROVIDER=bedrock
LLM_PROVIDER=bedrock
# ... other existing config
```

### Configuration Options

| Variable | Required | Description |
|----------|----------|-------------|
| `SLACK_SIGNING_SECRET` | Yes | Secret for validating Slack requests |
| `SLACK_BOT_TOKEN` | Yes | Bot token for sending messages |
| `SLACK_APP_TOKEN` | No | App-level token (for socket mode) |
| `SLACK_VERIFIED_WORKSPACES` | No | Comma-separated list of allowed team IDs |

## API Endpoints

### POST /api/v1/slack/events

Handles Slack Events API webhooks.

**Supported Events:**
- `url_verification` - App installation verification
- `app_mention` - Bot mentions in channels
- `message.im` - Direct messages to bot

**Request Validation:**
- Verifies `X-Slack-Signature` header
- Checks `X-Slack-Request-Timestamp` for replay attacks
- Validates against `SLACK_SIGNING_SECRET`

### POST /api/v1/slack/commands

Handles slash command invocations.

**Example:**
```
/ask-powerschool How do I enroll students?
```

### POST /api/v1/slack/actions

Handles interactive component actions (button clicks).

**Supported Actions:**
- `show_sources` - Display source documents
- `ask_followup` - Prompt for follow-up questions
- `refine_answer` - Suggest query refinements

### GET /api/v1/slack/health

Health check endpoint for Slack integration.

**Response:**
```json
{
  "status": "healthy",
  "components": {
    "slack": true,
    "ragPipeline": true
  },
  "details": {
    "slackBotId": "U1234567890",
    "slackTeam": "T1234567890"
  }
}
```

## Usage Examples

### Channel Mentions

```
@PowerSchool-Bot How do I enroll students in PSSIS?
```

### Collection-Specific Queries

```
@PowerSchool-Bot pssis: How to generate reports?
@PowerSchool-Bot schoology: How to create assignments?
@PowerSchool-Bot both: How to sync grades between systems?
```

### Slash Commands

```
/ask-powerschool What are the system requirements?
```

## Response Formats

### Details Response

For informational queries, responses include:
- Professional summary (3-6 sentences)
- Key facts as bullet points
- Source citations
- Interactive buttons

### Instructions Response

For how-to queries, responses include:
- Numbered step-by-step instructions
- Prerequisites section
- Estimated completion time
- Expected outcomes
- Interactive buttons

### Interactive Elements

All responses include:
- **📋 Show Sources** - View source documents
- **🔄 Ask Follow-up** - Guidance for follow-up questions

## Collection Selection Logic

The system determines which knowledge base to search using:

1. **Explicit Prefixes:**
   - `pssis: query` → PSSIS-Admin docs
   - `schoology: query` → Schoology docs
   - `both: query` → Search both collections

2. **Channel Context:**
   - `#pssis-*` channels → Default to PSSIS
   - `#schoology-*` channels → Default to Schoology

3. **LLM Classification:**
   - Uses keyword analysis and context
   - Falls back to searching both if uncertain

## Security Features

### Request Validation

- **Signature Verification**: All requests verified using HMAC SHA256
- **Timestamp Validation**: Prevents replay attacks (5-minute window)
- **Workspace Filtering**: Optional allowlist of team IDs

### Rate Limiting

- **Per-User Limits**: 10 requests per minute per user
- **Automatic Cleanup**: Expired rate limit entries removed periodically
- **Graceful Degradation**: Clear error messages when limits exceeded

### Data Privacy

- **PII Filtering**: User mentions stripped from queries
- **Logging**: No full message content logged in production
- **Sanitization**: Request payloads sanitized before processing

## Error Handling

### User-Facing Errors

- **No Results Found**: Helpful suggestions for query refinement
- **Rate Limited**: Clear explanation with retry time
- **System Errors**: Generic error with support contact info

### System-Level Errors

- **RAG Pipeline Failures**: Fallback to simple responses
- **LLM Timeouts**: Graceful degradation with cached responses
- **Database Issues**: Service unavailable messages

## Monitoring and Logging

### Key Metrics

- Request volume by user/channel
- Intent classification accuracy
- Response time distribution
- Error rates by type
- Collection selection distribution

### Log Levels

```javascript
// Debug: Detailed processing information
request.log.debug('Intent classified', { intent, confidence });

// Info: Normal operation events
request.log.info('Slack query processed', { userId, processingTime });

// Warn: Recoverable issues
request.log.warn('Low confidence response', { confidence });

// Error: System failures
request.log.error('Pipeline failed', { error, userId });
```

## Testing

### Unit Tests

Run the test suite:

```bash
npm test tests/slack-integration.test.ts
```

### Integration Testing

1. **Signature Validation:**
   ```bash
   curl -X POST http://localhost:3000/api/v1/slack/events \
     -H "X-Slack-Signature: v0=..." \
     -H "X-Slack-Request-Timestamp: 1234567890" \
     -d '{"type": "url_verification", "challenge": "test"}'
   ```

2. **Event Processing:**
   - Send test app_mention event
   - Verify response formatting
   - Check interactive components

### Load Testing

Simulate multiple concurrent Slack users:

```bash
# Install artillery for load testing
npm install -g artillery

# Run load test
artillery run slack-load-test.yml
```

## Deployment

### Prerequisites

1. **Existing RAG API**: Fully configured and operational
2. **SSL Certificate**: Required for Slack webhooks
3. **Public Domain**: For webhook endpoints
4. **Database**: PostgreSQL with vector extension

### Deployment Steps

1. **Update Environment:**
   ```bash
   # Add Slack config to production .env
   echo "SLACK_SIGNING_SECRET=..." >> .env
   echo "SLACK_BOT_TOKEN=xoxb-..." >> .env
   ```

2. **Install Dependencies:**
   ```bash
   npm install @slack/bolt @slack/web-api
   ```

3. **Build and Deploy:**
   ```bash
   npm run build
   npm start
   ```

4. **Verify Health:**
   ```bash
   curl https://your-domain.com/api/v1/slack/health
   ```

5. **Test Integration:**
   - Mention bot in test channel
   - Verify response and formatting
   - Test interactive components

### Docker Deployment

```dockerfile
# Add to existing Dockerfile
RUN npm install @slack/bolt @slack/web-api

# Environment variables for Slack
ENV SLACK_SIGNING_SECRET=""
ENV SLACK_BOT_TOKEN=""
```

### Kubernetes Deployment

```yaml
# Add to existing deployment
spec:
  containers:
  - name: rag-api
    env:
    - name: SLACK_SIGNING_SECRET
      valueFrom:
        secretKeyRef:
          name: slack-secrets
          key: signing-secret
    - name: SLACK_BOT_TOKEN
      valueFrom:
        secretKeyRef:
          name: slack-secrets
          key: bot-token
```

## Troubleshooting

### Common Issues

1. **"Invalid Signature" Errors**
   - Check `SLACK_SIGNING_SECRET` is correct
   - Verify webhook URL in Slack app settings
   - Ensure request timestamp is within 5 minutes

2. **Bot Not Responding**
   - Check `SLACK_BOT_TOKEN` permissions
   - Verify bot is invited to channel
   - Check application logs for errors

3. **Slow Responses**
   - Monitor RAG pipeline performance
   - Check database connection health
   - Review LLM API latency

4. **Rate Limiting Issues**
   - Increase `RATE_LIMIT_PER_MIN` if needed
   - Monitor user query patterns
   - Consider per-channel limits

### Debug Mode

Enable debug logging:

```bash
LOG_LEVEL=debug npm start
```

### Health Checks

Monitor these endpoints:
- `/health` - Overall API health
- `/api/v1/slack/health` - Slack integration health

## Best Practices

### Performance

- **Async Processing**: Always acknowledge Slack within 3 seconds
- **Connection Pooling**: Reuse database connections
- **Caching**: Cache frequent queries and responses
- **Monitoring**: Track response times and error rates

### Security

- **Secret Rotation**: Regularly rotate Slack secrets
- **Access Control**: Limit workspace access if needed
- **Audit Logging**: Log all user interactions
- **Input Validation**: Sanitize all user inputs

### User Experience

- **Clear Messaging**: Provide helpful error messages
- **Progressive Disclosure**: Use buttons for additional info
- **Context Awareness**: Leverage channel names for better routing
- **Feedback Loop**: Allow users to refine queries

## Support and Maintenance

### Regular Tasks

1. **Monitor Logs**: Review error patterns weekly
2. **Update Secrets**: Rotate tokens monthly
3. **Performance Review**: Analyze response times
4. **User Feedback**: Collect and analyze user queries

### Scaling Considerations

- **Rate Limits**: Increase as user base grows
- **Database**: Monitor query performance
- **LLM Costs**: Track token usage and costs
- **Infrastructure**: Scale based on request volume

For additional support, refer to the main API documentation and Slack API reference.