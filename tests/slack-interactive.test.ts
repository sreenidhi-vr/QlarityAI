/**
 * Unit tests for Slack interactive features
 */

// Jest globals are automatically available in the test environment
import { sourceCache } from '../src/core/slack/sourceCache';
import { 
  createInteractiveButtons, 
  createSourcesModal, 
  createFollowupModal,
  enhanceResponseWithButtons,
  generateResponseId
} from '../src/core/slack/messageBuilder';
import type { 
  SlackRAGResponse, 
  SourcesModalData,
  FollowupModalData
} from '../src/types';

describe('Source Cache', () => {
  beforeEach(() => {
    // Clear cache before each test
    sourceCache.cleanup();
  });

  it('should store and retrieve response data', () => {
    const responseId = 'test-response-123';
    const testData = {
      originalText: 'Test response text',
      sources: [
        {
          id: 'source-1',
          url: 'https://example.com/doc1',
          title: 'Test Document 1',
          snippet: 'This is a test snippet',
          retrieval_score: 0.95
        }
      ],
      userId: 'U123456',
      channelId: 'C789012',
      threadTs: '1234567890.123456'
    };

    sourceCache.store(responseId, testData);
    const retrieved = sourceCache.get(responseId);

    expect(retrieved).toBeTruthy();
    expect(retrieved?.responseId).toBe(responseId);
    expect(retrieved?.originalText).toBe(testData.originalText);
    expect(retrieved?.sources).toEqual(testData.sources);
    expect(retrieved?.userId).toBe(testData.userId);
    expect(retrieved?.channelId).toBe(testData.channelId);
    expect(retrieved?.threadTs).toBe(testData.threadTs);
  });

  it('should return null for non-existent response', () => {
    const result = sourceCache.get('non-existent-id');
    expect(result).toBeNull();
  });

  it('should get sources for response', () => {
    const responseId = 'test-response-456';
    const testSources = [
      {
        id: 'source-1',
        url: 'https://example.com/doc1',
        title: 'Test Document 1',
        snippet: 'Test snippet 1',
        retrieval_score: 0.95
      },
      {
        id: 'source-2',
        url: 'https://example.com/doc2',
        title: 'Test Document 2',
        snippet: 'Test snippet 2',
        retrieval_score: 0.87
      }
    ];

    sourceCache.store(responseId, {
      originalText: 'Test response',
      sources: testSources,
      userId: 'U123456',
      channelId: 'C789012'
    });

    const sources = sourceCache.getSources(responseId);
    expect(sources).toEqual(testSources);
  });

  it('should return empty array for sources of non-existent response', () => {
    const sources = sourceCache.getSources('non-existent-id');
    expect(sources).toEqual([]);
  });

  it('should delete cached response', () => {
    const responseId = 'test-response-789';
    sourceCache.store(responseId, {
      originalText: 'Test response',
      sources: [],
      userId: 'U123456',
      channelId: 'C789012'
    });

    expect(sourceCache.get(responseId)).toBeTruthy();
    
    const deleted = sourceCache.delete(responseId);
    expect(deleted).toBe(true);
    expect(sourceCache.get(responseId)).toBeNull();
  });
});

describe('Message Builder', () => {
  describe('createInteractiveButtons', () => {
    it('should create action block with show sources and ask followup buttons', () => {
      const responseId = 'test-response-123';
      const buttonBlock = createInteractiveButtons(responseId);

      expect(buttonBlock.type).toBe('actions');
      expect(buttonBlock.block_id).toBe(`interactive_actions_${responseId}`);
      expect(buttonBlock.elements).toHaveLength(2);

      const showSourcesButton = buttonBlock.elements![0] as any;
      expect(showSourcesButton.type).toBe('button');
      expect(showSourcesButton.text.text).toBe('📋 Show Sources');
      expect(showSourcesButton.action_id).toBe('show_sources');
      
      const buttonData = JSON.parse(showSourcesButton.value);
      expect(buttonData.responseId).toBe(responseId);

      const askFollowupButton = buttonBlock.elements![1] as any;
      expect(askFollowupButton.type).toBe('button');
      expect(askFollowupButton.text.text).toBe('🔄 Ask Follow-up');
      expect(askFollowupButton.action_id).toBe('ask_followup');
    });
  });

  describe('createSourcesModal', () => {
    it('should create modal with sources', () => {
      const sources: SourcesModalData['sources'] = [
        {
          id: 'source-1',
          title: 'Test Document 1',
          url: 'https://example.com/doc1',
          snippet: 'This is a test snippet for the first document',
          score: 0.95
        },
        {
          id: 'source-2',
          title: 'Test Document 2',
          url: 'https://example.com/doc2',
          snippet: 'This is a test snippet for the second document',
          score: 0.87
        }
      ];

      const modal = createSourcesModal(sources);

      expect(modal.type).toBe('modal');
      expect(modal.title.text).toBe('Sources for this answer');
      expect(modal.close.text).toBe('Close');
      expect(modal.blocks).toBeDefined();
      expect(modal.blocks.length).toBeGreaterThan(2); // Header + divider + sources
    });

    it('should create modal with no sources message', () => {
      const modal = createSourcesModal([]);

      expect(modal.type).toBe('modal');
      expect(modal.title.text).toBe('Sources for this answer');
      expect(modal.blocks).toHaveLength(1);
      expect(modal.blocks[0].text?.text).toContain('No sources available');
    });
  });

  describe('createFollowupModal', () => {
    it('should create followup modal with input field', () => {
      const followupData: FollowupModalData = {
        originalResponseId: 'test-response-123',
        originalText: 'This is the original response text',
        originalSources: []
      };

      const modal = createFollowupModal(followupData);

      expect(modal.type).toBe('modal');
      expect(modal.callback_id).toBe('followup_modal');
      expect(modal.title.text).toBe('Ask a follow-up');
      expect(modal.submit.text).toBe('Send');
      expect(modal.close.text).toBe('Cancel');

      const metadata = JSON.parse(modal.private_metadata);
      expect(metadata.originalResponseId).toBe(followupData.originalResponseId);
      expect(metadata.originalText).toBe(followupData.originalText);

      // Check for input block
      const inputBlock = modal.blocks.find((block: any) => block.type === 'input');
      expect(inputBlock).toBeDefined();
      expect(inputBlock?.element?.action_id).toBe('followup_question');
    });
  });

  describe('enhanceResponseWithButtons', () => {
    it('should add interactive buttons to response', () => {
      const response: SlackRAGResponse = {
        text: 'Test response',
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: 'This is a test response'
            }
          }
        ],
        confidence: 0.9,
        intent: 'details'
      };

      const responseId = 'test-response-123';
      const enhanced = enhanceResponseWithButtons(response, responseId);

      expect(enhanced.blocks).toHaveLength(2); // Original + buttons
      
      const buttonBlock = enhanced.blocks.find((block: any) => block.type === 'actions');
      expect(buttonBlock).toBeDefined();
      expect(buttonBlock.elements).toHaveLength(2);
    });

    it('should insert buttons before context blocks', () => {
      const response: SlackRAGResponse = {
        text: 'Test response',
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: 'This is a test response'
            }
          },
          {
            type: 'context',
            elements: [{
              type: 'mrkdwn',
              text: 'Context information'
            }]
          }
        ],
        confidence: 0.9,
        intent: 'details'
      };

      const responseId = 'test-response-123';
      const enhanced = enhanceResponseWithButtons(response, responseId);

      expect(enhanced.blocks).toHaveLength(3); // Original section + buttons + context
      expect(enhanced.blocks[1].type).toBe('actions'); // Buttons before context
      expect(enhanced.blocks[2].type).toBe('context'); // Context at the end
    });

    it('should not add duplicate buttons if they already exist', () => {
      const response: SlackRAGResponse = {
        text: 'Test response',
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: 'This is a test response'
            }
          },
          {
            type: 'actions',
            block_id: 'interactive_actions_existing',
            elements: [
              {
                type: 'button',
                text: { type: 'plain_text', text: '📋 Show Sources' },
                action_id: 'show_sources',
                value: '{"responseId":"existing-123"}'
              },
              {
                type: 'button',
                text: { type: 'plain_text', text: '🔄 Ask Follow-up' },
                action_id: 'ask_followup',
                value: '{"responseId":"existing-123"}'
              }
            ]
          }
        ],
        confidence: 0.9,
        intent: 'details'
      };

      const responseId = 'test-response-456';
      const enhanced = enhanceResponseWithButtons(response, responseId);

      // Should not add new buttons since they already exist
      expect(enhanced.blocks).toHaveLength(2); // Original section + existing buttons
      expect(enhanced.blocks[1].type).toBe('actions'); // Existing buttons remain
      expect(enhanced.blocks[1].block_id).toBe('interactive_actions_existing'); // Original block preserved
    });
  });

  describe('generateResponseId', () => {
    it('should generate unique response IDs', () => {
      const userId = 'U123456';
      const channelId = 'C789012';

      const id1 = generateResponseId(userId, channelId);
      const id2 = generateResponseId(userId, channelId);

      expect(id1).toBeDefined();
      expect(id2).toBeDefined();
      expect(id1).not.toBe(id2);
      expect(id1).toContain(userId);
      expect(id1).toContain(channelId);
    });
  });
});