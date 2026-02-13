/**
 * In-memory vector store implementation for development and testing
 */

import type { VectorStoreAdapter, VectorDocument, SearchResult } from '@/types';
import { RAGError } from '@/types';
import { EmbeddingUtils } from '@/adapters/embedding/base';

export interface InMemoryVectorOptions {
  maxDocuments?: number;
  persistToFile?: string;
  loadFromFile?: string;
}

/**
 * In-memory vector store adapter for development and testing
 */
export class InMemoryVectorAdapter implements VectorStoreAdapter {
  private documents: Map<string, VectorDocument> = new Map();
  private urlToIdMap: Map<string, string> = new Map();
  private readonly maxDocuments: number;
  private readonly persistToFile: string | undefined;

  constructor(options: InMemoryVectorOptions = {}) {
    this.maxDocuments = options.maxDocuments || 10000;
    this.persistToFile = options.persistToFile;

    // Load data from file if specified
    if (options.loadFromFile) {
      this.loadFromFile(options.loadFromFile);
    }
  }

  /**
   * Insert or update documents with their embeddings
   */
  async upsert(docs: VectorDocument[]): Promise<void> {
    if (docs.length === 0) {
      return;
    }

    // Check capacity
    const newDocCount = docs.length;
    const currentCount = this.documents.size;
    
    if (currentCount + newDocCount > this.maxDocuments) {
      throw new RAGError(
        `Memory vector store capacity exceeded: ${currentCount + newDocCount} > ${this.maxDocuments}`,
        'MEMORY_CAPACITY_EXCEEDED',
        {
          currentCount,
          newDocuments: newDocCount,
          maxCapacity: this.maxDocuments,
        }
      );
    }

    try {
      for (const doc of docs) {
        // Validate document
        this.validateDocument(doc);
        
        // Remove existing document with same URL if exists
        const existingId = this.urlToIdMap.get(doc.metadata.url);
        if (existingId) {
          this.documents.delete(existingId);
        }

        // Add new document
        this.documents.set(doc.id, doc);
        this.urlToIdMap.set(doc.metadata.url, doc.id);
      }

      // Optionally persist to file
      if (this.persistToFile) {
        await this.saveToFile(this.persistToFile);
      }

    } catch (error) {
      throw new RAGError(
        `Failed to upsert documents in memory store: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'MEMORY_UPSERT_FAILED',
        {
          documentCount: docs.length,
          originalError: error,
        }
      );
    }
  }

  /**
   * Search for similar documents using vector similarity
   */
  async search(queryEmbedding: number[], topK: number): Promise<SearchResult[]> {
    if (queryEmbedding.length === 0) {
      throw new RAGError('Query embedding cannot be empty', 'EMPTY_QUERY_EMBEDDING');
    }

    if (topK <= 0) {
      throw new RAGError('topK must be greater than 0', 'INVALID_TOP_K');
    }

    try {
      const results: Array<{
        document: VectorDocument;
        similarity: number;
      }> = [];

      // Calculate similarity for all documents
      for (const doc of this.documents.values()) {
        if (doc.embedding.length !== queryEmbedding.length) {
          continue; // Skip documents with different embedding dimensions
        }

        const similarity = EmbeddingUtils.cosineSimilarity(queryEmbedding, doc.embedding);
        results.push({ document: doc, similarity });
      }

      // Sort by similarity (highest first) and take top K
      results.sort((a, b) => b.similarity - a.similarity);
      const topResults = results.slice(0, topK);

      return topResults.map(result => ({
        id: result.document.id,
        content: result.document.content,
        metadata: result.document.metadata,
        score: result.similarity,
      }));

    } catch (error) {
      throw new RAGError(
        `Memory vector search failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'MEMORY_SEARCH_FAILED',
        {
          topK,
          embeddingDimensions: queryEmbedding.length,
          documentCount: this.documents.size,
          originalError: error,
        }
      );
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
      similarityThreshold?: number;
      dateRange?: { start?: Date; end?: Date };
    } = {}
  ): Promise<SearchResult[]> {
    try {
      const results: Array<{
        document: VectorDocument;
        similarity: number;
      }> = [];

      for (const doc of this.documents.values()) {
        // Skip documents with different embedding dimensions
        if (doc.embedding.length !== queryEmbedding.length) {
          continue;
        }

        // Apply content type filter
        if (filters.contentTypes && filters.contentTypes.length > 0) {
          if (!filters.contentTypes.includes(doc.metadata.content_type)) {
            continue;
          }
        }

        // Apply section filter
        if (filters.sections && filters.sections.length > 0) {
          if (!doc.metadata.section || !filters.sections.includes(doc.metadata.section)) {
            continue;
          }
        }

        // Apply date range filter
        if (filters.dateRange?.start && doc.metadata.created_at < filters.dateRange.start) {
          continue;
        }
        if (filters.dateRange?.end && doc.metadata.created_at > filters.dateRange.end) {
          continue;
        }

        // Calculate similarity
        const similarity = EmbeddingUtils.cosineSimilarity(queryEmbedding, doc.embedding);

        // Apply similarity threshold
        if (filters.similarityThreshold && similarity < filters.similarityThreshold) {
          continue;
        }

        results.push({ document: doc, similarity });
      }

      // Sort and take top K
      results.sort((a, b) => b.similarity - a.similarity);
      const topResults = results.slice(0, topK);

      return topResults.map(result => ({
        id: result.document.id,
        content: result.document.content,
        metadata: result.document.metadata,
        score: result.similarity,
      }));

    } catch (error) {
      throw new RAGError(
        `Filtered memory search failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'MEMORY_FILTERED_SEARCH_FAILED',
        {
          topK,
          filters,
          originalError: error,
        }
      );
    }
  }

  /**
   * Delete documents by IDs
   */
  async delete(ids: string[]): Promise<void> {
    if (ids.length === 0) {
      return;
    }

    try {
      let deletedCount = 0;

      for (const id of ids) {
        const doc = this.documents.get(id);
        if (doc) {
          this.documents.delete(id);
          this.urlToIdMap.delete(doc.metadata.url);
          deletedCount++;
        }
      }

      if (deletedCount === 0) {
        throw new RAGError(
          'No documents were found to delete',
          'DELETE_NO_DOCUMENTS_FOUND',
          { requestedIds: ids }
        );
      }

      // Persist changes
      if (this.persistToFile) {
        await this.saveToFile(this.persistToFile);
      }

    } catch (error) {
      if (error instanceof RAGError) {
        throw error;
      }

      throw new RAGError(
        `Failed to delete documents from memory store: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'MEMORY_DELETE_FAILED',
        {
          idsCount: ids.length,
          originalError: error,
        }
      );
    }
  }

  /**
   * Get total document count
   */
  async count(): Promise<number> {
    return this.documents.size;
  }

  /**
   * Health check for the vector store
   */
  async health(): Promise<boolean> {
    // Memory store is always healthy if it exists
    return true;
  }

  /**
   * Get statistics about the memory store
   */
  async getStats(): Promise<{
    totalDocuments: number;
    uniqueUrls: number;
    avgContentLength: number;
    contentTypes: Record<string, number>;
    memoryUsage: {
      documentsSize: number;
      avgEmbeddingSize: number;
      totalEmbeddings: number;
    };
  }> {
    const contentTypes: Record<string, number> = {};
    let totalContentLength = 0;
    let totalEmbeddingSize = 0;

    for (const doc of this.documents.values()) {
      // Count content types
      const type = doc.metadata.content_type;
      contentTypes[type] = (contentTypes[type] || 0) + 1;

      // Calculate content length
      totalContentLength += doc.content.length;

      // Calculate embedding size
      totalEmbeddingSize += doc.embedding.length;
    }

    return {
      totalDocuments: this.documents.size,
      uniqueUrls: this.urlToIdMap.size,
      avgContentLength: this.documents.size > 0 ? Math.round(totalContentLength / this.documents.size) : 0,
      contentTypes,
      memoryUsage: {
        documentsSize: this.documents.size,
        avgEmbeddingSize: this.documents.size > 0 ? Math.round(totalEmbeddingSize / this.documents.size) : 0,
        totalEmbeddings: this.documents.size,
      },
    };
  }

  /**
   * Clear all documents
   */
  async clear(): Promise<void> {
    this.documents.clear();
    this.urlToIdMap.clear();

    if (this.persistToFile) {
      await this.saveToFile(this.persistToFile);
    }
  }

  /**
   * Get all documents (useful for debugging)
   */
  getAllDocuments(): VectorDocument[] {
    return Array.from(this.documents.values());
  }

  /**
   * Get document by ID
   */
  getDocumentById(id: string): VectorDocument | undefined {
    return this.documents.get(id);
  }

  /**
   * Get document by URL
   */
  getDocumentByUrl(url: string): VectorDocument | undefined {
    const id = this.urlToIdMap.get(url);
    return id ? this.documents.get(id) : undefined;
  }

  /**
   * Validate document structure
   */
  private validateDocument(doc: VectorDocument): void {
    if (!doc.id || typeof doc.id !== 'string') {
      throw new RAGError('Document ID is required and must be a string', 'INVALID_DOCUMENT_ID');
    }

    if (!doc.content || typeof doc.content !== 'string') {
      throw new RAGError('Document content is required and must be a string', 'INVALID_DOCUMENT_CONTENT');
    }

    if (!Array.isArray(doc.embedding) || doc.embedding.length === 0) {
      throw new RAGError('Document embedding is required and must be a non-empty array', 'INVALID_DOCUMENT_EMBEDDING');
    }

    if (!doc.metadata || typeof doc.metadata !== 'object') {
      throw new RAGError('Document metadata is required and must be an object', 'INVALID_DOCUMENT_METADATA');
    }

    if (!doc.metadata.url || typeof doc.metadata.url !== 'string') {
      throw new RAGError('Document metadata must include a valid URL', 'INVALID_DOCUMENT_URL');
    }

    if (!doc.metadata.title || typeof doc.metadata.title !== 'string') {
      throw new RAGError('Document metadata must include a valid title', 'INVALID_DOCUMENT_TITLE');
    }
  }

  /**
   * Save documents to file (JSON format)
   */
  private async saveToFile(filePath: string): Promise<void> {
    // This would require fs module in a real implementation
    // For now, just a placeholder
    try {
      // const data = {
      //   documents: Array.from(this.documents.entries()),
      //   urlToIdMap: Array.from(this.urlToIdMap.entries()),
      //   timestamp: new Date().toISOString(),
      // };

      // In production: await fs.writeFile(filePath, JSON.stringify(data, null, 2));
      
    } catch (error) {
      throw new RAGError(
        `Failed to save memory store to file: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'MEMORY_SAVE_FAILED',
        { filePath, originalError: error }
      );
    }
  }

  /**
   * Load documents from file (JSON format)
   */
  private loadFromFile(filePath: string): void {
    // This would require fs module in a real implementation
    // For now, just a placeholder
    try {
      // In production: 
      // const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      // this.documents = new Map(data.documents);
      // this.urlToIdMap = new Map(data.urlToIdMap);
      
    } catch (error) {
      throw new RAGError(
        `Failed to load memory store from file: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'MEMORY_LOAD_FAILED',
        { filePath, originalError: error }
      );
    }
  }
}