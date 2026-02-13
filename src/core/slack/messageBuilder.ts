/**
 * Slack message builder utilities for interactive features
 * Provides functions to create buttons, modals, and enhanced message blocks
 */

import type { SlackBlock, SlackElement, InteractiveButtonData, SourcesModalData, FollowupModalData } from '@/types';

/**
 * Generate interactive buttons for bot responses
 */
export function createInteractiveButtons(responseId: string): SlackBlock {
  const buttonData: InteractiveButtonData = {
    responseId
  };

  return {
    type: 'actions',
    block_id: `interactive_actions_${responseId}`,
    elements: [
      {
        type: 'button',
        text: {
          type: 'plain_text',
          text: '📋 Show Sources'
        },
        action_id: 'show_sources',
        value: JSON.stringify(buttonData)
      },
      {
        type: 'button',
        text: {
          type: 'plain_text',
          text: '🔄 Ask Follow-up'
        },
        action_id: 'ask_followup',
        value: JSON.stringify(buttonData)
      }
    ] as SlackElement[]
  };
}

/**
 * Create sources modal view
 */
export function createSourcesModal(sources: SourcesModalData['sources']): any {
  if (sources.length === 0) {
    return {
      type: 'modal',
      title: {
        type: 'plain_text',
        text: 'Sources for this answer'
      },
      close: {
        type: 'plain_text',
        text: 'Close'
      },
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '*No sources available*\n\nThis response was generated without specific source documents.'
          }
        }
      ]
    };
  }

  // Create source blocks
  const sourceBlocks: SlackBlock[] = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Sources* (${sources.length} found)`
      }
    },
    {
      type: 'divider'
    }
  ];

  // Add individual sources (limit to 8 for modal space)
  const displaySources = sources.slice(0, 8);
  displaySources.forEach((source, index) => {
    const score = Math.round(source.score * 100);
    const truncatedSnippet = source.snippet.length > 200 
      ? source.snippet.substring(0, 200) + '...'
      : source.snippet;

    sourceBlocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${index + 1}. ${source.title}* (${score}% match)\n${truncatedSnippet}\n<${source.url}|View Source>`
      }
    });

    if (index < displaySources.length - 1) {
      sourceBlocks.push({ type: 'divider' });
    }
  });

  // Add copy all links button if multiple sources
  if (sources.length > 1) {
    const allLinks = sources.map(s => s.url).join('\n');
    sourceBlocks.push(
      {
        type: 'divider'
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*All Links:*\n\`\`\`${allLinks}\`\`\``
        }
      }
    );
  }

  return {
    type: 'modal',
    title: {
      type: 'plain_text',
      text: 'Sources for this answer'
    },
    close: {
      type: 'plain_text',
      text: 'Close'
    },
    blocks: sourceBlocks
  };
}

/**
 * Create follow-up modal view
 */
export function createFollowupModal(followupData: FollowupModalData): any {
  return {
    type: 'modal',
    callback_id: 'followup_modal',
    title: {
      type: 'plain_text',
      text: 'Ask a follow-up'
    },
    submit: {
      type: 'plain_text',
      text: 'Send'
    },
    close: {
      type: 'plain_text',
      text: 'Cancel'
    },
    private_metadata: JSON.stringify({
      originalResponseId: followupData.originalResponseId,
      originalText: followupData.originalText,
      originalSources: followupData.originalSources
    }),
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*Ask a follow-up question about this response:*'
        }
      },
      {
        type: 'input',
        block_id: 'followup_input',
        element: {
          type: 'plain_text_input',
          action_id: 'followup_question',
          placeholder: {
            type: 'plain_text',
            text: 'Enter your follow-up question...'
          },
          multiline: true,
          max_length: 500
        },
        label: {
          type: 'plain_text',
          text: 'Your Question'
        }
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `_Original response: "${followupData.originalText.substring(0, 100)}..."_`
          }
        ]
      }
    ]
  };
}

/**
 * Add interactive buttons to existing SlackRAGResponse
 */
export function enhanceResponseWithButtons(response: any, responseId: string): any {
  const enhancedResponse = { ...response };
  
  // Check if buttons already exist to prevent duplication
  const blocks = [...enhancedResponse.blocks];
  const existingButtonBlock = blocks.find(block =>
    block.type === 'actions' &&
    (block.block_id?.startsWith('interactive_actions_') ||
     block.elements?.some((el: any) => el.action_id === 'show_sources' || el.action_id === 'ask_followup'))
  );
  
  // Only add buttons if they don't already exist
  if (existingButtonBlock) {
    console.log('[MessageBuilder] Interactive buttons already exist, skipping duplication');
    return enhancedResponse;
  }
  
  // Add interactive buttons
  const buttonBlock = createInteractiveButtons(responseId);
  
  // Insert buttons before any context blocks
  const contextBlockIndex = blocks.findIndex(block => block.type === 'context');
  
  if (contextBlockIndex >= 0) {
    blocks.splice(contextBlockIndex, 0, buttonBlock);
  } else {
    blocks.push(buttonBlock);
  }
  
  enhancedResponse.blocks = blocks;
  return enhancedResponse;
}

/**
 * Generate a unique response ID
 */
export function generateResponseId(userId: string, channelId: string): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `${userId}_${channelId}_${timestamp}_${random}`;
}