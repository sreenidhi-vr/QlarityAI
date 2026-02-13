/**
 * Generalized crawl and seed functionality for multiple documentation sources
 */

import { v4 as uuidv4 } from 'uuid';
import { PowerSchoolCrawler } from '@/core/crawler/powerschool-crawler';
import { PostgresVectorAdapter } from '@/adapters/vector-store/postgres';
import { createEmbeddingAdapter } from '@/adapters/embedding';
import type { VectorDocument } from '@/types';
import config from '@/utils/config';

export interface CrawlAndSeedOptions {
  baseUrl: string;
  collection: string;
  maxPages?: number;
  delayMs?: number;
  chunkSize?: number;
}

export interface CrawlAndSeedResult {
  success: boolean;
  message: string;
  pagesCrawled: number;
  chunksInserted: number;
  errors?: string[];
  duration_ms: number;
}

/**
 * Chunk content into smaller pieces for embedding
 */
function chunkContent(content: string, maxLength: number = 4000): string[] {
  if (content.length <= maxLength) {
    return [content];
  }

  const chunks: string[] = [];
  let currentChunk = '';
  
  // Split by paragraphs first
  const paragraphs = content.split(/\n\s*\n/);
  
  for (const paragraph of paragraphs) {
    // If single paragraph is too long, split by sentences
    if (paragraph.length > maxLength) {
      const sentences = paragraph.split(/(?<=[.!?])\s+/);
      
      for (const sentence of sentences) {
        // If single sentence is still too long, split by words
        if (sentence.length > maxLength) {
          const words = sentence.split(/\s+/);
          let wordChunk = '';
          
          for (const word of words) {
            if ((wordChunk + ' ' + word).length > maxLength) {
              if (wordChunk) {
                chunks.push(wordChunk.trim());
              }
              wordChunk = word;
            } else {
              wordChunk += (wordChunk ? ' ' : '') + word;
            }
          }
          
          if (wordChunk) {
            if (currentChunk && (currentChunk + '\n\n' + wordChunk).length <= maxLength) {
              currentChunk += '\n\n' + wordChunk;
            } else {
              if (currentChunk) {
                chunks.push(currentChunk.trim());
              }
              currentChunk = wordChunk;
            }
          }
        } else {
          // Normal sentence processing
          if (currentChunk && (currentChunk + '\n\n' + sentence).length > maxLength) {
            chunks.push(currentChunk.trim());
            currentChunk = sentence;
          } else {
            currentChunk += (currentChunk ? '\n\n' : '') + sentence;
          }
        }
      }
    } else {
      // Normal paragraph processing
      if (currentChunk && (currentChunk + '\n\n' + paragraph).length > maxLength) {
        chunks.push(currentChunk.trim());
        currentChunk = paragraph;
      } else {
        currentChunk += (currentChunk ? '\n\n' : '') + paragraph;
      }
    }
  }
  
  if (currentChunk) {
    chunks.push(currentChunk.trim());
  }

  return chunks.filter(chunk => chunk.length > 0);
}

/**
 * Crawl a documentation site and seed the vector database
 */
export async function crawlAndSeed(options: CrawlAndSeedOptions): Promise<CrawlAndSeedResult> {
  const startTime = Date.now();
  const errors: string[] = [];
  
  console.log(`🌱 Starting crawl and seed for collection: ${options.collection}`);
  console.log(`📊 Target: ${options.baseUrl}`);
  console.log(`🔗 Database: ${config.DATABASE_URL.replace(/:[^:]*@/, ':****@')}`);
  console.log(`🤖 Embedding Provider: ${config.EMBEDDING_PROVIDER}`);
  console.log(`📝 Model: ${config.EMBEDDING_MODEL}`);
  console.log('');

  let vectorStore: PostgresVectorAdapter | undefined;
  
  try {
    // Initialize components
    console.log('🔧 Initializing components...');
    
    const crawler = new PowerSchoolCrawler({
      baseUrl: options.baseUrl,
      maxPages: options.maxPages || config.MAX_PAGES,
      delayMs: options.delayMs || config.CRAWL_DELAY_MS,
    });

    const embeddingAdapter = await createEmbeddingAdapter(
      config.EMBEDDING_PROVIDER as any,
      {
        model: config.EMBEDDING_MODEL,
      }
    );

    vectorStore = new PostgresVectorAdapter();

    // Test database connection
    console.log('🔍 Testing database connection...');
    const isHealthy = await vectorStore.health();
    if (!isHealthy) {
      throw new Error('Database health check failed - ensure migration has been run');
    }
    
    console.log('✅ Database connection successful');

    // Check current document count for this collection
    const existingCount = await vectorStore.count();
    console.log(`📊 Existing documents in database: ${existingCount}`);

    // Crawl documentation
    console.log('🕷️  Starting documentation crawl...');
    const crawlResult = await crawler.crawlSite();
    
    if (crawlResult.errors.length > 0) {
      console.log(`⚠️  Crawl completed with ${crawlResult.errors.length} errors:`);
      crawlResult.errors.slice(0, 5).forEach(error => {
        console.log(`   - ${error.url}: ${error.error}`);
        errors.push(`${error.url}: ${error.error}`);
      });
      if (crawlResult.errors.length > 5) {
        console.log(`   ... and ${crawlResult.errors.length - 5} more errors`);
      }
    }

    const documents = crawlResult.documents;
    console.log(`✅ Crawled ${documents.length} pages successfully`);

    if (documents.length === 0) {
      return {
        success: false,
        message: 'No documents were crawled - check the base URL and network connectivity',
        pagesCrawled: 0,
        chunksInserted: 0,
        errors,
        duration_ms: Date.now() - startTime,
      };
    }

    // Process documents in batches
    console.log('🔄 Processing documents and generating embeddings...');
    const batchSize = 10; // Process in smaller batches to avoid memory issues
    const vectorDocuments: VectorDocument[] = [];
    let processedCount = 0;
    let failedCount = 0;

    for (let i = 0; i < documents.length; i += batchSize) {
      const batch = documents.slice(i, i + batchSize);
      console.log(`   Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(documents.length / batchSize)} (${batch.length} documents)...`);

      for (const doc of batch) {
        try {
          // Check if content needs chunking
          const chunks = chunkContent(doc.content, options.chunkSize);
          
          if (chunks.length === 1) {
            // Single chunk - process normally
            const embedding = await embeddingAdapter.embed(doc.content);
            console.log(`     🔍 Generated embedding with ${embedding.length} dimensions (expected: ${embeddingAdapter.getDimensions()})`);
            
            const vectorDoc: VectorDocument = {
              id: uuidv4(),
              content: doc.content,
              embedding,
              metadata: {
                url: doc.url,
                title: doc.title,
                content_type: doc.metadata.content_type || 'text',
                collection: options.collection, // Tag with collection
                chunk_index: 0,
                total_chunks: 1,
                ...(doc.metadata.section && { section: doc.metadata.section }),
                ...(doc.metadata.subsection && { subsection: doc.metadata.subsection }),
                raw_html: doc.raw_html,
                created_at: new Date(),
                updated_at: new Date(),
              },
            };

            vectorDocuments.push(vectorDoc);
            processedCount++;
          } else {
            // Multiple chunks - process each chunk
            console.log(`     📄 Document "${doc.title}" chunked into ${chunks.length} pieces`);
            
            for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
              const chunk = chunks[chunkIndex];
              if (!chunk || chunk.trim().length === 0) continue;
              
              const embedding = await embeddingAdapter.embed(chunk);
              console.log(`       🔍 Generated chunk embedding with ${embedding.length} dimensions (expected: ${embeddingAdapter.getDimensions()})`);
              
              const vectorDoc: VectorDocument = {
                id: uuidv4(),
                content: chunk,
                embedding,
                metadata: {
                  url: `${doc.url}#chunk-${chunkIndex}`,
                  title: `${doc.title} (Part ${chunkIndex + 1}/${chunks.length})`,
                  content_type: doc.metadata.content_type || 'text',
                  collection: options.collection, // Tag with collection
                  chunk_index: chunkIndex,
                  total_chunks: chunks.length,
                  ...(doc.metadata.section && { section: doc.metadata.section }),
                  ...(doc.metadata.subsection && { subsection: doc.metadata.subsection }),
                  raw_html: doc.raw_html,
                  created_at: new Date(),
                  updated_at: new Date(),
                },
              };

              vectorDocuments.push(vectorDoc);
            }
            
            processedCount += chunks.length;
          }

        } catch (error) {
          console.error(`   ❌ Failed to process ${doc.url}:`, error instanceof Error ? error.message : error);
          failedCount++;
          errors.push(`Failed to process ${doc.url}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      }

      // Small delay between batches
      if (i + batchSize < documents.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    console.log(`✅ Generated embeddings for ${processedCount} documents`);
    if (failedCount > 0) {
      console.log(`⚠️  Failed to process ${failedCount} documents`);
    }

    if (vectorDocuments.length === 0) {
      return {
        success: false,
        message: 'No documents could be processed successfully',
        pagesCrawled: documents.length,
        chunksInserted: 0,
        errors,
        duration_ms: Date.now() - startTime,
      };
    }

    // Store in vector database
    console.log('💾 Storing documents in vector database...');
    await vectorStore.upsert(vectorDocuments);
    console.log('✅ Documents stored successfully');

    // Verify storage
    const finalCount = await vectorStore.count();
    console.log(`📊 Total documents in database: ${finalCount}`);

    const result: CrawlAndSeedResult = {
      success: true,
      message: `Successfully crawled and seeded ${documents.length} pages with ${vectorDocuments.length} chunks for collection '${options.collection}'`,
      pagesCrawled: documents.length,
      chunksInserted: vectorDocuments.length,
      duration_ms: Date.now() - startTime,
    };

    if (errors.length > 0) {
      result.errors = errors;
    }

    return result;

  } catch (error) {
    console.error('❌ Crawl and seed failed:', error);
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown seeding error';
    errors.push(errorMessage);
    
    return {
      success: false,
      message: errorMessage,
      pagesCrawled: 0,
      chunksInserted: 0,
      errors,
      duration_ms: Date.now() - startTime,
    };
  } finally {
    // Clean up connections
    if (vectorStore) {
      try {
        await vectorStore.close();
      } catch (error) {
        console.error('Warning: Failed to close vector store connection:', error);
      }
    }
  }
}