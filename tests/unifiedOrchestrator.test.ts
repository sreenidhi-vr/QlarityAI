/**
 * Comprehensive tests for UnifiedOrchestrator
 * Tests the core orchestration logic for both Slack and Teams platforms
 */

import { UnifiedOrchestrator, type PlatformQueryContext } from '../src/core/orchestrator/unifiedOrchestrator';
import type { RAGPipeline } from '../src/core/rag/ragPipeline';
import type { AskResponse } from '../src/types';

// Mock RAG Pipeline
const mockRAGPipeline = {
  process: jest.fn(),
  healthCheck: jest.fn(),
  getStats: jest.fn()
} as unknown as RAGPipeline;

// Mock Metrics
const mockMetrics = {
  incrementCounter: jest.fn(),
  recordDuration: jest.fn()
};

describe('UnifiedOrchestrator', () => {
  let orchestrator: UnifiedOrchestrator;
  let mockSlackContext: PlatformQueryContext;
  let mockTeamsContext: PlatformQueryContext;
  let mockRAGResponse: AskResponse;

  beforeEach(() => {
    jest.clearAllMocks();
    orchestrator = new UnifiedOrchestrator(mockRAGPipeline, mockMetrics);

    mockSlackContext = {
      platform: 'slack',
      userId: 'U123456',
      channelId: 'C123456',
      query: 'How do I create a user in PowerSchool?',
      metadata: {
        channelName: 'general',
        responseUrl: 'https://hooks.slack.com/commands/1234/5678'
      }
    };

    mockTeamsContext = {
      platform: 'teams',
      userId: '29:1a2b3c4d5e6f',
      channelId: '19:abc123@thread.skype',
      query: 'What are the steps to enroll a student?',
      metadata: {
        activityId: 'f:12345',
        serviceUrl: 'https://smba.trafficmanager.net/amer/'
      }
    };

    mockRAGResponse = {
      answer: 'To create a user in PowerSchool, follow these steps:\n1. Navigate to System Administration\n2. Select User Accounts\n3. Click Add User...',
      summary: 'Steps to create a user in PowerSchool',
      citations: [
        {
          title: 'PowerSchool User Management',
          url: 'https://support.powerschool.com/user-management'
        }
      ],
      retrieved_docs: [
        {
          id: 'doc1',
          score: 0.95,
          excerpt: 'User creation process in PowerSchool involves...'
        }
      ],
      debug_info: {
        is_fallback: false,
        pipeline_stage: 'completed',
        processing_time_ms: 1500,
        documents_found: 3,
        used_mock_embedding: false
      }
    };

    (mockRAGPipeline.process as jest.Mock).mockResolvedValue(mockRAGResponse);
  });

  describe('constructor', () => {
    it('should initialize with required dependencies', () => {
      expect(orchestrator).toBeInstanceOf(UnifiedOrchestrator);
    });

    it('should work without metrics (no-op fallback)', () => {
      const orchestratorWithoutMetrics = new UnifiedOrchestrator(mockRAGPipeline);
      expect(orchestratorWithoutMetrics).toBeInstanceOf(UnifiedOrchestrator);
    });
  });

  describe('handlePlatformQuery', () => {

    it('should process Slack query successfully', async () => {
      const result = await orchestrator.handlePlatformQuery(mockSlackContext);

      expect(result).toMatchObject({
        text: mockRAGResponse.answer,
        summary: mockRAGResponse.summary,
        confidence: expect.any(Number),
        intent: expect.any(String),
        platformHints: expect.any(Object),
        metadata: expect.objectContaining({
          platform: 'slack',
          userId: 'U123456',
          channelId: 'C123456',
          processingTimeMs: expect.any(Number),
          contextId: expect.any(String)
        })
      });

      expect(mockRAGPipeline.process).toHaveBeenCalledWith(
        'How do I create a user in PowerSchool?',
        expect.objectContaining({
          topK: 8,
          contextWindowTokens: 3000,
          similarityThreshold: 0.3
        })
      );

      expect(mockMetrics.incrementCounter).toHaveBeenCalledWith('orchestrator_calls_total', { platform: 'slack' });
    });

    it('should process Teams query successfully', async () => {
      const result = await orchestrator.handlePlatformQuery(mockTeamsContext);

      expect(result).toMatchObject({
        text: mockRAGResponse.answer,
        summary: mockRAGResponse.summary,
        confidence: expect.any(Number),
        intent: expect.any(String),
        metadata: expect.objectContaining({
          platform: 'teams',
          userId: '29:1a2b3c4d5e6f',
          channelId: '19:abc123@thread.skype'
        })
      });

      expect(mockMetrics.incrementCounter).toHaveBeenCalledWith('orchestrator_calls_total', { platform: 'teams' });
    });

    it('should handle follow-up queries with parent context', async () => {
      const followupContext: PlatformQueryContext = {
        ...mockSlackContext,
        query: 'What permissions should I set?',
        metadata: {
          ...mockSlackContext.metadata,
          parentContextId: 'parent_context_123'
        }
      };

      await orchestrator.handlePlatformQuery(followupContext);

      expect(mockRAGPipeline.process).toHaveBeenCalledWith(
        'What permissions should I set?',
        expect.objectContaining({
          contextWindowTokens: 4000, // Increased for follow-ups
          topK: 10 // Increased for follow-ups
        })
      );
    });

    it('should extract platform hints correctly', async () => {
      const instructionContext: PlatformQueryContext = {
        ...mockSlackContext,
        query: 'How to set up student enrollment step by step',
        metadata: {
          channelName: 'pssis-help'
        }
      };

      await orchestrator.handlePlatformQuery(instructionContext);

      expect(mockRAGPipeline.process).toHaveBeenCalledWith(
        'How to set up student enrollment step by step',
        expect.objectContaining({
          collections: ['pssis-admin'] // Should detect PSSIS from channel name
        })
      );
    });

    it('should handle collection hints from metadata', async () => {
      const contextWithCollection: PlatformQueryContext = {
        ...mockSlackContext,
        metadata: {
          collection: 'schoology'
        }
      };

      await orchestrator.handlePlatformQuery(contextWithCollection);

      expect(mockRAGPipeline.process).toHaveBeenCalledWith(
        mockSlackContext.query,
        expect.objectContaining({
          collections: ['schoology']
        })
      );
    });

    it('should handle empty query error', async () => {
      const emptyContext: PlatformQueryContext = {
        ...mockSlackContext,
        query: ''
      };

      const result = await orchestrator.handlePlatformQuery(emptyContext);

      expect(result.text).toContain('Please provide a more detailed question');
      expect(result.confidence).toBe(0);
      expect(result.sources).toHaveLength(0);
      expect(mockMetrics.incrementCounter).toHaveBeenCalledWith(
        'orchestrator_error_total',
        expect.objectContaining({ platform: 'slack' })
      );
    });

    it('should handle RAG pipeline errors gracefully', async () => {
      const ragError = new Error('RAG processing failed');
      (mockRAGPipeline.process as jest.Mock).mockRejectedValue(ragError);

      const result = await orchestrator.handlePlatformQuery(mockSlackContext);

      expect(result.text).toContain('An unexpected error occurred');
      expect(result.confidence).toBe(0);
      expect(mockMetrics.incrementCounter).toHaveBeenCalledWith(
        'orchestrator_error_total',
        expect.objectContaining({
          platform: 'slack',
          error_type: 'unknown'
        })
      );
    });

    it('should calculate confidence correctly', async () => {
      // High quality response
      const highQualityResponse: AskResponse = {
        ...mockRAGResponse,
        answer: 'A very detailed answer with lots of useful information that demonstrates comprehensive knowledge.',
        steps: ['Step 1', 'Step 2', 'Step 3'],
        citations: [
          { title: 'Source 1', url: 'https://example.com/1' },
          { title: 'Source 2', url: 'https://example.com/2' }
        ],
        retrieved_docs: [
          { id: 'doc1', score: 0.95, excerpt: 'excerpt1' },
          { id: 'doc2', score: 0.90, excerpt: 'excerpt2' },
          { id: 'doc3', score: 0.85, excerpt: 'excerpt3' }
        ]
      };

      (mockRAGPipeline.process as jest.Mock).mockResolvedValue(highQualityResponse);

      const result = await orchestrator.handlePlatformQuery(mockSlackContext);

      expect(result.confidence).toBeGreaterThan(0.8); // High confidence expected
    });

    it('should handle fallback responses', async () => {
      const fallbackResponse: AskResponse = {
        ...mockRAGResponse,
        answer: 'I couldn\'t find specific information about that.',
        debug_info: {
          is_fallback: true,
          fallback_reason: 'EMPTY_RETRIEVAL_RESULTS',
          pipeline_stage: 'fallback',
          processing_time_ms: 500,
          documents_found: 0
        }
      };

      (mockRAGPipeline.process as jest.Mock).mockResolvedValue(fallbackResponse);

      const result = await orchestrator.handlePlatformQuery(mockSlackContext);

      expect(result.confidence).toBeLessThan(0.5); // Low confidence for fallback
    });

    it('should determine intent correctly', async () => {
      // Test instructions intent
      const instructionsContext: PlatformQueryContext = {
        ...mockSlackContext,
        query: 'How to create a new student record step by step'
      };

      const instructionsResponse: AskResponse = {
        ...mockRAGResponse,
        steps: ['Step 1: Open PowerSchool', 'Step 2: Navigate to Students', 'Step 3: Click Add']
      };

      (mockRAGPipeline.process as jest.Mock).mockResolvedValue(instructionsResponse);

      const result = await orchestrator.handlePlatformQuery(instructionsContext);

      expect(result.intent).toBe('instructions');

      // Test details intent
      const detailsContext: PlatformQueryContext = {
        ...mockSlackContext,
        query: 'What is the student information system?'
      };

      (mockRAGPipeline.process as jest.Mock).mockResolvedValue(mockRAGResponse);

      const detailsResult = await orchestrator.handlePlatformQuery(detailsContext);

      expect(detailsResult.intent).toBe('details');
    });

    it('should normalize query text correctly', async () => {
      const contextWithMentions: PlatformQueryContext = {
        ...mockSlackContext,
        query: '<@U12345> How do I create a user?   Extra   spaces   '
      };

      await orchestrator.handlePlatformQuery(contextWithMentions);

      expect(mockRAGPipeline.process).toHaveBeenCalledWith(
        'How do I create a user? Extra spaces',
        expect.any(Object)
      );
    });

    it('should generate unique context IDs', async () => {
      const result1 = await orchestrator.handlePlatformQuery(mockSlackContext);
      const result2 = await orchestrator.handlePlatformQuery(mockSlackContext);

      expect(result1.metadata.contextId).not.toBe(result2.metadata.contextId);
      expect(result1.metadata.contextId).toMatch(/^slack_U123456_\d+_[a-z0-9]+$/);
    });

    it('should record processing metrics', async () => {
      await orchestrator.handlePlatformQuery(mockSlackContext);

      expect(mockMetrics.incrementCounter).toHaveBeenCalledWith('orchestrator_calls_total', { platform: 'slack' });
      expect(mockMetrics.recordDuration).toHaveBeenCalledWith(
        'rag_processing_duration_ms',
        expect.any(Number),
        { platform: 'slack' }
      );
      expect(mockMetrics.incrementCounter).toHaveBeenCalledWith(
        'orchestrator_success_total',
        expect.objectContaining({ platform: 'slack' })
      );
    });
  });

  describe('getStats', () => {
    it('should return orchestrator and RAG pipeline stats', async () => {
      const mockRagStats = {
        embeddingModel: 'amazon.titan-embed-text-v2:0',
        embeddingDimensions: 1536,
        llmModel: 'gpt-4',
        llmMaxTokens: 4000
      };

      (mockRAGPipeline.getStats as jest.Mock).mockReturnValue(mockRagStats);

      const stats = await orchestrator.getStats();

      expect(stats).toMatchObject({
        platform: 'unified',
        ragPipeline: mockRagStats,
        uptime: expect.any(Number)
      });
    });
  });

  describe('healthCheck', () => {
    it('should return healthy status when all components are healthy', async () => {
      const mockRagHealth = {
        status: 'healthy' as const,
        components: {
          vectorStore: true,
          embedding: true,
          llm: true
        },
        details: {
          embeddingDimensions: 1536,
          llmModel: 'gpt-4'
        }
      };

      (mockRAGPipeline.healthCheck as jest.Mock).mockResolvedValue(mockRagHealth);

      const health = await orchestrator.healthCheck();

      expect(health).toMatchObject({
        status: 'healthy',
        orchestrator: true,
        ragPipeline: true,
        details: expect.objectContaining({
          ragComponents: mockRagHealth.components,
          ragDetails: mockRagHealth.details
        })
      });
    });

    it('should return unhealthy status when RAG pipeline is unhealthy', async () => {
      const mockRagHealth = {
        status: 'unhealthy' as const,
        components: {
          vectorStore: false,
          embedding: true,
          llm: true
        },
        details: {
          error: 'Vector store connection failed'
        }
      };

      (mockRAGPipeline.healthCheck as jest.Mock).mockResolvedValue(mockRagHealth);

      const health = await orchestrator.healthCheck();

      expect(health).toMatchObject({
        status: 'unhealthy',
        orchestrator: true,
        ragPipeline: false
      });
    });

    it('should handle health check errors gracefully', async () => {
      (mockRAGPipeline.healthCheck as jest.Mock).mockRejectedValue(new Error('Health check failed'));

      const health = await orchestrator.healthCheck();

      expect(health).toMatchObject({
        status: 'unhealthy',
        orchestrator: false,
        ragPipeline: false,
        details: {
          error: 'Health check failed'
        }
      });
    });
  });

  describe('source transformation', () => {
    it('should transform retrieved docs and citations to unified format', async () => {
      const responseWithSources: AskResponse = {
        ...mockRAGResponse,
        citations: [
          { title: 'PowerSchool Guide', url: 'https://docs.powerschool.com/guide' },
          { title: 'Admin Manual', url: 'https://docs.powerschool.com/admin' }
        ],
        retrieved_docs: [
          { id: 'doc1', score: 0.95, excerpt: 'First document excerpt...' },
          { id: 'doc2', score: 0.87, excerpt: 'Second document excerpt...' }
        ]
      };

      (mockRAGPipeline.process as jest.Mock).mockResolvedValue(responseWithSources);

      const result = await orchestrator.handlePlatformQuery(mockSlackContext);

      expect(result.sources).toHaveLength(4); // 2 docs + 2 citations
      expect(result.sources[0]).toMatchObject({
        id: 'doc1',
        title: expect.any(String),
        url: expect.any(String),
        snippet: 'First document excerpt...',
        retrieval_score: 0.95
      });
    });

    it('should handle responses with no sources', async () => {
      const responseWithoutSources: AskResponse = {
        ...mockRAGResponse,
        citations: [],
        retrieved_docs: []
      };

      (mockRAGPipeline.process as jest.Mock).mockResolvedValue(responseWithoutSources);

      const result = await orchestrator.handlePlatformQuery(mockSlackContext);

      expect(result.sources).toHaveLength(0);
    });
  });
});