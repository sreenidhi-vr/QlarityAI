/**
 * Vector store adapters export index
 */

export { PostgresVectorAdapter, type PostgresVectorOptions } from './postgres';
export { InMemoryVectorAdapter, type InMemoryVectorOptions } from './memory';

// Re-export types
export type { VectorStoreAdapter, VectorDocument, SearchResult, DocumentMetadata } from '@/types';
import type { VectorStoreAdapter } from '@/types';
import type { PostgresVectorOptions } from './postgres';
import type { InMemoryVectorOptions } from './memory';

/**
 * Vector store factory function
 */
export async function createVectorStore(
  provider: 'postgres' | 'memory' = 'postgres',
  options: Record<string, unknown> = {}
): Promise<VectorStoreAdapter> {
  switch (provider) {
    case 'postgres':
      const { PostgresVectorAdapter } = await import('./postgres');
      return new PostgresVectorAdapter(options as PostgresVectorOptions);

    case 'memory':
      const { InMemoryVectorAdapter } = await import('./memory');
      return new InMemoryVectorAdapter(options as InMemoryVectorOptions);

    default:
      throw new Error(`Unsupported vector store provider: ${provider}`);
  }
}

/**
 * Get recommended vector store based on environment
 */
export function getRecommendedVectorStore(): 'postgres' | 'memory' {
  // Simple heuristic: use memory store for test or when no env vars available
  // In production code, this would be determined by configuration
  try {
    // Try to access NODE_ENV through a safer method
    const nodeEnv = typeof process !== 'undefined' ? process.env.NODE_ENV : 'development';
    const hasDbUrl = typeof process !== 'undefined' ? Boolean(process.env.DATABASE_URL) : false;
    
    if (nodeEnv === 'test' || !hasDbUrl) {
      return 'memory';
    }
    
    return 'postgres';
  } catch {
    // Fallback to memory store if process is not available
    return 'memory';
  }
}