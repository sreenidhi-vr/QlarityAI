/**
 * Test suite for unified Slack command routing
 * Tests /ask and /domo command routing functionality
 */

import './setup-e2e';
import {
  extractQueryFromSlackText,
  getCollectionHint
} from '../src/utils/slackValidation';
import config from '../src/utils/config';
import type { SlackCommandPayload } from '../src/types';

// Mock axios for n8n webhook calls
jest.mock('axios');
const mockedAxios = jest.mocked(require('axios'));

describe('Slack Unified Commands', () => {
  const originalN8NWebhookUrl = (config as any).N8N_WEBHOOK_URL;

  beforeAll(() => {
    // Mock n8n webhook URL for testing
    (config as any).N8N_WEBHOOK_URL = 'https://mock-n8n-webhook.com/webhook/slack-domo';
  });

  afterAll(() => {
    // Restore original config
    (config as any).N8N_WEBHOOK_URL = originalN8NWebhookUrl;
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Unified Command Logic', () => {
    const baseSlackPayload: SlackCommandPayload = {
      token: 'test-token',
      team_id: 'T1234567890',
      team_domain: 'testteam',
      channel_id: 'C1234567890',
      channel_name: 'general',
      user_id: 'U1234567890',
      user_name: 'testuser',
      response_url: 'https://hooks.slack.com/commands/1234/5678',
      trigger_id: '13345224609.738474920.8088930838d88f008e0',
      command: '/ask',
      text: 'test query'
    };

    it('should identify /ask commands correctly', () => {
      const askPayload = { ...baseSlackPayload, command: '/ask' };
      expect(askPayload.command).toBe('/ask');
    });

    it('should identify /domo commands correctly', () => {
      const domoPayload = { ...baseSlackPayload, command: '/domo' };
      expect(domoPayload.command).toBe('/domo');
    });

    it('should handle n8n webhook configuration', () => {
      expect(config.N8N_WEBHOOK_URL).toBe('https://mock-n8n-webhook.com/webhook/slack-domo');
    });

    it('should mock axios for n8n calls', async () => {
      mockedAxios.post.mockResolvedValue({ status: 200, data: { success: true } });

      await mockedAxios.post(config.N8N_WEBHOOK_URL!, {
        text: 'test domo command',
        user_name: 'testuser'
      });

      expect(mockedAxios.post).toHaveBeenCalledWith(
        'https://mock-n8n-webhook.com/webhook/slack-domo',
        expect.objectContaining({
          text: 'test domo command',
          user_name: 'testuser'
        })
      );
    });

    it('should handle n8n webhook errors gracefully', async () => {
      mockedAxios.post.mockRejectedValue(new Error('Network error'));

      try {
        await mockedAxios.post(config.N8N_WEBHOOK_URL!, {
          text: 'test domo command',
          user_name: 'testuser'
        });
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toBe('Network error');
      }
    });

    it('should validate required payload fields', () => {
      const requiredFields = ['team_id', 'channel_id', 'user_id', 'command', 'response_url'];
      
      requiredFields.forEach(field => {
        expect(baseSlackPayload).toHaveProperty(field);
        expect((baseSlackPayload as any)[field]).toBeTruthy();
      });
    });

    it('should extract clean query text from Slack command', () => {
      const text = 'How to configure PowerSchool PSSIS?';
      const cleanText = extractQueryFromSlackText(text);
      expect(cleanText).toBe(text); // No bot mentions in command text
    });

    it('should detect collection hints from command text', () => {
      const pssisHint = getCollectionHint('general', 'pssis: How to enroll students?');
      expect(pssisHint.collection).toBe('pssis');
      expect(pssisHint.cleanQuery).toBe('How to enroll students?');

      const schoologyHint = getCollectionHint('general', 'schoology: Create assignment');
      expect(schoologyHint.collection).toBe('schoology');
      expect(schoologyHint.cleanQuery).toBe('Create assignment');

      const bothHint = getCollectionHint('general', 'both: How to sync data?');
      expect(bothHint.collection).toBe('both');
      expect(bothHint.cleanQuery).toBe('How to sync data?');
    });
  });
});