/**
 * Source caching for Slack interactive features
 * Provides temporary storage for response sources and metadata
 */

export interface CachedSource {
  id: string;
  url: string;
  title: string;
  snippet: string;
  retrieval_score: number;
}

export interface CachedResponse {
  responseId: string;
  originalText: string;
  sources: CachedSource[];
  userId: string;
  channelId: string;
  threadTs?: string;
  createdAt: number;
  ttlMs: number;
}

// TODO: Migrate to persistent storage (Redis/DB) for production
class SourceCacheManager {
  private cache = new Map<string, CachedResponse>();
  private readonly defaultTtlMs = 1000 * 60 * 60; // 1 hour

  /**
   * Store response and sources for interactive features
   */
  store(responseId: string, data: Omit<CachedResponse, 'responseId' | 'createdAt' | 'ttlMs'>): void {
    const cachedResponse: CachedResponse = {
      responseId,
      ...data,
      createdAt: Date.now(),
      ttlMs: this.defaultTtlMs
    };

    this.cache.set(responseId, cachedResponse);
    this.scheduleCleanup(responseId, this.defaultTtlMs);
  }

  /**
   * Retrieve cached response data
   */
  get(responseId: string): CachedResponse | null {
    const cached = this.cache.get(responseId);
    
    if (!cached) {
      return null;
    }

    // Check if expired
    if (Date.now() - cached.createdAt > cached.ttlMs) {
      this.cache.delete(responseId);
      return null;
    }

    return cached;
  }

  /**
   * Get sources for a specific response
   */
  getSources(responseId: string): CachedSource[] {
    const cached = this.get(responseId);
    return cached?.sources || [];
  }

  /**
   * Delete cached response
   */
  delete(responseId: string): boolean {
    return this.cache.delete(responseId);
  }

  /**
   * Clean up expired entries
   */
  cleanup(): void {
    const now = Date.now();
    
    for (const [key, cached] of this.cache.entries()) {
      if (now - cached.createdAt > cached.ttlMs) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Get cache statistics
   */
  getStats(): { total: number; expired: number; active: number } {
    const now = Date.now();
    let expired = 0;
    let active = 0;

    for (const cached of this.cache.values()) {
      if (now - cached.createdAt > cached.ttlMs) {
        expired++;
      } else {
        active++;
      }
    }

    return {
      total: this.cache.size,
      expired,
      active
    };
  }

  /**
   * Schedule automatic cleanup for a specific entry
   */
  private scheduleCleanup(responseId: string, ttlMs: number): void {
    setTimeout(() => {
      this.cache.delete(responseId);
    }, ttlMs);
  }
}

// Global cache instance
export const sourceCache = new SourceCacheManager();

// Periodic cleanup every 5 minutes
setInterval(() => {
  sourceCache.cleanup();
}, 5 * 60 * 1000);