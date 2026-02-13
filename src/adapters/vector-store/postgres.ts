/**
 * PostgreSQL + pgvector implementation of VectorStoreAdapter
 */

import { Pool, type PoolClient } from 'pg';
import type { VectorStoreAdapter, VectorDocument, SearchResult, DocumentMetadata } from '@/types';
import { RAGError } from '@/types';
import config from '@/utils/config';

export interface PostgresVectorOptions {
  connectionString?: string;
  tableName?: string;
  poolSize?: number;
  connectionTimeout?: number;
  queryTimeout?: number;
}

/**
 * PostgreSQL vector store adapter using pgvector extension
 */
export class PostgresVectorAdapter implements VectorStoreAdapter {
  private readonly pool: Pool;
  private readonly tableName: string;
  private readonly queryTimeout: number;

  constructor(options: PostgresVectorOptions = {}) {
    this.tableName = options.tableName || config.VECTOR_TABLE_NAME || 'documents';
    this.queryTimeout = options.queryTimeout || 30000; // 30 seconds

    const connectionString = options.connectionString || config.DATABASE_URL;
    
    if (!connectionString) {
      throw new RAGError(
        'Database connection string is required',
        'MISSING_DATABASE_URL'
      );
    }

    // Initialize PostgreSQL connection pool
    this.pool = new Pool({
      connectionString,
      max: options.poolSize || 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: options.connectionTimeout || 5000,
      statement_timeout: this.queryTimeout,
      query_timeout: this.queryTimeout,
    });

    // Handle pool errors
    this.pool.on('error', (_err: Error) => {
      // In production, this should use a proper logger
      // console.error('Unexpected error on idle client', err);
    });
  }

  /**
   * Insert or update documents with their embeddings
   */
  async upsert(docs: VectorDocument[]): Promise<void> {
    if (docs.length === 0) {
      return;
    }

    const client = await this.getClient();
    
    try {
      await client.query('BEGIN');

      // Prepare the upsert query
      const query = `
        INSERT INTO ${this.tableName} (
          id, url, title, content, raw_html, embedding, metadata,
          content_type, chunk_index, total_chunks, section, subsection, collection
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        ON CONFLICT (url) DO UPDATE SET
          title = EXCLUDED.title,
          content = EXCLUDED.content,
          raw_html = EXCLUDED.raw_html,
          embedding = EXCLUDED.embedding,
          metadata = EXCLUDED.metadata,
          content_type = EXCLUDED.content_type,
          chunk_index = EXCLUDED.chunk_index,
          total_chunks = EXCLUDED.total_chunks,
          section = EXCLUDED.section,
          subsection = EXCLUDED.subsection,
          collection = EXCLUDED.collection,
          updated_at = NOW()
      `;

      // Execute batch insert
      for (const doc of docs) {
        const values = [
          doc.id,
          doc.metadata.url,
          doc.metadata.title,
          doc.content,
          doc.metadata.raw_html || null,
          JSON.stringify(doc.embedding), // PostgreSQL vector format
          JSON.stringify(doc.metadata),
          doc.metadata.content_type || 'text',
          doc.metadata.chunk_index || 0,
          doc.metadata.total_chunks || 1,
          doc.metadata.section || null,
          doc.metadata.subsection || null,
          doc.metadata.collection || 'pssis-admin',
        ];

        await client.query(query, values);
      }

      await client.query('COMMIT');

    } catch (error) {
      await client.query('ROLLBACK');
      
      throw new RAGError(
        `Failed to upsert documents: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'VECTOR_UPSERT_FAILED',
        { 
          documentCount: docs.length,
          originalError: error,
        }
      );
    } finally {
      client.release();
    }
  }

  /**
   * Search for similar documents using vector similarity
   */
  async search(queryEmbedding: number[], topK: number): Promise<SearchResult[]> {
    const client = await this.getClient();

    try {
      const embeddingStr = JSON.stringify(queryEmbedding);
      
      const query = `
        SELECT
          id,
          url,
          title,
          content,
          metadata,
          content_type,
          section,
          subsection,
          collection,
          (1 - (embedding <=> $1::vector)) as similarity_score
        FROM ${this.tableName}
        WHERE embedding IS NOT NULL
        ORDER BY embedding <=> $1::vector
        LIMIT $2
      `;

      const result = await client.query(query, [embeddingStr, topK]);
      
      return result.rows.map((row: any) => ({
        id: row.id,
        content: row.content,
        metadata: {
          url: row.url,
          title: row.title,
          content_type: row.content_type,
          section: row.section,
          subsection: row.subsection,
          collection: row.collection,
          chunk_index: row.metadata?.chunk_index || 0,
          total_chunks: row.metadata?.total_chunks || 1,
          created_at: new Date(row.metadata?.created_at || Date.now()),
          updated_at: new Date(row.metadata?.updated_at || Date.now()),
          ...row.metadata,
        } as DocumentMetadata,
        score: parseFloat(row.similarity_score),
      }));

    } catch (error) {
      throw new RAGError(
        `Vector search failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'VECTOR_SEARCH_FAILED',
        { 
          topK,
          embeddingDimensions: queryEmbedding.length,
          originalError: error,
        }
      );
    } finally {
      client.release();
    }
  }

  /**
   * Advanced search with filters and threshold
   */
  async searchWithFilters(
    queryEmbedding: number[],
    topK: number,
    filters: {
      contentTypes?: string[];
      sections?: string[];
      collections?: string[];
      similarityThreshold?: number;
      dateRange?: { start?: Date; end?: Date };
    } = {}
  ): Promise<SearchResult[]> {
    const client = await this.getClient();

    try {
      const embeddingStr = JSON.stringify(queryEmbedding);
      const conditions: string[] = ['embedding IS NOT NULL'];
      const values: any[] = [embeddingStr, topK];
      let paramIndex = 3;

      // Add similarity threshold
      if (filters.similarityThreshold !== undefined) {
        conditions.push(`(1 - (embedding <=> $1::vector)) >= $${paramIndex}`);
        values.push(filters.similarityThreshold);
        paramIndex++;
      }

      // Add content type filter
      if (filters.contentTypes && filters.contentTypes.length > 0) {
        conditions.push(`content_type = ANY($${paramIndex})`);
        values.push(filters.contentTypes);
        paramIndex++;
      }

      // Add sections filter
      if (filters.sections && filters.sections.length > 0) {
        conditions.push(`section = ANY($${paramIndex})`);
        values.push(filters.sections);
        paramIndex++;
      }

      // Add collections filter
      if (filters.collections && filters.collections.length > 0) {
        conditions.push(`collection = ANY($${paramIndex})`);
        values.push(filters.collections);
        paramIndex++;
      }

      // Add date range filter
      if (filters.dateRange?.start) {
        conditions.push(`created_at >= $${paramIndex}`);
        values.push(filters.dateRange.start);
        paramIndex++;
      }

      if (filters.dateRange?.end) {
        conditions.push(`created_at <= $${paramIndex}`);
        values.push(filters.dateRange.end);
        paramIndex++;
      }

      const query = `
        SELECT
          id,
          url,
          title,
          content,
          metadata,
          content_type,
          section,
          subsection,
          collection,
          (1 - (embedding <=> $1::vector)) as similarity_score
        FROM ${this.tableName}
        WHERE ${conditions.join(' AND ')}
        ORDER BY embedding <=> $1::vector
        LIMIT $2
      `;

      const result = await client.query(query, values);
      
      return result.rows.map((row: any) => ({
        id: row.id,
        content: row.content,
        metadata: {
          url: row.url,
          title: row.title,
          content_type: row.content_type,
          section: row.section,
          subsection: row.subsection,
          collection: row.collection,
          chunk_index: row.metadata?.chunk_index || 0,
          total_chunks: row.metadata?.total_chunks || 1,
          created_at: new Date(row.metadata?.created_at || Date.now()),
          updated_at: new Date(row.metadata?.updated_at || Date.now()),
          ...row.metadata,
        } as DocumentMetadata,
        score: parseFloat(row.similarity_score),
      }));

    } catch (error) {
      throw new RAGError(
        `Filtered vector search failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'FILTERED_VECTOR_SEARCH_FAILED',
        { 
          topK,
          filters,
          originalError: error,
        }
      );
    } finally {
      client.release();
    }
  }

  /**
   * Hybrid search combining vector similarity and full-text search
   */
  async hybridSearch(
    queryEmbedding: number[],
    queryText: string,
    topK: number,
    weights: { vector: number; text: number } = { vector: 0.7, text: 0.3 },
    collections?: string[]
  ): Promise<SearchResult[]> {
    const client = await this.getClient();

    try {
      const embeddingStr = JSON.stringify(queryEmbedding);
      
      const conditions = [
        'embedding IS NOT NULL',
        '(search_vector @@ plainto_tsquery(\'english\', $2) OR (embedding <=> $1::vector) < 0.5)'
      ];
      const values: any[] = [embeddingStr, queryText, weights.vector, weights.text];
      let paramIndex = 6;

      if (collections && collections.length > 0) {
        conditions.push(`collection = ANY($${paramIndex})`);
        values.push(collections);
        paramIndex++;
      }

      const query = `
        SELECT
          id,
          url,
          title,
          content,
          metadata,
          content_type,
          section,
          subsection,
          collection,
          (
            $3 * (1 - (embedding <=> $1::vector)) +
            $4 * ts_rank(search_vector, plainto_tsquery('english', $2))
          ) as combined_score
        FROM ${this.tableName}
        WHERE ${conditions.join(' AND ')}
        ORDER BY combined_score DESC
        LIMIT $5
      `;

      values.splice(4, 0, topK); // Insert topK at position 4
      const result = await client.query(query, values);
      
      return result.rows.map((row: any) => ({
        id: row.id,
        content: row.content,
        metadata: {
          url: row.url,
          title: row.title,
          content_type: row.content_type,
          section: row.section,
          subsection: row.subsection,
          collection: row.collection,
          chunk_index: row.metadata?.chunk_index || 0,
          total_chunks: row.metadata?.total_chunks || 1,
          created_at: new Date(row.metadata?.created_at || Date.now()),
          updated_at: new Date(row.metadata?.updated_at || Date.now()),
          ...row.metadata,
        } as DocumentMetadata,
        score: parseFloat(row.combined_score),
      }));

    } catch (error) {
      throw new RAGError(
        `Hybrid search failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'HYBRID_SEARCH_FAILED',
        { 
          topK,
          queryText: queryText.substring(0, 100),
          originalError: error,
        }
      );
    } finally {
      client.release();
    }
  }

  /**
   * Delete documents by IDs
   */
  async delete(ids: string[]): Promise<void> {
    if (ids.length === 0) {
      return;
    }

    const client = await this.getClient();

    try {
      const query = `DELETE FROM ${this.tableName} WHERE id = ANY($1)`;
      const result = await client.query(query, [ids]);
      
      if (result.rowCount === 0) {
        throw new RAGError(
          'No documents were deleted',
          'DELETE_NO_DOCUMENTS_FOUND',
          { requestedIds: ids }
        );
      }

    } catch (error) {
      if (error instanceof RAGError) {
        throw error;
      }
      
      throw new RAGError(
        `Failed to delete documents: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'VECTOR_DELETE_FAILED',
        { 
          idsCount: ids.length,
          originalError: error,
        }
      );
    } finally {
      client.release();
    }
  }

  /**
   * Get total document count
   */
  async count(): Promise<number> {
    const client = await this.getClient();

    try {
      const query = `SELECT COUNT(*) as count FROM ${this.tableName}`;
      const result = await client.query(query);
      return parseInt(result.rows[0]?.count || '0', 10);
      
    } catch (error) {
      throw new RAGError(
        `Failed to count documents: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'VECTOR_COUNT_FAILED',
        { originalError: error }
      );
    } finally {
      client.release();
    }
  }

  /**
   * Health check for the vector store
   */
  async health(): Promise<boolean> {
    const client = await this.getClient();

    try {
      // Test basic connectivity
      await client.query('SELECT 1');
      
      // Test pgvector extension
      await client.query('SELECT 1 FROM pg_extension WHERE extname = \'vector\'');
      
      // Test table existence
      const result = await client.query(
        'SELECT 1 FROM information_schema.tables WHERE table_name = $1',
        [this.tableName]
      );
      
      return result.rows.length > 0;
      
    } catch (error) {
      return false;
    } finally {
      client.release();
    }
  }

  /**
   * Get database statistics
   */
  async getStats(): Promise<{
    totalDocuments: number;
    uniqueUrls: number;
    avgContentLength: number;
    contentTypes: Record<string, number>;
    indexHealth: {
      vectorIndexSize: string;
      lastVacuum?: Date;
    };
  }> {
    const client = await this.getClient();

    try {
      // Get basic document stats
      const basicStatsQuery = `
        SELECT
          COUNT(*) as total_documents,
          COUNT(DISTINCT url) as unique_urls,
          COALESCE(AVG(LENGTH(content))::INTEGER, 0) as avg_content_length
        FROM ${this.tableName}
      `;

      const basicStatsResult = await client.query(basicStatsQuery);
      const basicStats = basicStatsResult.rows[0];

      // Get content type stats
      const contentTypeQuery = `
        SELECT
          content_type,
          COUNT(*) as type_count
        FROM ${this.tableName}
        GROUP BY content_type
      `;

      const contentTypeResult = await client.query(contentTypeQuery);
      const contentTypes: Record<string, number> = {};
      
      contentTypeResult.rows.forEach(row => {
        contentTypes[row.content_type] = parseInt(row.type_count, 10);
      });

      // Get index size information
      const indexQuery = `
        SELECT
          pg_size_pretty(pg_total_relation_size($1)) as vector_index_size
      `;
      
      const indexResult = await client.query(indexQuery, [this.tableName]);
      
      return {
        totalDocuments: parseInt(basicStats.total_documents, 10),
        uniqueUrls: parseInt(basicStats.unique_urls, 10),
        avgContentLength: parseInt(basicStats.avg_content_length || '0', 10),
        contentTypes,
        indexHealth: {
          vectorIndexSize: indexResult.rows[0]?.vector_index_size || 'Unknown',
        },
      };

    } catch (error) {
      throw new RAGError(
        `Failed to get vector store stats: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'VECTOR_STATS_FAILED',
        { originalError: error }
      );
    } finally {
      client.release();
    }
  }

  /**
   * Clear all documents (use with caution)
   */
  async clear(): Promise<void> {
    const client = await this.getClient();

    try {
      await client.query(`TRUNCATE TABLE ${this.tableName} RESTART IDENTITY`);
    } catch (error) {
      throw new RAGError(
        `Failed to clear vector store: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'VECTOR_CLEAR_FAILED',
        { originalError: error }
      );
    } finally {
      client.release();
    }
  }

  /**
   * Close the connection pool
   */
  async close(): Promise<void> {
    await this.pool.end();
  }

  /**
   * Get a database client from the pool
   */
  private async getClient(): Promise<PoolClient> {
    try {
      return await this.pool.connect();
    } catch (error) {
      throw new RAGError(
        `Failed to get database connection: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'DATABASE_CONNECTION_FAILED',
        { originalError: error }
      );
    }
  }
}