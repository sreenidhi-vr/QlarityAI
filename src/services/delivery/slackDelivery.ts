/**
 * Slack Delivery Service
 * Handles sending messages to Slack via different methods (response_url, Web API)
 * Provides fallback mechanisms and delivery status tracking
 */

import { WebClient } from '@slack/web-api';
import type { SlackBlock } from '@/types';
import { RAGError } from '@/types';
import axios from 'axios';

export interface SlackDeliveryOptions {
  channel: string;
  text?: string;
  blocks?: SlackBlock[];
  thread_ts?: string;
  response_type?: 'in_channel' | 'ephemeral';
  replace_original?: boolean;
  delete_original?: boolean;
}

export interface SlackEphemeralOptions {
  channel: string;
  user: string;
  text?: string;
  blocks?: SlackBlock[];
  thread_ts?: string;
}

export interface SlackDeliveryResult {
  success: boolean;
  method: 'response_url' | 'web_api';
  messageTs?: string;
  error?: string;
  deliveryTimeMs: number;
}

export class SlackDelivery {
  private webClient: WebClient;

  constructor(botToken: string) {
    if (!botToken) {
      throw new RAGError('Slack bot token is required for delivery service', 'MISSING_BOT_TOKEN');
    }
    this.webClient = new WebClient(botToken);
  }

  /**
   * Send message via Slack response_url (for slash commands and interactive components)
   * This is the preferred method when available as it's faster and doesn't require bot token validation
   */
  async sendViaResponseUrl(
    responseUrl: string,
    options: SlackDeliveryOptions
  ): Promise<SlackDeliveryResult> {
    const startTime = Date.now();
    
    console.log('[SlackDelivery] Sending via response_url', {
      responseUrl: responseUrl.substring(0, 50) + '...',
      hasBlocks: !!options.blocks,
      blocksCount: options.blocks?.length || 0,
      responseType: options.response_type || 'in_channel',
      threadTs: options.thread_ts
    });

    try {
      const payload = {
        text: options.text || '',
        ...(options.blocks && { blocks: options.blocks }),
        ...(options.response_type && { response_type: options.response_type }),
        ...(options.replace_original !== undefined && { replace_original: options.replace_original }),
        ...(options.delete_original !== undefined && { delete_original: options.delete_original }),
        ...(options.thread_ts && { thread_ts: options.thread_ts })
      };

      const response = await axios.post(responseUrl, payload, {
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: 10000 // 10 second timeout
      });

      const deliveryTime = Date.now() - startTime;

      console.log('[SlackDelivery] Response_url delivery successful', {
        status: response.status,
        deliveryTimeMs: deliveryTime,
        payloadSize: JSON.stringify(payload).length
      });

      return {
        success: true,
        method: 'response_url',
        deliveryTimeMs: deliveryTime
      };

    } catch (error) {
      const deliveryTime = Date.now() - startTime;
      
      console.error('[SlackDelivery] Response_url delivery failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        deliveryTimeMs: deliveryTime,
        isAxiosError: axios.isAxiosError(error),
        status: axios.isAxiosError(error) ? error.response?.status : undefined
      });

      return {
        success: false,
        method: 'response_url',
        error: error instanceof Error ? error.message : 'Unknown error',
        deliveryTimeMs: deliveryTime
      };
    }
  }

  /**
   * Send message via Slack Web API (chat.postMessage)
   * Used as fallback or when response_url is not available
   */
  async postMessage(options: SlackDeliveryOptions): Promise<SlackDeliveryResult> {
    const startTime = Date.now();
    
    console.log('[SlackDelivery] Sending via Web API postMessage', {
      channel: options.channel,
      hasBlocks: !!options.blocks,
      blocksCount: options.blocks?.length || 0,
      threadTs: options.thread_ts,
      textLength: options.text?.length || 0
    });

    try {
      const result = await this.webClient.chat.postMessage({
        channel: options.channel,
        text: options.text || '',
        ...(options.blocks && { blocks: options.blocks }),
        ...(options.thread_ts && { thread_ts: options.thread_ts })
      });

      const deliveryTime = Date.now() - startTime;

      if (!result.ok) {
        throw new RAGError(
          `Slack API error: ${result.error}`,
          'SLACK_API_ERROR',
          { slackError: result.error }
        );
      }

      console.log('[SlackDelivery] Web API postMessage successful', {
        messageTs: result.ts,
        channel: result.channel,
        deliveryTimeMs: deliveryTime
      });

      return {
        success: true,
        method: 'web_api',
        messageTs: result.ts as string,
        deliveryTimeMs: deliveryTime
      };

    } catch (error) {
      const deliveryTime = Date.now() - startTime;
      
      console.error('[SlackDelivery] Web API postMessage failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        channel: options.channel,
        deliveryTimeMs: deliveryTime
      });

      return {
        success: false,
        method: 'web_api',
        error: error instanceof Error ? error.message : 'Unknown error',
        deliveryTimeMs: deliveryTime
      };
    }
  }

  /**
   * Send ephemeral message (only visible to specific user)
   */
  async postEphemeral(options: SlackEphemeralOptions): Promise<SlackDeliveryResult> {
    const startTime = Date.now();
    
    console.log('[SlackDelivery] Sending ephemeral message', {
      channel: options.channel,
      user: options.user,
      hasBlocks: !!options.blocks,
      blocksCount: options.blocks?.length || 0,
      threadTs: options.thread_ts
    });

    try {
      const result = await this.webClient.chat.postEphemeral({
        channel: options.channel,
        user: options.user,
        text: options.text || '',
        ...(options.blocks && { blocks: options.blocks }),
        ...(options.thread_ts && { thread_ts: options.thread_ts })
      });

      const deliveryTime = Date.now() - startTime;

      if (!result.ok) {
        throw new RAGError(
          `Slack API error: ${result.error}`,
          'SLACK_API_ERROR',
          { slackError: result.error }
        );
      }

      console.log('[SlackDelivery] Ephemeral message successful', {
        messageTs: result.message_ts,
        channel: options.channel,
        user: options.user,
        deliveryTimeMs: deliveryTime
      });

      return {
        success: true,
        method: 'web_api',
        messageTs: result.message_ts as string,
        deliveryTimeMs: deliveryTime
      };

    } catch (error) {
      const deliveryTime = Date.now() - startTime;
      
      console.error('[SlackDelivery] Ephemeral message failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        channel: options.channel,
        user: options.user,
        deliveryTimeMs: deliveryTime
      });

      return {
        success: false,
        method: 'web_api',
        error: error instanceof Error ? error.message : 'Unknown error',
        deliveryTimeMs: deliveryTime
      };
    }
  }

  /**
   * Send message with automatic fallback from response_url to Web API
   */
  async sendWithFallback(
    options: SlackDeliveryOptions,
    responseUrl?: string
  ): Promise<SlackDeliveryResult> {
    console.log('[SlackDelivery] Starting delivery with fallback', {
      hasResponseUrl: !!responseUrl,
      channel: options.channel,
      preferredMethod: responseUrl ? 'response_url' : 'web_api'
    });

    // Try response_url first if available
    if (responseUrl) {
      const responseUrlResult = await this.sendViaResponseUrl(responseUrl, options);
      
      if (responseUrlResult.success) {
        console.log('[SlackDelivery] Primary delivery method (response_url) successful');
        return responseUrlResult;
      }

      console.warn('[SlackDelivery] Primary delivery method failed, attempting Web API fallback', {
        responseUrlError: responseUrlResult.error
      });
    }

    // Fallback to Web API
    const webApiResult = await this.postMessage(options);
    
    if (webApiResult.success) {
      console.log('[SlackDelivery] Fallback delivery method (web_api) successful');
    } else {
      console.error('[SlackDelivery] All delivery methods failed', {
        webApiError: webApiResult.error
      });
    }

    return webApiResult;
  }

  /**
   * Update existing message (requires message timestamp)
   */
  async updateMessage(
    channel: string,
    messageTs: string,
    options: {
      text?: string;
      blocks?: SlackBlock[];
    }
  ): Promise<SlackDeliveryResult> {
    const startTime = Date.now();
    
    console.log('[SlackDelivery] Updating message', {
      channel,
      messageTs,
      hasBlocks: !!options.blocks,
      textLength: options.text?.length || 0
    });

    try {
      const result = await this.webClient.chat.update({
        channel,
        ts: messageTs,
        text: options.text || '',
        ...(options.blocks && { blocks: options.blocks })
      });

      const deliveryTime = Date.now() - startTime;

      if (!result.ok) {
        throw new RAGError(
          `Slack API error: ${result.error}`,
          'SLACK_API_ERROR',
          { slackError: result.error }
        );
      }

      console.log('[SlackDelivery] Message update successful', {
        messageTs: result.ts,
        channel: result.channel,
        deliveryTimeMs: deliveryTime
      });

      return {
        success: true,
        method: 'web_api',
        messageTs: result.ts as string,
        deliveryTimeMs: deliveryTime
      };

    } catch (error) {
      const deliveryTime = Date.now() - startTime;
      
      console.error('[SlackDelivery] Message update failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        channel,
        messageTs,
        deliveryTimeMs: deliveryTime
      });

      return {
        success: false,
        method: 'web_api',
        error: error instanceof Error ? error.message : 'Unknown error',
        deliveryTimeMs: deliveryTime
      };
    }
  }

  /**
   * Delete message
   */
  async deleteMessage(channel: string, messageTs: string): Promise<SlackDeliveryResult> {
    const startTime = Date.now();
    
    console.log('[SlackDelivery] Deleting message', {
      channel,
      messageTs
    });

    try {
      const result = await this.webClient.chat.delete({
        channel,
        ts: messageTs
      });

      const deliveryTime = Date.now() - startTime;

      if (!result.ok) {
        throw new RAGError(
          `Slack API error: ${result.error}`,
          'SLACK_API_ERROR',
          { slackError: result.error }
        );
      }

      console.log('[SlackDelivery] Message deletion successful', {
        channel,
        messageTs,
        deliveryTimeMs: deliveryTime
      });

      return {
        success: true,
        method: 'web_api',
        deliveryTimeMs: deliveryTime
      };

    } catch (error) {
      const deliveryTime = Date.now() - startTime;
      
      console.error('[SlackDelivery] Message deletion failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        channel,
        messageTs,
        deliveryTimeMs: deliveryTime
      });

      return {
        success: false,
        method: 'web_api',
        error: error instanceof Error ? error.message : 'Unknown error',
        deliveryTimeMs: deliveryTime
      };
    }
  }

  /**
   * Open modal dialog
   */
  async openModal(triggerId: string, view: any): Promise<{ success: boolean; error?: string }> {
    console.log('[SlackDelivery] Opening modal', {
      triggerId: triggerId.substring(0, 20) + '...',
      viewType: view.type,
      viewCallbackId: view.callback_id
    });

    try {
      const result = await this.webClient.views.open({
        trigger_id: triggerId,
        view
      });

      if (!result.ok) {
        throw new RAGError(
          `Slack API error: ${result.error}`,
          'SLACK_API_ERROR',
          { slackError: result.error }
        );
      }

      console.log('[SlackDelivery] Modal opened successfully', {
        viewId: result.view?.id
      });

      return { success: true };

    } catch (error) {
      console.error('[SlackDelivery] Modal open failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        triggerId: triggerId.substring(0, 10) + '...'
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Health check for Slack delivery service
   */
  async healthCheck(): Promise<{
    healthy: boolean;
    webApiConnected: boolean;
    error?: string;
  }> {
    try {
      const authTest = await this.webClient.auth.test();
      
      return {
        healthy: !!authTest.ok,
        webApiConnected: !!authTest.ok
      };
    } catch (error) {
      return {
        healthy: false,
        webApiConnected: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }
}