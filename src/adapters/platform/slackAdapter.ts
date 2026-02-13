/**
 * Slack Platform Adapter
 * Transforms Slack events and formats responses specifically for Slack
 * Integrates with the UnifiedOrchestrator while maintaining Slack-specific formatting
 */

import type {
  SlackEventPayload,
  SlackCommandPayload,
  SlackActionPayload,
  SlackBlock
} from '@/types';
import type { PlatformQueryContext, OrchestratorResult } from '@/core/orchestrator/unifiedOrchestrator';
import { extractQueryFromSlackText } from '@/utils/slackValidation';

/**
 * Transform Slack event to platform query context
 */
export function toPlatformContext(
  payload: SlackEventPayload | SlackCommandPayload | SlackActionPayload,
  query?: string
): PlatformQueryContext {
  let userId: string;
  let channelId: string;
  let queryText: string;
  let threadId: string | undefined;
  let metadata: Record<string, any> = {};

  if ('event' in payload && payload.event) {
    // Slack Events API
    const event = payload.event;
    userId = event.user;
    channelId = event.channel;
    queryText = extractQueryFromSlackText(event.text || '');
    threadId = event.thread_ts;
    
    metadata = {
      eventType: event.type,
      channelType: event.channel_type,
      messageTs: event.ts,
      rawText: event.text,
      teamId: payload.team_id
    };
  } else if ('command' in payload) {
    // Slack Slash Command
    userId = payload.user_id;
    channelId = payload.channel_id;
    queryText = payload.text || '';
    
    metadata = {
      command: payload.command,
      channelName: payload.channel_name,
      userName: payload.user_name,
      responseUrl: payload.response_url,
      triggerId: payload.trigger_id,
      teamId: payload.team_id
    };
  } else if ('actions' in payload) {
    // Slack Interactive Action
    userId = payload.user.id;
    channelId = payload.channel.id;
    queryText = query || '';
    
    metadata = {
      actionType: payload.type,
      actions: payload.actions,
      responseUrl: payload.response_url,
      triggerId: payload.trigger_id,
      teamId: payload.team.id
    };
  } else {
    throw new Error('Unsupported Slack payload type');
  }

  return {
    platform: 'slack',
    userId,
    channelId,
    ...(threadId && { threadId }),
    query: queryText,
    metadata
  };
}

/**
 * Format orchestrator result for Slack Block Kit format
 */
export function formatResponseForSlack(
  result: OrchestratorResult,
  options: {
    includeButtons?: boolean;
    maxTextLength?: number;
    ephemeral?: boolean;
  } = {}
): {
  text: string;
  blocks: SlackBlock[];
  response_type?: 'ephemeral' | 'in_channel';
} {
  const {
    includeButtons = true,
    maxTextLength = 3000,
    ephemeral = false
  } = options;

  // Truncate text if too long for Slack
  let displayText = result.text;
  if (displayText.length > maxTextLength) {
    displayText = displayText.substring(0, maxTextLength - 100) + '\n\n_Response truncated due to length..._';
  }

  const blocks: SlackBlock[] = [];

  // Main response section
  blocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: displayText
    }
  });

  // Add confidence indicator if low
  if (result.confidence < 0.7) {
    blocks.push({
      type: 'context',
      elements: [{
        type: 'mrkdwn',
        text: `⚠️ *Confidence: ${Math.round(result.confidence * 100)}%* - This answer may be incomplete or require verification.`
      }]
    });
  }

  // Add sources section if available
  if (result.sources.length > 0) {
    const sourcesList = result.sources
      .slice(0, 3) // Limit to top 3 sources
      .map((source, index) => {
        const scoreText = source.retrieval_score > 0 ? ` (${Math.round(source.retrieval_score * 100)}%)` : '';
        return `${index + 1}. <${source.url}|${source.title}>${scoreText}`;
      })
      .join('\n');

    blocks.push({
      type: 'context',
      elements: [{
        type: 'mrkdwn',
        text: `📚 *Top Sources:*\n${sourcesList}`
      }]
    });
  }

  // Add interactive buttons
  if (includeButtons && !ephemeral) {
    const buttonData = {
      responseId: result.metadata.contextId,
      originalMessageTs: result.metadata.platform,
      channelId: result.metadata.channelId,
      userId: result.metadata.userId
    };

    blocks.push({
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: {
            type: 'plain_text',
            text: '🔍 Show Sources'
          },
          value: JSON.stringify(buttonData),
          action_id: 'show_sources',
          style: 'primary'
        },
        {
          type: 'button',
          text: {
            type: 'plain_text',
            text: '💬 Ask Follow-up'
          },
          value: JSON.stringify(buttonData),
          action_id: 'ask_followup'
        }
      ]
    });
  }

  // Add platform hints context
  const contextElements: string[] = [];
  
  if (result.platformHints.collection) {
    const collectionLabel = result.platformHints.collection === 'pssis-admin' 
      ? '📊 PowerSchool PSSIS-Admin'
      : '📚 Schoology LMS';
    contextElements.push(`*Source:* ${collectionLabel}`);
  }

  if (result.intent === 'instructions') {
    contextElements.push('*Type:* Step-by-step guide');
  } else if (result.intent === 'details') {
    contextElements.push('*Type:* Detailed explanation');
  }

  contextElements.push(`*Processing time:* ${result.metadata.processingTimeMs}ms`);

  if (contextElements.length > 0) {
    blocks.push({
      type: 'context',
      elements: [{
        type: 'mrkdwn',
        text: contextElements.join(' • ')
      }]
    });
  }

  return {
    text: result.summary || result.text.substring(0, 100) + '...',
    blocks,
    ...(ephemeral && { response_type: 'ephemeral' })
  };
}

/**
 * Create Slack modal for displaying sources
 */
export function createSourcesModal(sources: OrchestratorResult['sources']): {
  type: 'modal';
  callback_id: 'sources_modal';
  title: { type: 'plain_text'; text: string };
  close: { type: 'plain_text'; text: string };
  blocks: SlackBlock[];
} {
  const blocks: SlackBlock[] = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*📚 Sources used to generate this answer:*'
      }
    },
    {
      type: 'divider'
    }
  ];

  sources.forEach((source, index) => {
    const score = source.retrieval_score > 0 
      ? ` • *Relevance:* ${Math.round(source.retrieval_score * 100)}%`
      : '';
    
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${index + 1}. <${source.url}|${source.title}>*${score}\n_${source.snippet}_`
      }
    });

    if (index < sources.length - 1) {
      blocks.push({ type: 'divider' });
    }
  });

  return {
    type: 'modal',
    callback_id: 'sources_modal',
    title: {
      type: 'plain_text',
      text: 'Answer Sources'
    },
    close: {
      type: 'plain_text',
      text: 'Close'
    },
    blocks
  };
}

/**
 * Create Slack modal for follow-up questions
 */
export function createFollowupModal(
  originalResult: OrchestratorResult
): {
  type: 'modal';
  callback_id: 'followup_modal';
  title: { type: 'plain_text'; text: string };
  submit: { type: 'plain_text'; text: string };
  close: { type: 'plain_text'; text: string };
  private_metadata: string;
  blocks: SlackBlock[];
} {
  const metadata = {
    originalResponseId: originalResult.metadata.contextId,
    originalText: originalResult.text.substring(0, 500),
    originalSources: originalResult.sources.slice(0, 3),
    parentContextId: originalResult.metadata.contextId
  };

  const blocks: SlackBlock[] = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*💬 Ask a follow-up question about this answer:*'
      }
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `_Original answer: "${originalResult.summary || originalResult.text.substring(0, 150)}..."_`
      }
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*Your Question:*'
      },
      accessory: {
        type: 'button',
        text: {
          type: 'plain_text',
          text: 'Click to add input'
        },
        action_id: 'followup_input_placeholder'
      }
    }
  ];

  return {
    type: 'modal',
    callback_id: 'followup_modal',
    title: {
      type: 'plain_text',
      text: 'Follow-up Question'
    },
    submit: {
      type: 'plain_text',
      text: 'Ask Question'
    },
    close: {
      type: 'plain_text',
      text: 'Cancel'
    },
    private_metadata: JSON.stringify(metadata),
    blocks
  };
}

/**
 * Create error response for Slack
 */
export function createSlackErrorResponse(
  error: string,
  ephemeral: boolean = false
): {
  text: string;
  blocks: SlackBlock[];
  response_type?: 'ephemeral';
} {
  return {
    text: error,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `❌ ${error}`
        }
      },
      {
        type: 'context',
        elements: [{
          type: 'mrkdwn',
          text: '💡 Try rephrasing your question or check our <https://support.powerschool.com/|documentation>'
        }]
      }
    ],
    ...(ephemeral && { response_type: 'ephemeral' })
  };
}

/**
 * Extract button action data from Slack interaction
 */
export function extractButtonActionData(payload: SlackActionPayload): {
  actionId: string;
  actionValue: string;
  buttonData: any;
} | null {
  if (payload.type !== 'block_actions' || !payload.actions || payload.actions.length === 0) {
    return null;
  }

  const action = payload.actions[0];
  if (!action || !action.action_id || !action.value) {
    return null;
  }

  try {
    const buttonData = JSON.parse(action.value);
    return {
      actionId: action.action_id,
      actionValue: action.value,
      buttonData
    };
  } catch (error) {
    console.error('[SlackAdapter] Failed to parse button data:', error);
    return null;
  }
}

/**
 * Extract followup modal submission data
 */
export function extractFollowupData(payload: any): {
  followupQuestion: string;
  metadata: any;
} | null {
  try {
    if (payload.view?.callback_id !== 'followup_modal') {
      return null;
    }

    const followupQuestion = payload.view?.state?.values?.followup_input?.followup_question?.value;
    const metadata = JSON.parse(payload.view.private_metadata || '{}');

    if (!followupQuestion || !metadata.originalResponseId) {
      return null;
    }

    return {
      followupQuestion,
      metadata
    };
  } catch (error) {
    console.error('[SlackAdapter] Failed to extract followup data:', error);
    return null;
  }
}

/**
 * Validate Slack payload structure
 */
export function validateSlackPayload(payload: any): {
  isValid: boolean;
  type?: 'event' | 'command' | 'action';
  error?: string;
} {
  if (!payload || typeof payload !== 'object') {
    return { isValid: false, error: 'Invalid payload structure' };
  }

  // Check for event payload
  if (payload.type === 'event_callback' && payload.event) {
    return { isValid: true, type: 'event' };
  }

  // Check for command payload
  if (payload.command && payload.user_id && payload.team_id) {
    return { isValid: true, type: 'command' };
  }

  // Check for action payload
  if (payload.type === 'block_actions' && payload.actions) {
    return { isValid: true, type: 'action' };
  }

  return { isValid: false, error: 'Unsupported payload type' };
}