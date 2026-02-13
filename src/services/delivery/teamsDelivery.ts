/**
 * Microsoft Teams Delivery Service
 * Handles sending messages to Teams via Bot Framework connector
 * Provides support for Adaptive Cards and proactive messaging
 */

import axios from 'axios';
import type { 
  TeamsActivity, 
  TeamsAdaptiveCard, 
  TeamsAttachment 
} from '@/adapters/platform/teamsAdapter';
import { RAGError } from '@/types';

export interface TeamsDeliveryOptions {
  text?: string;
  adaptiveCard?: TeamsAdaptiveCard;
  attachments?: TeamsAttachment[];
  replyToId?: string;
}

export interface TeamsDeliveryResult {
  success: boolean;
  method: 'connector' | 'proactive';
  activityId?: string;
  error?: string;
  deliveryTimeMs: number;
}

export interface TeamsConnectorAuth {
  appId: string;
  appPassword: string;
  serviceUrl: string;
  tenantId?: string;
}

export class TeamsDelivery {
  private appId: string;
  private appPassword: string;
  private accessTokens: Map<string, { token: string; expires: number }> = new Map();
  private readonly AUTH_ENDPOINT = 'https://login.microsoftonline.com/botframework.com/oauth2/v2.0/token';

  constructor(appId: string, appPassword: string) {
    if (!appId || !appPassword) {
      throw new RAGError(
        'Teams app credentials are required for delivery service',
        'MISSING_TEAMS_CREDENTIALS'
      );
    }
    this.appId = appId;
    this.appPassword = appPassword;
  }

  /**
   * Get access token for Bot Framework API calls
   */
  private async getAccessToken(serviceUrl: string): Promise<string> {
    const cacheKey = serviceUrl;
    const cached = this.accessTokens.get(cacheKey);
    
    // Check if we have a valid cached token (with 5 minute buffer)
    if (cached && cached.expires > Date.now() + 300000) {
      return cached.token;
    }

    console.log('[TeamsDelivery] Requesting new access token', {
      serviceUrl: serviceUrl.substring(0, 50),
      appId: this.appId.substring(0, 10) + '...'
    });

    try {
      const response = await axios.post(this.AUTH_ENDPOINT, new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: this.appId,
        client_secret: this.appPassword,
        scope: 'https://api.botframework.com/.default'
      }), {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        timeout: 10000
      });

      const { access_token, expires_in } = response.data;
      const expiresAt = Date.now() + (expires_in * 1000);

      // Cache the token
      this.accessTokens.set(cacheKey, {
        token: access_token,
        expires: expiresAt
      });

      console.log('[TeamsDelivery] Access token obtained', {
        expiresInMinutes: Math.round(expires_in / 60),
        serviceUrl: serviceUrl.substring(0, 50)
      });

      return access_token;

    } catch (error) {
      console.error('[TeamsDelivery] Failed to get access token', {
        error: error instanceof Error ? error.message : 'Unknown error',
        serviceUrl,
        isAxiosError: axios.isAxiosError(error),
        status: axios.isAxiosError(error) ? error.response?.status : undefined
      });

      throw new RAGError(
        'Failed to authenticate with Teams Bot Framework',
        'TEAMS_AUTH_FAILED',
        { originalError: error }
      );
    }
  }

  /**
   * Reply to an existing Teams activity
   */
  async replyToActivity(
    originalActivity: TeamsActivity,
    options: TeamsDeliveryOptions
  ): Promise<TeamsDeliveryResult> {
    const startTime = Date.now();
    
    console.log('[TeamsDelivery] Replying to activity', {
      activityId: originalActivity.id,
      conversationId: originalActivity.conversation.id,
      serviceUrl: originalActivity.serviceUrl,
      hasAdaptiveCard: !!options.adaptiveCard,
      textLength: options.text?.length || 0
    });

    try {
      const accessToken = await this.getAccessToken(originalActivity.serviceUrl);
      
      // Build reply activity
      const reply = {
        type: 'message',
        from: {
          id: this.appId,
          name: 'RAG Assistant'
        },
        conversation: originalActivity.conversation,
        recipient: originalActivity.from,
        text: options.text || '',
        replyToId: originalActivity.id,
        ...(options.attachments && { attachments: options.attachments })
      };

      // Add adaptive card as attachment if provided
      if (options.adaptiveCard) {
        reply.attachments = [
          {
            contentType: 'application/vnd.microsoft.card.adaptive',
            content: options.adaptiveCard
          },
          ...(options.attachments || [])
        ];
      }

      const replyUrl = `${originalActivity.serviceUrl}/v3/conversations/${originalActivity.conversation.id}/activities/${originalActivity.id}`;
      
      const response = await axios.post(replyUrl, reply, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        timeout: 15000
      });

      const deliveryTime = Date.now() - startTime;

      console.log('[TeamsDelivery] Reply sent successfully', {
        activityId: response.data.id,
        conversationId: originalActivity.conversation.id,
        deliveryTimeMs: deliveryTime,
        status: response.status
      });

      return {
        success: true,
        method: 'connector',
        activityId: response.data.id,
        deliveryTimeMs: deliveryTime
      };

    } catch (error) {
      const deliveryTime = Date.now() - startTime;
      
      console.error('[TeamsDelivery] Reply failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        activityId: originalActivity.id,
        conversationId: originalActivity.conversation.id,
        deliveryTimeMs: deliveryTime,
        isAxiosError: axios.isAxiosError(error),
        status: axios.isAxiosError(error) ? error.response?.status : undefined,
        responseData: axios.isAxiosError(error) ? error.response?.data : undefined
      });

      return {
        success: false,
        method: 'connector',
        error: error instanceof Error ? error.message : 'Unknown error',
        deliveryTimeMs: deliveryTime
      };
    }
  }

  /**
   * Send proactive message to a conversation
   */
  async sendProactive(
    serviceUrl: string,
    conversationId: string,
    options: TeamsDeliveryOptions & {
      recipient: { id: string; name: string };
    }
  ): Promise<TeamsDeliveryResult> {
    const startTime = Date.now();
    
    console.log('[TeamsDelivery] Sending proactive message', {
      conversationId,
      serviceUrl: serviceUrl.substring(0, 50),
      recipientId: options.recipient.id,
      hasAdaptiveCard: !!options.adaptiveCard,
      textLength: options.text?.length || 0
    });

    try {
      const accessToken = await this.getAccessToken(serviceUrl);
      
      // Build proactive message
      const message = {
        type: 'message',
        from: {
          id: this.appId,
          name: 'RAG Assistant'
        },
        conversation: { id: conversationId },
        recipient: options.recipient,
        text: options.text || '',
        ...(options.attachments && { attachments: options.attachments })
      };

      // Add adaptive card as attachment if provided
      if (options.adaptiveCard) {
        message.attachments = [
          {
            contentType: 'application/vnd.microsoft.card.adaptive',
            content: options.adaptiveCard
          },
          ...(options.attachments || [])
        ];
      }

      const messageUrl = `${serviceUrl}/v3/conversations/${conversationId}/activities`;
      
      const response = await axios.post(messageUrl, message, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        timeout: 15000
      });

      const deliveryTime = Date.now() - startTime;

      console.log('[TeamsDelivery] Proactive message sent successfully', {
        activityId: response.data.id,
        conversationId,
        deliveryTimeMs: deliveryTime,
        status: response.status
      });

      return {
        success: true,
        method: 'proactive',
        activityId: response.data.id,
        deliveryTimeMs: deliveryTime
      };

    } catch (error) {
      const deliveryTime = Date.now() - startTime;
      
      console.error('[TeamsDelivery] Proactive message failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        conversationId,
        serviceUrl,
        deliveryTimeMs: deliveryTime,
        isAxiosError: axios.isAxiosError(error),
        status: axios.isAxiosError(error) ? error.response?.status : undefined
      });

      return {
        success: false,
        method: 'proactive',
        error: error instanceof Error ? error.message : 'Unknown error',
        deliveryTimeMs: deliveryTime
      };
    }
  }

  /**
   * Update existing activity (limited support in Teams)
   */
  async updateActivity(
    serviceUrl: string,
    conversationId: string,
    activityId: string,
    options: TeamsDeliveryOptions
  ): Promise<TeamsDeliveryResult> {
    const startTime = Date.now();
    
    console.log('[TeamsDelivery] Updating activity', {
      activityId,
      conversationId,
      serviceUrl: serviceUrl.substring(0, 50),
      hasAdaptiveCard: !!options.adaptiveCard
    });

    try {
      const accessToken = await this.getAccessToken(serviceUrl);
      
      // Build update payload
      const update = {
        type: 'message',
        text: options.text || '',
        ...(options.attachments && { attachments: options.attachments })
      };

      // Add adaptive card as attachment if provided
      if (options.adaptiveCard) {
        update.attachments = [
          {
            contentType: 'application/vnd.microsoft.card.adaptive',
            content: options.adaptiveCard
          },
          ...(options.attachments || [])
        ];
      }

      const updateUrl = `${serviceUrl}/v3/conversations/${conversationId}/activities/${activityId}`;
      
      const response = await axios.put(updateUrl, update, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        timeout: 15000
      });

      const deliveryTime = Date.now() - startTime;

      console.log('[TeamsDelivery] Activity updated successfully', {
        activityId,
        conversationId,
        deliveryTimeMs: deliveryTime,
        status: response.status
      });

      return {
        success: true,
        method: 'connector',
        activityId,
        deliveryTimeMs: deliveryTime
      };

    } catch (error) {
      const deliveryTime = Date.now() - startTime;
      
      console.error('[TeamsDelivery] Activity update failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        activityId,
        conversationId,
        deliveryTimeMs: deliveryTime,
        isAxiosError: axios.isAxiosError(error),
        status: axios.isAxiosError(error) ? error.response?.status : undefined
      });

      return {
        success: false,
        method: 'connector',
        error: error instanceof Error ? error.message : 'Unknown error',
        deliveryTimeMs: deliveryTime
      };
    }
  }

  /**
   * Delete activity
   */
  async deleteActivity(
    serviceUrl: string,
    conversationId: string,
    activityId: string
  ): Promise<TeamsDeliveryResult> {
    const startTime = Date.now();
    
    console.log('[TeamsDelivery] Deleting activity', {
      activityId,
      conversationId,
      serviceUrl: serviceUrl.substring(0, 50)
    });

    try {
      const accessToken = await this.getAccessToken(serviceUrl);
      
      const deleteUrl = `${serviceUrl}/v3/conversations/${conversationId}/activities/${activityId}`;
      
      const response = await axios.delete(deleteUrl, {
        headers: {
          'Authorization': `Bearer ${accessToken}`
        },
        timeout: 10000
      });

      const deliveryTime = Date.now() - startTime;

      console.log('[TeamsDelivery] Activity deleted successfully', {
        activityId,
        conversationId,
        deliveryTimeMs: deliveryTime,
        status: response.status
      });

      return {
        success: true,
        method: 'connector',
        deliveryTimeMs: deliveryTime
      };

    } catch (error) {
      const deliveryTime = Date.now() - startTime;
      
      console.error('[TeamsDelivery] Activity deletion failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        activityId,
        conversationId,
        deliveryTimeMs: deliveryTime,
        isAxiosError: axios.isAxiosError(error),
        status: axios.isAxiosError(error) ? error.response?.status : undefined
      });

      return {
        success: false,
        method: 'connector',
        error: error instanceof Error ? error.message : 'Unknown error',
        deliveryTimeMs: deliveryTime
      };
    }
  }

  /**
   * Send typing indicator to show bot is processing
   */
  async sendTypingIndicator(
    serviceUrl: string,
    conversationId: string,
    recipient: { id: string; name: string }
  ): Promise<void> {
    try {
      const accessToken = await this.getAccessToken(serviceUrl);
      
      const typingActivity = {
        type: 'typing',
        from: {
          id: this.appId,
          name: 'RAG Assistant'
        },
        conversation: { id: conversationId },
        recipient
      };

      const typingUrl = `${serviceUrl}/v3/conversations/${conversationId}/activities`;
      
      await axios.post(typingUrl, typingActivity, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        timeout: 5000
      });

      console.log('[TeamsDelivery] Typing indicator sent', {
        conversationId,
        recipientId: recipient.id
      });

    } catch (error) {
      // Don't throw on typing indicator failures
      console.warn('[TeamsDelivery] Typing indicator failed (non-critical)', {
        error: error instanceof Error ? error.message : 'Unknown error',
        conversationId
      });
    }
  }

  /**
   * Create conversation reference for proactive messaging
   */
  createConversationReference(activity: TeamsActivity): {
    serviceUrl: string;
    conversationId: string;
    user: { id: string; name: string };
    bot: { id: string; name: string };
    tenantId?: string;
  } {
    const reference = {
      serviceUrl: activity.serviceUrl,
      conversationId: activity.conversation.id,
      user: {
        id: activity.from.id,
        name: activity.from.name
      },
      bot: {
        id: this.appId,
        name: 'RAG Assistant'
      }
    };

    // Only add tenantId if it exists
    if (activity.channelData?.tenant?.id) {
      (reference as any).tenantId = activity.channelData.tenant.id;
    }

    return reference;
  }

  /**
   * Health check for Teams delivery service
   */
  async healthCheck(): Promise<{
    healthy: boolean;
    canAuthenticate: boolean;
    error?: string;
  }> {
    try {
      // Test authentication with a dummy service URL
      await this.getAccessToken('https://smba.trafficmanager.net/amer/');
      
      return {
        healthy: true,
        canAuthenticate: true
      };
    } catch (error) {
      return {
        healthy: false,
        canAuthenticate: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Clear cached access tokens (useful for testing or credential rotation)
   */
  clearTokenCache(): void {
    this.accessTokens.clear();
    console.log('[TeamsDelivery] Access token cache cleared');
  }
}