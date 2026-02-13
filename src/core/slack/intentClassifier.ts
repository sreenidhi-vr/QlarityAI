/**
 * Intent classification and response formatting for Slack queries
 * Uses LLM to classify user intent and format responses accordingly
 */

import type { 
  LLMAdapter, 
  ChatMessage, 
  IntentClassificationResult, 
  CollectionClassificationResult,
  SlackRAGResponse,
  SlackBlock,
  AskResponse 
} from '@/types';

export class SlackIntentClassifier {
  constructor(private llmAdapter: LLMAdapter) {}

  /**
   * Classify user intent from query text
   */
  async classifyIntent(query: string): Promise<IntentClassificationResult> {
    try {
      const systemPrompt = `You are an intent classifier. Analyze user queries and classify them into one of three categories:

1. "details" - User wants factual information, explanations, or specific details about a topic
2. "instructions" - User wants step-by-step instructions, procedures, or how-to guidance  
3. "other" - General questions, greetings, or unclear requests

Respond ONLY with valid JSON in this format:
{
  "intent": "details|instructions|other",
  "confidence": 0.0-1.0,
  "reasoning": "brief explanation"
}

Examples:
- "How does student enrollment work?" → {"intent": "details", "confidence": 0.9, "reasoning": "Asking for explanation of a process"}
- "How do I enroll a student?" → {"intent": "instructions", "confidence": 0.95, "reasoning": "Asking for step-by-step procedure"}
- "What are the system requirements?" → {"intent": "details", "confidence": 0.8, "reasoning": "Asking for factual information"}
- "Hello" → {"intent": "other", "confidence": 0.9, "reasoning": "Greeting, not a knowledge request"}`;

      const messages: ChatMessage[] = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Classify this query: "${query}"` }
      ];

      const response = await this.llmAdapter.generate(messages, {
        max_tokens: 200,
        temperature: 0.1
      });

      const parsed = JSON.parse(response.trim());
      
      // Validate response structure
      if (!parsed.intent || !['details', 'instructions', 'other'].includes(parsed.intent)) {
        throw new Error('Invalid intent classification');
      }

      return {
        intent: parsed.intent,
        confidence: Math.min(Math.max(parsed.confidence || 0.5, 0), 1),
        reasoning: parsed.reasoning
      };

    } catch (error) {
      // Fallback classification based on keywords
      return this.fallbackClassifyIntent(query);
    }
  }

  /**
   * Classify which knowledge base collection to search
   */
  async classifyCollection(query: string, channelHint?: string): Promise<CollectionClassificationResult> {
    try {
      const systemPrompt = `You are a knowledge base classifier. Determine which PowerSchool documentation to search based on user queries.

Collections:
- "pssis" - PowerSchool Student Information System (PSSIS-Admin) - student records, enrollment, scheduling, grades, reports
- "schoology" - Schoology Learning Management System - courses, assignments, gradebook, communication
- "both" - Query could apply to either system or needs both

Consider channel context if provided. Respond ONLY with valid JSON:
{
  "collection": "pssis|schoology|both", 
  "confidence": 0.0-1.0,
  "reasoning": "brief explanation"
}

Examples:
- "How to enroll students?" → {"collection": "pssis", "confidence": 0.9, "reasoning": "Student enrollment is PSSIS functionality"}
- "How to create assignments?" → {"collection": "schoology", "confidence": 0.9, "reasoning": "Assignment creation is Schoology LMS feature"}
- "How to sync grades?" → {"collection": "both", "confidence": 0.8, "reasoning": "Grade syncing involves both systems"}`;

      const userPrompt = channelHint 
        ? `Query: "${query}"\nChannel context: "${channelHint}"`
        : `Query: "${query}"`;

      const messages: ChatMessage[] = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ];

      const response = await this.llmAdapter.generate(messages, {
        max_tokens: 150,
        temperature: 0.1
      });

      const parsed = JSON.parse(response.trim());
      
      if (!parsed.collection || !['pssis', 'schoology', 'both'].includes(parsed.collection)) {
        throw new Error('Invalid collection classification');
      }

      return {
        collection: parsed.collection,
        confidence: Math.min(Math.max(parsed.confidence || 0.5, 0), 1),
        reasoning: parsed.reasoning
      };

    } catch (error) {
      return this.fallbackClassifyCollection(query, channelHint);
    }
  }

  /**
   * Format RAG response for Slack using Block Kit
   */
  async formatSlackResponse(
    query: string,
    ragResponse: AskResponse,
    intent: IntentClassificationResult
  ): Promise<SlackRAGResponse> {
    try {
      const systemPrompt = `You are a Slack response formatter. Convert RAG responses into Slack Block Kit format based on user intent.

Input will be a query, RAG answer, and intent classification. Output ONLY valid JSON with this structure:
{
  "text": "fallback text for notifications",
  "blocks": [/* Slack Block Kit blocks array */],
  "confidence": 0.0-1.0
}

Formatting rules:
- For "details" intent: Create professional summary with bullet points for key facts
- For "instructions" intent: Create numbered steps with prerequisites and expected outcomes  
- Use mrkdwn formatting (*bold*, _italic_, \`code\`)
- Keep blocks concise (max 3000 chars per text block)
- Include "Show sources" button for citations
- Use appropriate emojis sparingly for readability

Block Kit structure:
- Use "section" blocks for main content
- Use "actions" block for buttons
- Use "context" block for metadata
- Text type should be "mrkdwn" for rich formatting`;

      const userPrompt = JSON.stringify({
        query,
        intent: intent.intent,
        rag_answer: ragResponse.answer,
        summary: ragResponse.summary,
        steps: ragResponse.steps,
        citations_count: ragResponse.citations.length,
        retrieved_docs_count: ragResponse.retrieved_docs.length
      });

      const messages: ChatMessage[] = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ];

      const response = await this.llmAdapter.generate(messages, {
        max_tokens: 1500,
        temperature: 0.1
      });

      const parsed = JSON.parse(response.trim());
      
      // Validate and enhance the response
      const slackResponse: SlackRAGResponse = {
        text: parsed.text || ragResponse.summary,
        blocks: this.validateAndEnhanceBlocks(parsed.blocks || []),
        confidence: Math.min(Math.max(parsed.confidence || 0.8, 0), 1),
        intent: intent.intent,
        sources: ragResponse.retrieved_docs.map(doc => ({
          id: doc.id,
          url: ragResponse.citations.find(c => c.title)?.url || '#',
          title: ragResponse.citations.find(c => c.title)?.title || 'Source',
          snippet: doc.excerpt,
          retrieval_score: doc.score
        }))
      };

      return slackResponse;

    } catch (error) {
      // Fallback to simple formatting
      return this.fallbackFormatResponse(query, ragResponse, intent);
    }
  }

  /**
   * Fallback intent classification using keywords
   */
  private fallbackClassifyIntent(query: string): IntentClassificationResult {
    const lowerQuery = query.toLowerCase();
    
    // Instruction keywords
    const instructionWords = ['how to', 'how do i', 'steps', 'procedure', 'process', 'guide', 'tutorial'];
    const hasInstructionWords = instructionWords.some(word => lowerQuery.includes(word));
    
    // Detail keywords
    const detailWords = ['what is', 'what are', 'explain', 'define', 'difference', 'requirements'];
    const hasDetailWords = detailWords.some(word => lowerQuery.includes(word));
    
    if (hasInstructionWords && !hasDetailWords) {
      return { intent: 'instructions', confidence: 0.7, reasoning: 'Contains instruction keywords' };
    } else if (hasDetailWords && !hasInstructionWords) {
      return { intent: 'details', confidence: 0.7, reasoning: 'Contains detail request keywords' };
    } else if (lowerQuery.length < 10) {
      return { intent: 'other', confidence: 0.6, reasoning: 'Very short query' };
    } else {
      return { intent: 'details', confidence: 0.5, reasoning: 'Default classification' };
    }
  }

  /**
   * Fallback collection classification using keywords
   */
  private fallbackClassifyCollection(query: string, channelHint?: string): CollectionClassificationResult {
    const lowerQuery = query.toLowerCase();
    const lowerChannel = (channelHint || '').toLowerCase();
    
    // PSSIS keywords
    const pssisWords = ['student', 'enrollment', 'grade', 'schedule', 'report', 'pssis', 'sis'];
    const hasPssisWords = pssisWords.some(word => lowerQuery.includes(word) || lowerChannel.includes(word));
    
    // Schoology keywords  
    const schoologyWords = ['course', 'assignment', 'gradebook', 'schoology', 'lms', 'learning'];
    const hasSchoologyWords = schoologyWords.some(word => lowerQuery.includes(word) || lowerChannel.includes(word));
    
    if (hasPssisWords && !hasSchoologyWords) {
      return { collection: 'pssis', confidence: 0.7, reasoning: 'Contains PSSIS-related keywords' };
    } else if (hasSchoologyWords && !hasPssisWords) {
      return { collection: 'schoology', confidence: 0.7, reasoning: 'Contains Schoology-related keywords' };
    } else if (lowerChannel.includes('pssis')) {
      return { collection: 'pssis', confidence: 0.8, reasoning: 'PSSIS channel context' };
    } else if (lowerChannel.includes('schoology')) {
      return { collection: 'schoology', confidence: 0.8, reasoning: 'Schoology channel context' };
    } else {
      return { collection: 'both', confidence: 0.5, reasoning: 'Ambiguous query, search both' };
    }
  }

  /**
   * Validate and enhance Slack blocks
   */
  private validateAndEnhanceBlocks(blocks: any[]): SlackBlock[] {
    const validBlocks: SlackBlock[] = [];
    
    for (const block of blocks) {
      if (block.type === 'section' && block.text?.text) {
        validBlocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: block.text.text.substring(0, 3000) // Slack limit
          }
        });
      }
    }
    
    // Add actions block with show sources button
    validBlocks.push({
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: {
            type: 'plain_text',
            text: '📋 Show Sources'
          },
          value: 'show_sources',
          action_id: 'show_sources'
        },
        {
          type: 'button',
          text: {
            type: 'plain_text',
            text: '🔄 Ask Follow-up'
          },
          value: 'ask_followup',
          action_id: 'ask_followup'
        }
      ]
    });
    
    return validBlocks;
  }

  /**
   * Fallback response formatting
   */
  private fallbackFormatResponse(
    _query: string,
    ragResponse: AskResponse,
    intent: IntentClassificationResult
  ): SlackRAGResponse {
    const blocks: SlackBlock[] = [];
    
    // Main content block
    if (intent.intent === 'instructions' && ragResponse.steps?.length) {
      const stepsText = ragResponse.steps
        .map((step, i) => `${i + 1}. ${step}`)
        .join('\n');
      
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Instructions:*\n${stepsText}`
        }
      });
    } else {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Answer:*\n${ragResponse.answer.substring(0, 2500)}`
        }
      });
    }
    
    // Add actions
    blocks.push({
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: {
            type: 'plain_text',
            text: '📋 Show Sources'
          },
          value: 'show_sources',
          action_id: 'show_sources'
        }
      ]
    });
    
    return {
      text: ragResponse.summary,
      blocks,
      confidence: 0.6,
      intent: intent.intent,
      sources: ragResponse.retrieved_docs.map(doc => ({
        id: doc.id,
        url: ragResponse.citations[0]?.url || '#',
        title: ragResponse.citations[0]?.title || 'Source',
        snippet: doc.excerpt,
        retrieval_score: doc.score
      }))
    };
  }
}