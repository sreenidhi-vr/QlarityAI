/**
 * Slack request validation utilities
 * Implements Slack signature verification for secure request handling
 */

import crypto from 'crypto';
import config from '@/utils/config';
import { RAGError } from '@/types';

export interface SlackRequestValidationResult {
  isValid: boolean;
  error?: string;
  timestamp?: number;
}

/**
 * Validates Slack request signature to prevent spoofing
 */
export function validateSlackRequest(
  body: string,
  timestamp: string,
  signature: string,
  signingSecret?: string
): SlackRequestValidationResult {
  try {
    const secret = signingSecret || config.SLACK_SIGNING_SECRET;
    
    // DIAGNOSTIC: Log validation attempt details
    console.log('[SLACK-AUTH-DEBUG] Starting validation:', {
      hasSecret: !!secret,
      secretLength: secret?.length || 0,
      hasSignature: !!signature,
      hasTimestamp: !!timestamp,
      bodyLength: body?.length || 0,
      timestamp: timestamp,
      signature: signature?.substring(0, 20) + '...' // Only show first 20 chars for security
    });
    
    if (!secret) {
      console.error('[SLACK-AUTH-DEBUG] FAILED: SLACK_SIGNING_SECRET not configured');
      return {
        isValid: false,
        error: 'SLACK_SIGNING_SECRET not configured'
      };
    }

    if (!signature || !timestamp) {
      console.error('[SLACK-AUTH-DEBUG] FAILED: Missing headers', {
        hasSignature: !!signature,
        hasTimestamp: !!timestamp
      });
      return {
        isValid: false,
        error: 'Missing signature or timestamp headers'
      };
    }

    // Check timestamp to prevent replay attacks (within 5 minutes)
    const currentTime = Math.floor(Date.now() / 1000);
    const requestTime = parseInt(timestamp, 10);
    const timeDiff = Math.abs(currentTime - requestTime);
    
    console.log('[SLACK-AUTH-DEBUG] Timestamp check:', {
      currentTime,
      requestTime,
      timeDiff,
      maxAllowed: 300,
      isValid: timeDiff <= 300
    });
    
    if (timeDiff > 300) {
      console.error('[SLACK-AUTH-DEBUG] FAILED: Request timestamp too old', {
        timeDiff,
        maxAllowed: 300
      });
      return {
        isValid: false,
        error: 'Request timestamp too old',
        timestamp: requestTime
      };
    }

    // Create signature
    const baseString = `v0:${timestamp}:${body}`;
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(baseString);
    const expectedSignature = `v0=${hmac.digest('hex')}`;

    console.log('[SLACK-AUTH-DEBUG] Signature comparison:', {
      baseStringLength: baseString.length,
      receivedSignature: signature.substring(0, 20) + '...',
      expectedSignature: expectedSignature.substring(0, 20) + '...',
      signaturesMatch: signature === expectedSignature
    });

    // Use constant-time comparison to prevent timing attacks
    const isValid = crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );

    if (!isValid) {
      console.error('[SLACK-AUTH-DEBUG] FAILED: Invalid signature', {
        received: signature.substring(0, 20) + '...',
        expected: expectedSignature.substring(0, 20) + '...'
      });
      return {
        isValid: false,
        error: 'Invalid signature',
        timestamp: requestTime
      };
    }

    console.log('[SLACK-AUTH-DEBUG] SUCCESS: Signature validation passed');
    return {
      isValid: true,
      timestamp: requestTime
    };

  } catch (error) {
    console.error('[SLACK-AUTH-DEBUG] EXCEPTION during validation:', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined
    });
    return {
      isValid: false,
      error: `Validation error: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

/**
 * Validates verified workspaces if configured
 */
export function validateWorkspace(teamId: string): boolean {
  const verifiedWorkspaces = config.SLACK_VERIFIED_WORKSPACES;
  
  if (!verifiedWorkspaces) {
    return true; // Allow all workspaces if not configured
  }

  const allowedWorkspaces = verifiedWorkspaces.split(',').map(id => id.trim());
  return allowedWorkspaces.includes(teamId);
}

/**
 * Rate limiting for Slack requests per user
 */
const userRequestCounts = new Map<string, { count: number; resetTime: number }>();

export function checkSlackRateLimit(userId: string, maxRequests: number = 10): {
  allowed: boolean;
  remainingRequests: number;
  resetTime: number;
} {
  const now = Date.now();
  const windowMs = 60 * 1000; // 1 minute window
  
  const userStats = userRequestCounts.get(userId);
  
  if (!userStats || now > userStats.resetTime) {
    // First request or window expired
    const resetTime = now + windowMs;
    userRequestCounts.set(userId, { count: 1, resetTime });
    
    return {
      allowed: true,
      remainingRequests: maxRequests - 1,
      resetTime
    };
  }

  if (userStats.count >= maxRequests) {
    return {
      allowed: false,
      remainingRequests: 0,
      resetTime: userStats.resetTime
    };
  }

  // Increment count
  userStats.count++;
  userRequestCounts.set(userId, userStats);

  return {
    allowed: true,
    remainingRequests: maxRequests - userStats.count,
    resetTime: userStats.resetTime
  };
}

/**
 * Clean up old rate limit entries
 */
setInterval(() => {
  const now = Date.now();
  for (const [userId, stats] of userRequestCounts.entries()) {
    if (now > stats.resetTime) {
      userRequestCounts.delete(userId);
    }
  }
}, 5 * 60 * 1000); // Clean up every 5 minutes

/**
 * Extracts query text from Slack message, removing bot mentions
 */
export function extractQueryFromSlackText(text: string, botUserId?: string): string {
  let cleanText = text;
  
  // Remove bot mention
  if (botUserId) {
    const mentionPattern = new RegExp(`<@${botUserId}>`, 'g');
    cleanText = cleanText.replace(mentionPattern, '').trim();
  }
  
  // Remove any other user mentions for privacy
  cleanText = cleanText.replace(/<@[UW][A-Z0-9]+>/g, '').trim();
  
  // Remove channel mentions
  cleanText = cleanText.replace(/<#[CD][A-Z0-9]+\|[^>]+>/g, '').trim();
  
  // Remove URLs in angle brackets
  cleanText = cleanText.replace(/<https?:\/\/[^>]+>/g, '').trim();
  
  return cleanText;
}

/**
 * Determines collection hint from channel name or query prefix
 */
export function getCollectionHint(channelName: string, query: string): {
  collection?: 'pssis' | 'schoology' | 'both';
  cleanQuery: string;
} {
  let cleanQuery = query.trim();
  let collection: 'pssis' | 'schoology' | 'both' | undefined;

  // Check for explicit prefixes
  if (cleanQuery.toLowerCase().startsWith('pssis:')) {
    collection = 'pssis';
    cleanQuery = cleanQuery.substring(6).trim();
  } else if (cleanQuery.toLowerCase().startsWith('schoology:')) {
    collection = 'schoology';
    cleanQuery = cleanQuery.substring(10).trim(); // 'schoology:' is 10 characters
  } else if (cleanQuery.toLowerCase().startsWith('both:')) {
    collection = 'both';
    cleanQuery = cleanQuery.substring(5).trim();
  }
  
  // Check channel name patterns if no explicit prefix
  if (!collection && channelName) {
    const lowerChannelName = channelName.toLowerCase();
    if (lowerChannelName.includes('pssis')) {
      collection = 'pssis';
    } else if (lowerChannelName.includes('schoology')) {
      collection = 'schoology';
    }
  }

  return {
    ...(collection && { collection }),
    cleanQuery
  };
}

/**
 * Validates and sanitizes Slack payload
 */
export function sanitizeSlackPayload(payload: any): any {
  if (!payload || typeof payload !== 'object') {
    throw new RAGError('Invalid Slack payload', 'INVALID_SLACK_PAYLOAD');
  }

  // Remove potentially sensitive fields
  const sanitized = { ...payload };
  
  // Don't log full tokens
  if (sanitized.token) {
    sanitized.token = sanitized.token.substring(0, 8) + '...';
  }
  
  return sanitized;
}