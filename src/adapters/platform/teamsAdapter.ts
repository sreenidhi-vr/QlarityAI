/**
 * Microsoft Teams Platform Adapter
 * Transforms Teams activities and formats responses specifically for Teams
 * Integrates with the UnifiedOrchestrator while maintaining Teams-specific formatting
 */

import type { PlatformQueryContext, OrchestratorResult } from '@/core/orchestrator/unifiedOrchestrator';

// Teams Bot Framework activity types
export interface TeamsActivity {
  type: 'message' | 'invoke' | 'conversationUpdate' | 'messageReaction';
  id: string;
  timestamp: string;
  serviceUrl: string;
  channelId: string;
  from: {
    id: string;
    name: string;
    aadObjectId?: string;
  };
  conversation: {
    id: string;
    name?: string;
    conversationType: 'personal' | 'channel' | 'groupChat';
    tenantId?: string;
  };
  recipient?: {
    id: string;
    name: string;
  };
  text?: string;
  textFormat?: 'plain' | 'markdown';
  attachments?: TeamsAttachment[];
  entities?: any[];
  channelData?: {
    tenant?: { id: string };
    team?: { id: string };
    channel?: { id: string };
    meeting?: { id: string };
  };
  replyToId?: string;
  value?: any;
}

export interface TeamsAttachment {
  contentType: string;
  content?: any;
  contentUrl?: string;
  name?: string;
  thumbnailUrl?: string;
}

// Teams Adaptive Card structures
export interface TeamsAdaptiveCard {
  type: 'AdaptiveCard';
  version: '1.4';
  body: AdaptiveCardElement[];
  actions?: AdaptiveCardAction[];
  $schema?: string;
}

export interface AdaptiveCardElement {
  type: 'TextBlock' | 'Container' | 'ColumnSet' | 'ActionSet' | 'FactSet' | 'Input.Text' | 'Input.Number' | 'Input.Date' | 'Input.Time' | 'Input.Toggle' | 'Input.ChoiceSet';
  [key: string]: any;
}

export interface AdaptiveCardAction {
  type: 'Action.Submit' | 'Action.OpenUrl' | 'Action.ShowCard';
  title: string;
  data?: any;
  url?: string;
  [key: string]: any;
}

/**
 * Transform Teams activity to platform query context
 */
export function toPlatformContext(activity: TeamsActivity): PlatformQueryContext {
  const userId = activity.from.id;
  const channelId = activity.conversation.id;
  const threadId = activity.replyToId;
  const query = cleanTeamsText(activity.text || '');

  const metadata = {
    activityId: activity.id,
    activityType: activity.type,
    serviceUrl: activity.serviceUrl,
    conversationType: activity.conversation.conversationType,
    tenantId: activity.channelData?.tenant?.id,
    teamId: activity.channelData?.team?.id,
    userName: activity.from.name,
    timestamp: activity.timestamp,
    textFormat: activity.textFormat || 'plain'
  };

  return {
    platform: 'teams',
    userId,
    channelId,
    ...(threadId && { threadId }),
    query,
    metadata
  };
}

/**
 * Clean Teams text by removing bot mentions and formatting
 */
function cleanTeamsText(text: string): string {
  if (!text) return '';
  
  return text
    .replace(/<at>.*?<\/at>/g, '') // Remove @mentions
    .replace(/&lt;at&gt;.*?&lt;\/at&gt;/g, '') // Remove encoded @mentions
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Format orchestrator result for Teams message format
 */
export function formatResponseForTeams(
  result: OrchestratorResult,
  options: {
    includeAdaptiveCard?: boolean;
    maxTextLength?: number;
    includeActions?: boolean;
  } = {}
): {
  text: string;
  adaptiveCard?: TeamsAdaptiveCard;
  attachments?: TeamsAttachment[];
} {
  const {
    includeAdaptiveCard = true,
    maxTextLength = 4000,
    includeActions = true
  } = options;

  // Truncate text if too long for Teams
  let displayText = result.text;
  if (displayText.length > maxTextLength) {
    displayText = displayText.substring(0, maxTextLength - 100) + '\n\n*Response truncated due to length...*';
  }

  const response: {
    text: string;
    adaptiveCard?: TeamsAdaptiveCard;
    attachments?: TeamsAttachment[];
  } = {
    text: displayText
  };

  if (includeAdaptiveCard) {
    response.adaptiveCard = createResponseAdaptiveCard(result, includeActions);
    response.attachments = [{
      contentType: 'application/vnd.microsoft.card.adaptive',
      content: response.adaptiveCard
    }];
  }

  return response;
}

/**
 * Create Adaptive Card for Teams response
 */
function createResponseAdaptiveCard(
  result: OrchestratorResult,
  includeActions: boolean = true
): TeamsAdaptiveCard {
  const body: AdaptiveCardElement[] = [];

  // Main response text
  body.push({
    type: 'TextBlock',
    text: result.text,
    wrap: true,
    size: 'Default',
    spacing: 'Medium'
  });

  // Confidence indicator
  if (result.confidence < 0.7) {
    body.push({
      type: 'Container',
      style: 'attention',
      items: [{
        type: 'TextBlock',
        text: `⚠️ **Confidence: ${Math.round(result.confidence * 100)}%** - This answer may require verification.`,
        wrap: true,
        size: 'Small',
        color: 'Warning'
      }],
      spacing: 'Small'
    });
  }

  // Sources section
  if (result.sources.length > 0) {
    const sourceFacts = result.sources.slice(0, 3).map((source, index) => {
      const scoreText = source.retrieval_score > 0 ? ` (${Math.round(source.retrieval_score * 100)}%)` : '';
      return {
        title: `Source ${index + 1}`,
        value: `[${source.title}](${source.url})${scoreText}`
      };
    });

    body.push({
      type: 'FactSet',
      facts: sourceFacts,
      spacing: 'Medium'
    });
  }

  // Metadata section
  const metadataFacts = [];
  
  if (result.platformHints.collection) {
    const collectionLabel = result.platformHints.collection === 'pssis-admin' 
      ? '📊 PowerSchool PSSIS-Admin'
      : '📚 Schoology LMS';
    metadataFacts.push({
      title: 'Source',
      value: collectionLabel
    });
  }

  if (result.intent === 'instructions') {
    metadataFacts.push({
      title: 'Type',
      value: 'Step-by-step guide'
    });
  } else if (result.intent === 'details') {
    metadataFacts.push({
      title: 'Type',
      value: 'Detailed explanation'
    });
  }

  metadataFacts.push({
    title: 'Processing time',
    value: `${result.metadata.processingTimeMs}ms`
  });

  if (metadataFacts.length > 0) {
    body.push({
      type: 'FactSet',
      facts: metadataFacts,
      spacing: 'Small'
    });
  }

  const actions: AdaptiveCardAction[] = [];

  // Add action buttons
  if (includeActions) {
    const actionData = {
      contextId: result.metadata.contextId,
      userId: result.metadata.userId,
      channelId: result.metadata.channelId
    };

    actions.push({
      type: 'Action.Submit',
      title: '🔍 Show Sources',
      data: {
        action: 'show_sources',
        ...actionData
      }
    });

    actions.push({
      type: 'Action.Submit',
      title: '💬 Ask Follow-up',
      data: {
        action: 'ask_followup',
        ...actionData
      }
    });
  }

  return {
    type: 'AdaptiveCard',
    version: '1.4',
    body,
    ...(actions.length > 0 && { actions }),
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json'
  };
}

/**
 * Create Sources Adaptive Card for Teams
 */
export function createSourcesAdaptiveCard(sources: OrchestratorResult['sources']): TeamsAdaptiveCard {
  const body: AdaptiveCardElement[] = [
    {
      type: 'TextBlock',
      text: '📚 **Sources used to generate this answer:**',
      weight: 'Bolder',
      size: 'Medium',
      spacing: 'Medium'
    }
  ];

  sources.forEach((source, index) => {
    const score = source.retrieval_score > 0 
      ? ` • **Relevance:** ${Math.round(source.retrieval_score * 100)}%`
      : '';
    
    body.push({
      type: 'Container',
      items: [
        {
          type: 'TextBlock',
          text: `**${index + 1}. [${source.title}](${source.url})**${score}`,
          wrap: true,
          weight: 'Bolder'
        },
        {
          type: 'TextBlock',
          text: source.snippet,
          wrap: true,
          isSubtle: true,
          spacing: 'Small'
        }
      ],
      spacing: index === 0 ? 'Medium' : 'Small'
    });
  });

  return {
    type: 'AdaptiveCard',
    version: '1.4',
    body,
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json'
  };
}

/**
 * Create Follow-up Adaptive Card for Teams
 */
export function createFollowupAdaptiveCard(
  originalResult: OrchestratorResult
): TeamsAdaptiveCard {
  const metadata = {
    originalResponseId: originalResult.metadata.contextId,
    originalText: originalResult.text.substring(0, 500),
    originalSources: originalResult.sources.slice(0, 3),
    parentContextId: originalResult.metadata.contextId
  };

  const body: AdaptiveCardElement[] = [
    {
      type: 'TextBlock',
      text: '💬 **Ask a follow-up question about this answer:**',
      weight: 'Bolder',
      size: 'Medium'
    },
    {
      type: 'TextBlock',
      text: `*Original answer: "${originalResult.summary || originalResult.text.substring(0, 150)}..."*`,
      wrap: true,
      isSubtle: true,
      spacing: 'Small'
    },
    {
      type: 'Input.Text',
      id: 'followupQuestion',
      placeholder: 'Type your follow-up question here...',
      isMultiline: true,
      maxLength: 500
    }
  ];

  const actions: AdaptiveCardAction[] = [
    {
      type: 'Action.Submit',
      title: 'Ask Question',
      data: {
        action: 'submit_followup',
        metadata: JSON.stringify(metadata)
      }
    }
  ];

  return {
    type: 'AdaptiveCard',
    version: '1.4',
    body,
    actions,
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json'
  };
}

/**
 * Create error response for Teams
 */
export function createTeamsErrorResponse(
  error: string,
  includeAdaptiveCard: boolean = true
): {
  text: string;
  adaptiveCard?: TeamsAdaptiveCard;
  attachments?: TeamsAttachment[];
} {
  const response = {
    text: `❌ ${error}`
  };

  if (includeAdaptiveCard) {
    const adaptiveCard: TeamsAdaptiveCard = {
      type: 'AdaptiveCard',
      version: '1.4',
      body: [
        {
          type: 'TextBlock',
          text: `❌ ${error}`,
          wrap: true,
          color: 'Attention',
          weight: 'Bolder'
        },
        {
          type: 'TextBlock',
          text: '💡 Try rephrasing your question or check our [documentation](https://support.powerschool.com/)',
          wrap: true,
          isSubtle: true,
          spacing: 'Small'
        }
      ],
      $schema: 'http://adaptivecards.io/schemas/adaptive-card.json'
    };

    return {
      ...response,
      adaptiveCard,
      attachments: [{
        contentType: 'application/vnd.microsoft.card.adaptive',
        content: adaptiveCard
      }]
    };
  }

  return response;
}

/**
 * Extract action data from Teams invoke activity
 */
export function extractTeamsActionData(activity: TeamsActivity): {
  action: string;
  data: any;
} | null {
  if (activity.type !== 'invoke' || !activity.value) {
    return null;
  }

  try {
    const value = activity.value;
    if (value.action) {
      return {
        action: value.action,
        data: value
      };
    }
  } catch (error) {
    console.error('[TeamsAdapter] Failed to extract action data:', error);
  }

  return null;
}

/**
 * Extract followup data from Teams submit action
 */
export function extractTeamsFollowupData(activity: TeamsActivity): {
  followupQuestion: string;
  metadata: any;
} | null {
  try {
    if (activity.type !== 'invoke' || !activity.value?.action || activity.value.action !== 'submit_followup') {
      return null;
    }

    const followupQuestion = activity.value.followupQuestion;
    const metadata = JSON.parse(activity.value.metadata || '{}');

    if (!followupQuestion || !metadata.originalResponseId) {
      return null;
    }

    return {
      followupQuestion,
      metadata
    };
  } catch (error) {
    console.error('[TeamsAdapter] Failed to extract followup data:', error);
    return null;
  }
}

/**
 * Validate Teams activity structure
 */
export function validateTeamsActivity(activity: any): {
  isValid: boolean;
  type?: 'message' | 'invoke' | 'conversationUpdate';
  error?: string;
} {
  if (!activity || typeof activity !== 'object') {
    return { isValid: false, error: 'Invalid activity structure' };
  }

  if (!activity.type || !activity.from || !activity.conversation) {
    return { isValid: false, error: 'Missing required activity properties' };
  }

  const validTypes = ['message', 'invoke', 'conversationUpdate', 'messageReaction'];
  if (!validTypes.includes(activity.type)) {
    return { isValid: false, error: `Unsupported activity type: ${activity.type}` };
  }

  return { isValid: true, type: activity.type };
}

/**
 * Create Teams message reply
 */
export function createTeamsReply(
  originalActivity: TeamsActivity,
  responseText: string,
  adaptiveCard?: TeamsAdaptiveCard
): {
  type: 'message';
  text: string;
  attachments?: TeamsAttachment[];
  replyToId?: string;
  conversation: { id: string };
  recipient: { id: string; name: string };
} {
  const reply: any = {
    type: 'message',
    text: responseText,
    conversation: originalActivity.conversation,
    recipient: originalActivity.from
  };

  if (originalActivity.id) {
    reply.replyToId = originalActivity.id;
  }

  if (adaptiveCard) {
    reply.attachments = [{
      contentType: 'application/vnd.microsoft.card.adaptive',
      content: adaptiveCard
    }];
  }

  return reply;
}