/**
 * Comprehensive test suite for Slack integration
 * Tests validation, intent classification, and response formatting
 */

import {
  validateSlackRequest,
  extractQueryFromSlackText,
  getCollectionHint,
  checkSlackRateLimit 
} from '../src/utils/slackValidation';
import { SlackIntentClassifier } from '../src/core/slack/intentClassifier';
import type { 
  SlackEventPayload, 
  SlackCommandPayload, 
  LLMAdapter, 
  ChatMessage,
  AskResponse 
} from '../src/types';

// Mock LLM adapter for testing
const mockLLMAdapter = {
  generate: jest.fn() as jest.MockedFunction<(messages: ChatMessage[], options?: any) => Promise<string>>,
  getMaxTokens: jest.fn().mockReturnValue(4000),
  getModel: jest.fn().mockReturnValue('test-model')
} as jest.Mocked<LLMAdapter>;

describe('Slack Request Validation', () => {
  const validSigningSecret = 'test_signing_secret';
  const validTimestamp = Math.floor(Date.now() / 1000).toString();
  const testBody = JSON.stringify({ test: 'payload' });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('validateSlackRequest', () => {
    it('should validate a proper Slack request', () => {
      const crypto = require('crypto');
      const baseString = `v0:${validTimestamp}:${testBody}`;
      const hmac = crypto.createHmac('sha256', validSigningSecret);
      hmac.update(baseString);
      const signature = `v0=${hmac.digest('hex')}`;

      const result = validateSlackRequest(testBody, validTimestamp, signature, validSigningSecret);
      
      expect(result.isValid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should reject requests with invalid signatures', () => {
      const result = validateSlackRequest(testBody, validTimestamp, 'v0=invalid_signature', validSigningSecret);
      
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('Invalid signature');
    });

    it('should reject requests with old timestamps', () => {
      const oldTimestamp = (Math.floor(Date.now() / 1000) - 400).toString(); // 400 seconds ago
      const result = validateSlackRequest(testBody, oldTimestamp, 'v0=signature', validSigningSecret);
      
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('timestamp too old');
    });

    it('should reject requests without signing secret', () => {
      const result = validateSlackRequest(testBody, validTimestamp, 'v0=signature');
      
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('SLACK_SIGNING_SECRET not configured');
    });
  });

  describe('extractQueryFromSlackText', () => {
    const botUserId = 'U1234567890';

    it('should extract query from app mention', () => {
      const text = `<@${botUserId}> How do I enroll students?`;
      const result = extractQueryFromSlackText(text, botUserId);
      
      expect(result).toBe('How do I enroll students?');
    });

    it('should remove user mentions for privacy', () => {
      const text = `<@${botUserId}> Ask <@U9876543210> about enrollment`;
      const result = extractQueryFromSlackText(text, botUserId);
      
      expect(result).toBe('Ask about enrollment');
    });

    it('should remove channel mentions', () => {
      const text = `<@${botUserId}> Check <#C1234567890|general> for updates`;
      const result = extractQueryFromSlackText(text, botUserId);
      
      expect(result).toBe('Check for updates');
    });

    it('should remove URLs in angle brackets', () => {
      const text = `<@${botUserId}> See <https://example.com> for details`;
      const result = extractQueryFromSlackText(text, botUserId);
      
      expect(result).toBe('See for details');
    });
  });

  describe('getCollectionHint', () => {
    it('should detect PSSIS prefix', () => {
      const result = getCollectionHint('general', 'pssis: How to enroll students?');
      
      expect(result.collection).toBe('pssis');
      expect(result.cleanQuery).toBe('How to enroll students?');
    });

    it('should detect Schoology prefix', () => {
      const result = getCollectionHint('general', 'schoology: How to create assignments?');
      
      expect(result.collection).toBe('schoology');
      expect(result.cleanQuery).toBe('How to create assignments?');
    });

    it('should detect both prefix', () => {
      const result = getCollectionHint('general', 'both: How to sync data?');
      
      expect(result.collection).toBe('both');
      expect(result.cleanQuery).toBe('How to sync data?');
    });

    it('should use channel name hint for PSSIS', () => {
      const result = getCollectionHint('pssis-support', 'How to enroll students?');
      
      expect(result.collection).toBe('pssis');
      expect(result.cleanQuery).toBe('How to enroll students?');
    });

    it('should use channel name hint for Schoology', () => {
      const result = getCollectionHint('schoology-help', 'How to create assignments?');
      
      expect(result.collection).toBe('schoology');
      expect(result.cleanQuery).toBe('How to create assignments?');
    });

    it('should return no collection hint for ambiguous queries', () => {
      const result = getCollectionHint('general', 'How does this work?');
      
      expect(result.collection).toBeUndefined();
      expect(result.cleanQuery).toBe('How does this work?');
    });
  });

  describe('checkSlackRateLimit', () => {
    it('should allow first request from user', () => {
      const result = checkSlackRateLimit('U1234567890');
      
      expect(result.allowed).toBe(true);
      expect(result.remainingRequests).toBe(9); // Default is 10 requests
    });

    it('should track multiple requests from same user', () => {
      const userId = 'U1234567891';
      
      const first = checkSlackRateLimit(userId);
      const second = checkSlackRateLimit(userId);
      
      expect(first.allowed).toBe(true);
      expect(second.allowed).toBe(true);
      expect(second.remainingRequests).toBe(8);
    });

    it('should block user after reaching limit', () => {
      const userId = 'U1234567892';
      
      // Make 10 requests (the default limit)
      for (let i = 0; i < 10; i++) {
        checkSlackRateLimit(userId);
      }
      
      const blocked = checkSlackRateLimit(userId);
      expect(blocked.allowed).toBe(false);
      expect(blocked.remainingRequests).toBe(0);
    });
  });
});

describe('Slack Intent Classification', () => {
  let classifier: SlackIntentClassifier;

  beforeEach(() => {
    jest.clearAllMocks();
    classifier = new SlackIntentClassifier(mockLLMAdapter);
  });

  describe('classifyIntent', () => {
    it('should classify instructions intent', async () => {
      mockLLMAdapter.generate.mockResolvedValue(
        JSON.stringify({
          intent: 'instructions',
          confidence: 0.9,
          reasoning: 'User asking for step-by-step process'
        })
      );

      const result = await classifier.classifyIntent('How do I enroll a student?');
      
      expect(result.intent).toBe('instructions');
      expect(result.confidence).toBe(0.9);
      expect(mockLLMAdapter.generate).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ role: 'system' }),
          expect.objectContaining({ 
            role: 'user', 
            content: 'Classify this query: "How do I enroll a student?"' 
          })
        ]),
        { max_tokens: 200, temperature: 0.1 }
      );
    });

    it('should classify details intent', async () => {
      mockLLMAdapter.generate.mockResolvedValue(
        JSON.stringify({
          intent: 'details',
          confidence: 0.8,
          reasoning: 'User asking for information'
        })
      );

      const result = await classifier.classifyIntent('What is student enrollment?');
      
      expect(result.intent).toBe('details');
      expect(result.confidence).toBe(0.8);
    });

    it('should fall back to keyword classification on LLM error', async () => {
      mockLLMAdapter.generate.mockRejectedValue(new Error('LLM failed'));

      const result = await classifier.classifyIntent('How to enroll students?');
      
      expect(result.intent).toBe('instructions');
      expect(result.confidence).toBeLessThan(1);
    });
  });

  describe('classifyCollection', () => {
    it('should classify PSSIS collection', async () => {
      mockLLMAdapter.generate.mockResolvedValue(
        JSON.stringify({
          collection: 'pssis',
          confidence: 0.9,
          reasoning: 'Student enrollment is PSSIS functionality'
        })
      );

      const result = await classifier.classifyCollection('How to enroll students?');
      
      expect(result.collection).toBe('pssis');
      expect(result.confidence).toBe(0.9);
    });

    it('should classify Schoology collection', async () => {
      mockLLMAdapter.generate.mockResolvedValue(
        JSON.stringify({
          collection: 'schoology',
          confidence: 0.85,
          reasoning: 'Assignment creation is Schoology feature'
        })
      );

      const result = await classifier.classifyCollection('How to create assignments?');
      
      expect(result.collection).toBe('schoology');
      expect(result.confidence).toBe(0.85);
    });

    it('should use channel hint in classification', async () => {
      mockLLMAdapter.generate.mockResolvedValue(
        JSON.stringify({
          collection: 'pssis',
          confidence: 0.8,
          reasoning: 'PSSIS channel context'
        })
      );

      const result = await classifier.classifyCollection('How does this work?', 'pssis-support');
      
      expect(mockLLMAdapter.generate).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            role: 'user',
            content: 'Query: "How does this work?"\nChannel context: "pssis-support"'
          })
        ]),
        expect.any(Object)
      );
    });
  });

  describe('formatSlackResponse', () => {
    const mockRagResponse: AskResponse = {
      answer: 'To enroll a student, follow these steps...',
      summary: 'Student enrollment process',
      steps: ['Step 1', 'Step 2', 'Step 3'],
      citations: [{ title: 'PSSIS Manual', url: 'https://example.com' }],
      retrieved_docs: [{ id: '1', score: 0.9, excerpt: 'Enrollment process...' }]
    };

    it('should format instructions response', async () => {
      const mockSlackResponse = {
        text: 'Instructions for student enrollment',
        blocks: [
          {
            type: 'section',
            text: { type: 'mrkdwn', text: '*Instructions:*\n1. Step 1\n2. Step 2\n3. Step 3' }
          }
        ],
        confidence: 0.9
      };

      mockLLMAdapter.generate.mockResolvedValue(JSON.stringify(mockSlackResponse));

      const result = await classifier.formatSlackResponse(
        'How do I enroll a student?',
        mockRagResponse,
        { intent: 'instructions', confidence: 0.9 }
      );

      expect(result.intent).toBe('instructions');
      expect(result.blocks).toHaveLength(2); // Content + Actions
      expect(result.sources).toHaveLength(1);
    });

    it('should format details response', async () => {
      const mockSlackResponse = {
        text: 'Information about student enrollment',
        blocks: [
          {
            type: 'section',
            text: { type: 'mrkdwn', text: '*Answer:*\nTo enroll a student...' }
          }
        ],
        confidence: 0.8
      };

      mockLLMAdapter.generate.mockResolvedValue(JSON.stringify(mockSlackResponse));

      const result = await classifier.formatSlackResponse(
        'What is student enrollment?',
        mockRagResponse,
        { intent: 'details', confidence: 0.8 }
      );

      expect(result.intent).toBe('details');
      expect(result.confidence).toBe(0.8);
    });

    it('should fall back to simple formatting on LLM error', async () => {
      mockLLMAdapter.generate.mockRejectedValue(new Error('LLM failed'));

      const result = await classifier.formatSlackResponse(
        'How do I enroll a student?',
        mockRagResponse,
        { intent: 'instructions', confidence: 0.9 }
      );

      expect(result.blocks).toHaveLength(2); // Content + Actions
      expect(result.confidence).toBeLessThan(1);
    });
  });
});

// Sample Slack payloads for testing
export const sampleSlackEvent: SlackEventPayload = {
  token: 'verification_token',
  team_id: 'T1234567890',
  api_app_id: 'A1234567890',
  event: {
    type: 'app_mention',
    user: 'U1234567890',
    text: '<@U0987654321> How do I enroll students in PSSIS?',
    ts: '1234567890.123456',
    channel: 'C1234567890',
    thread_ts: '1234567890.123456',
    channel_type: 'channel'
  },
  type: 'event_callback',
  event_id: 'Ev1234567890',
  event_time: 1234567890
};

export const sampleSlackCommand: SlackCommandPayload = {
  token: 'verification_token',
  team_id: 'T1234567890',
  team_domain: 'example',
  channel_id: 'C1234567890',
  channel_name: 'general',
  user_id: 'U1234567890',
  user_name: 'john.doe',
  command: '/ask-powerschool',
  text: 'How to create assignments in Schoology?',
  response_url: 'https://hooks.slack.com/commands/1234567890/0987654321/abcdef',
  trigger_id: '1234567890.987654321.abcdef0123456789'
};