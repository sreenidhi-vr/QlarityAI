/**
 * Tests for Slack Platform Adapter
 */

import { toPlatformContext, formatResponseForSlack } from '../src/adapters/platform/slackAdapter';
import type { SlackEventPayload, SlackCommandPayload } from '../src/types';
import type { OrchestratorResult } from '../src/core/orchestrator/unifiedOrchestrator';

describe('SlackAdapter', () => {
  describe('toPlatformContext', () => {
    it('should convert Slack event to platform context', () => {
      const eventPayload: SlackEventPayload = {
        token: 'test-token',
        team_id: 'T123456',
        api_app_id: 'A123456',
        event: {
          type: 'app_mention',
          user: 'U123456',
          text: '<@U987654> How do I create a user?',
          ts: '1234567890.123456',
          channel: 'C123456',
          channel_type: 'channel'
        },
        type: 'event_callback',
        event_id: 'Ev123456',
        event_time: 1234567890
      };

      const context = toPlatformContext(eventPayload);

      expect(context).toEqual({
        platform: 'slack',
        userId: 'U123456',
        channelId: 'C123456',
        query: 'How do I create a user?',
        metadata: {
          eventType: 'app_mention',
          channelType: 'channel',
          messageTs: '1234567890.123456',
          rawText: '<@U987654> How do I create a user?',
          teamId: 'T123456'
        }
      });
    });

    it('should convert Slack command to platform context', () => {
      const commandPayload: SlackCommandPayload = {
        token: 'test-token',
        team_id: 'T123456',
        team_domain: 'test-team',
        channel_id: 'C123456',
        channel_name: 'general',
        user_id: 'U123456',
        user_name: 'testuser',
        command: '/ask',
        text: 'How to enroll students?',
        response_url: 'https://hooks.slack.com/commands/123/456',
        trigger_id: '123.456.789'
      };

      const context = toPlatformContext(commandPayload);

      expect(context).toEqual({
        platform: 'slack',
        userId: 'U123456',
        channelId: 'C123456',
        query: 'How to enroll students?',
        metadata: {
          command: '/ask',
          channelName: 'general',
          userName: 'testuser',
          responseUrl: 'https://hooks.slack.com/commands/123/456',
          triggerId: '123.456.789',
          teamId: 'T123456'
        }
      });
    });
  });

  describe('formatResponseForSlack', () => {
    const mockResult: OrchestratorResult = {
      text: 'To create a user, follow these steps...',
      summary: 'User creation steps',
      sources: [
        {
          id: 'doc1',
          title: 'PowerSchool Guide',
          url: 'https://docs.powerschool.com/guide',
          snippet: 'User management section...',
          retrieval_score: 0.95
        }
      ],
      confidence: 0.85,
      intent: 'instructions',
      platformHints: {
        collection: 'pssis-admin'
      },
      metadata: {
        processingTimeMs: 1500,
        contextId: 'test-context-123',
        platform: 'slack',
        userId: 'U123456',
        channelId: 'C123456'
      }
    };

    it('should format response for Slack with buttons', () => {
      const formatted = formatResponseForSlack(mockResult, {
        includeButtons: true,
        maxTextLength: 3000
      });

      expect(formatted.text).toBe('User creation steps');
      expect(formatted.blocks).toHaveLength(4); // Main section, sources, buttons, context
      expect(formatted.blocks?.[2]?.type).toBe('actions');
    });

    it('should format response without buttons', () => {
      const formatted = formatResponseForSlack(mockResult, {
        includeButtons: false
      });

      expect(formatted.blocks.find(block => block.type === 'actions')).toBeUndefined();
    });

    it('should truncate long text', () => {
      const longResult = {
        ...mockResult,
        text: 'A'.repeat(4000)
      };

      const formatted = formatResponseForSlack(longResult, {
        maxTextLength: 1000
      });

      expect(formatted.blocks?.[0]?.text?.text?.length).toBeLessThan(1000);
    });

    it('should add confidence warning for low confidence', () => {
      const lowConfidenceResult = {
        ...mockResult,
        confidence: 0.5
      };

      const formatted = formatResponseForSlack(lowConfidenceResult);

      expect(formatted.blocks.some(block =>
        block.type === 'context' &&
        block.elements?.[0]?.text &&
        (typeof block.elements[0].text === 'string' ?
          block.elements[0].text.includes('Confidence') :
          block.elements[0].text.text?.includes('Confidence'))
      )).toBe(true);
    });
  });
});