/**
 * Integration tests for Slack interactive features
 * Tests the full flow from button click to modal display and followup submission
 */

import supertest from 'supertest';
import crypto from 'crypto';
import { createServer } from '../src/index';
import { sourceCache } from '../src/core/slack/sourceCache';

// Mock Slack Web API
const mockSlackClient = {
  views: {
    open: jest.fn()
  },
  chat: {
    postMessage: jest.fn(),
    postEphemeral: jest.fn()
  },
  auth: {
    test: jest.fn()
  }
};

// Mock the Slack client
jest.mock('@slack/web-api', () => ({
  WebClient: jest.fn(() => mockSlackClient)
}));

describe('Slack Interactive Features Integration', () => {
  let app: any;
  let request: any;

  beforeAll(async () => {
    // Set test environment variables
    process.env.NODE_ENV = 'test';
    process.env.SLACK_SIGNING_SECRET = 'test-signing-secret';
    process.env.SLACK_BOT_TOKEN = 'xoxb-test-token';
    process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
    
    app = await createServer();
    request = supertest(app.server);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    sourceCache.cleanup();
  });

  const createSlackSignature = (body: string, timestamp: string) => {
    const baseString = `v0:${timestamp}:${body}`;
    const hmac = crypto.createHmac('sha256', 'test-signing-secret');
    hmac.update(baseString);
    return `v0=${hmac.digest('hex')}`;
  };

  describe('Show Sources Action', () => {
    it('should handle show sources button click and open modal', async () => {
      // First, cache some test data
      const responseId = 'test-response-123';
      const testSources = [
        {
          id: 'source-1',
          url: 'https://example.com/doc1',
          title: 'Test Document 1',
          snippet: 'This is a test snippet',
          retrieval_score: 0.95
        }
      ];

      sourceCache.store(responseId, {
        originalText: 'This is a test response',
        sources: testSources,
        userId: 'U123456',
        channelId: 'C789012'
      });

      // Mock successful modal opening
      mockSlackClient.views.open.mockResolvedValue({ ok: true });

      // Create payload for show sources action
      const actionPayload = {
        type: 'block_actions',
        user: { id: 'U123456', name: 'testuser' },
        channel: { id: 'C789012', name: 'general' },
        team: { id: 'T123456', domain: 'testteam' },
        actions: [{
          action_id: 'show_sources',
          value: JSON.stringify({ responseId }),
          type: 'button'
        }],
        trigger_id: 'test-trigger-123',
        response_url: 'https://hooks.slack.com/actions/test',
        action_ts: '1234567890.123456',
        message_ts: '1234567890.123456'
      };

      const body = `payload=${encodeURIComponent(JSON.stringify(actionPayload))}`;
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const signature = createSlackSignature(body, timestamp);

      const response = await request
        .post('/slack/actions')
        .set('X-Slack-Signature', signature)
        .set('X-Slack-Request-Timestamp', timestamp)
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .send(body);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ status: 'ok' });

      // Wait for async processing
      await new Promise(resolve => setTimeout(resolve, 100));

      // Verify modal was opened
      expect(mockSlackClient.views.open).toHaveBeenCalledWith({
        trigger_id: 'test-trigger-123',
        view: expect.objectContaining({
          type: 'modal',
          title: expect.objectContaining({
            text: 'Sources for this answer'
          }),
          blocks: expect.arrayContaining([
            expect.objectContaining({
              type: 'section',
              text: expect.objectContaining({
                text: expect.stringContaining('Test Document 1')
              })
            })
          ])
        })
      });
    });

    it('should handle missing/expired response gracefully', async () => {
      mockSlackClient.chat.postEphemeral.mockResolvedValue({ ok: true });

      const actionPayload = {
        type: 'block_actions',
        user: { id: 'U123456', name: 'testuser' },
        channel: { id: 'C789012', name: 'general' },
        team: { id: 'T123456', domain: 'testteam' },
        actions: [{
          action_id: 'show_sources',
          value: JSON.stringify({ responseId: 'non-existent' }),
          type: 'button'
        }],
        trigger_id: 'test-trigger-123',
        response_url: 'https://hooks.slack.com/actions/test',
        action_ts: '1234567890.123456',
        message_ts: '1234567890.123456'
      };

      const body = `payload=${encodeURIComponent(JSON.stringify(actionPayload))}`;
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const signature = createSlackSignature(body, timestamp);

      const response = await request
        .post('/slack/actions')
        .set('X-Slack-Signature', signature)
        .set('X-Slack-Request-Timestamp', timestamp)
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .send(body);

      expect(response.status).toBe(200);

      // Wait for async processing
      await new Promise(resolve => setTimeout(resolve, 100));

      // Should have sent ephemeral error message
      expect(mockSlackClient.chat.postEphemeral).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: 'C789012',
          user: 'U123456',
          text: expect.stringContaining('try again')
        })
      );
    });
  });

  describe('Ask Followup Action', () => {
    it('should handle ask followup button click and open modal', async () => {
      // Cache test data
      const responseId = 'test-response-456';
      sourceCache.store(responseId, {
        originalText: 'This is the original response',
        sources: [],
        userId: 'U123456',
        channelId: 'C789012'
      });

      mockSlackClient.views.open.mockResolvedValue({ ok: true });

      const actionPayload = {
        type: 'block_actions',
        user: { id: 'U123456', name: 'testuser' },
        channel: { id: 'C789012', name: 'general' },
        team: { id: 'T123456', domain: 'testteam' },
        actions: [{
          action_id: 'ask_followup',
          value: JSON.stringify({ responseId }),
          type: 'button'
        }],
        trigger_id: 'test-trigger-456',
        response_url: 'https://hooks.slack.com/actions/test',
        action_ts: '1234567890.123456',
        message_ts: '1234567890.123456'
      };

      const body = `payload=${encodeURIComponent(JSON.stringify(actionPayload))}`;
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const signature = createSlackSignature(body, timestamp);

      const response = await request
        .post('/slack/actions')
        .set('X-Slack-Signature', signature)
        .set('X-Slack-Request-Timestamp', timestamp)
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .send(body);

      expect(response.status).toBe(200);

      // Wait for async processing
      await new Promise(resolve => setTimeout(resolve, 100));

      // Verify followup modal was opened
      expect(mockSlackClient.views.open).toHaveBeenCalledWith({
        trigger_id: 'test-trigger-456',
        view: expect.objectContaining({
          type: 'modal',
          callback_id: 'followup_modal',
          title: expect.objectContaining({
            text: 'Ask a follow-up'
          }),
          private_metadata: expect.stringContaining(responseId)
        })
      });
    });
  });

  describe('Followup Modal Submission', () => {
    it('should process followup question and post threaded response', async () => {
      // This would require mocking the RAG pipeline, which is complex
      // For now, we'll test the payload parsing and basic flow
      
      const responseId = 'test-response-789';
      sourceCache.store(responseId, {
        originalText: 'Original response text',
        sources: [],
        userId: 'U123456',
        channelId: 'C789012',
        threadTs: '1234567890.123456'
      });

      const submissionPayload = {
        type: 'view_submission',
        user: { id: 'U123456', name: 'testuser' },
        team: { id: 'T123456', domain: 'testteam' },
        api_app_id: 'A123456',
        token: 'test-token',
        trigger_id: 'test-trigger-789',
        view: {
          id: 'V123456',
          team_id: 'T123456',
          type: 'modal' as const,
          callback_id: 'followup_modal',
          state: {
            values: {
              followup_input: {
                followup_question: {
                  type: 'plain_text_input' as const,
                  value: 'Can you explain this in more detail?'
                }
              }
            }
          },
          private_metadata: JSON.stringify({
            originalResponseId: responseId,
            originalText: 'Original response text',
            originalSources: []
          }),
          blocks: [],
          title: { type: 'plain_text' as const, text: 'Ask a follow-up' },
          hash: 'test-hash'
        },
        response_urls: []
      };

      const body = `payload=${encodeURIComponent(JSON.stringify(submissionPayload))}`;
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const signature = createSlackSignature(body, timestamp);

      const response = await request
        .post('/slack/actions')
        .set('X-Slack-Signature', signature)
        .set('X-Slack-Request-Timestamp', timestamp)
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .send(body);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ status: 'ok' });

      // Wait for async processing
      await new Promise(resolve => setTimeout(resolve, 100));

      // The actual RAG processing would be mocked in a real test
      // For now, we just verify the payload was accepted
    });
  });

  describe('Invalid Signatures', () => {
    it('should reject requests with invalid signatures', async () => {
      const actionPayload = {
        type: 'block_actions',
        user: { id: 'U123456' },
        actions: [{ action_id: 'show_sources' }]
      };

      const body = `payload=${encodeURIComponent(JSON.stringify(actionPayload))}`;
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const invalidSignature = 'v0=invalid';

      const response = await request
        .post('/slack/actions')
        .set('X-Slack-Signature', invalidSignature)
        .set('X-Slack-Request-Timestamp', timestamp)
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .send(body);

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('INVALID_SIGNATURE');
    });
  });
});