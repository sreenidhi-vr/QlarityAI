/**
 * Database seeding script for PowerSchool RAG API
 * Crawls PowerSchool documentation and populates the vector database
 */

import { v4 as uuidv4 } from 'uuid';
import { PowerSchoolCrawler } from '@/core/crawler/powerschool-crawler';
import { PostgresVectorAdapter } from '@/adapters/vector-store/postgres';
import { createEmbeddingAdapter } from '@/adapters/embedding';
import type { VectorDocument } from '@/types';
import config from '@/utils/config';

interface SeedResult {
  success: boolean;
  message: string;
  details?: Record<string, unknown>;
}

interface SeedStats {
  crawledPages: number;
  processedDocuments: number;
  embeddingsGenerated: number;
  failedDocuments: number;
  startTime: Date;
  endTime: Date;
  durationMs: number;
}

/**
 * Chunk content into smaller pieces for embedding
 */
function chunkContent(content: string, maxLength: number = 45000): string[] {
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
 * Main seeding function
 */
async function seedDatabase(): Promise<SeedResult> {
  const startTime = new Date();
  console.log('🌱 Starting PowerSchool RAG database seeding...');
  console.log(`📊 Target: ${config.CRAWL_BASE_URL}`);
  console.log(`🔗 Database: ${config.DATABASE_URL.replace(/:[^:]*@/, ':****@')}`);
  console.log(`🤖 Embedding Provider: ${config.EMBEDDING_PROVIDER}`);
  console.log(`📝 Model: ${config.EMBEDDING_MODEL}`);
  console.log('');

  let vectorStore: PostgresVectorAdapter | undefined;
  
  try {
    // Initialize components
    console.log('🔧 Initializing components...');
    
    const crawler = new PowerSchoolCrawler({
      baseUrl: config.CRAWL_BASE_URL,
      maxPages: config.MAX_PAGES,
      delayMs: config.CRAWL_DELAY_MS,
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

    // Check current document count
    const existingCount = await vectorStore.count();
    console.log(`📊 Existing documents in database: ${existingCount}`);

    // Crawl documentation
    console.log('🕷️  Starting documentation crawl...');
    const crawlResult = await crawler.crawlSite();
    
    if (crawlResult.errors.length > 0) {
      console.log(`⚠️  Crawl completed with ${crawlResult.errors.length} errors:`);
      crawlResult.errors.slice(0, 5).forEach(error => {
        console.log(`   - ${error.url}: ${error.error}`);
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
        details: { crawlStats: crawlResult.stats }
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
          const chunks = chunkContent(doc.content);
          
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
        details: { processedCount, failedCount }
      };
    }

    // Store in vector database
    console.log('💾 Storing documents in vector database...');
    await vectorStore.upsert(vectorDocuments);
    console.log('✅ Documents stored successfully');

    // Verify storage
    const finalCount = await vectorStore.count();
    console.log(`📊 Total documents in database: ${finalCount}`);

    // Get database statistics
    const dbStats = await vectorStore.getStats();

    const endTime = new Date();
    const stats: SeedStats = {
      crawledPages: crawlResult.stats.successful_pages,
      processedDocuments: processedCount,
      embeddingsGenerated: vectorDocuments.length,
      failedDocuments: failedCount,
      startTime,
      endTime,
      durationMs: endTime.getTime() - startTime.getTime(),
    };

    return {
      success: true,
      message: 'Database seeding completed successfully',
      details: {
        seedStats: stats,
        crawlStats: crawlResult.stats,
        databaseStats: dbStats,
        documentsAdded: finalCount - existingCount,
      },
    };

  } catch (error) {
    console.error('❌ Seeding failed:', error);
    
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Unknown seeding error',
      details: { originalError: error },
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

/**
 * Clear database function
 */
async function clearDatabase(): Promise<SeedResult> {
  console.log('🗑️  Clearing PowerSchool RAG database...');
  console.log(`🔗 Database: ${config.DATABASE_URL.replace(/:[^:]*@/, ':****@')}`);
  console.log('');

  let vectorStore: PostgresVectorAdapter | undefined;

  try {
    vectorStore = new PostgresVectorAdapter();
    
    // Test connection
    const isHealthy = await vectorStore.health();
    if (!isHealthy) {
      throw new Error('Database health check failed');
    }

    const beforeCount = await vectorStore.count();
    console.log(`📊 Documents before clearing: ${beforeCount}`);

    if (beforeCount === 0) {
      return {
        success: true,
        message: 'Database is already empty',
        details: { documentsRemoved: 0 }
      };
    }

    console.log('⚠️  WARNING: This will delete all documents!');
    console.log('⚠️  Press Ctrl+C to cancel, or wait 5 seconds to continue...');
    await new Promise(resolve => setTimeout(resolve, 5000));

    await vectorStore.clear();
    
    const afterCount = await vectorStore.count();
    console.log(`✅ Database cleared successfully`);
    console.log(`📊 Documents after clearing: ${afterCount}`);

    return {
      success: true,
      message: 'Database cleared successfully',
      details: { documentsRemoved: beforeCount - afterCount }
    };

  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Failed to clear database',
      details: { originalError: error }
    };
  } finally {
    if (vectorStore) {
      try {
        await vectorStore.close();
      } catch (error) {
        console.error('Warning: Failed to close vector store connection:', error);
      }
    }
  }
}

/**
 * Show database statistics
 */
async function showStats(): Promise<SeedResult> {
  console.log('📊 PowerSchool RAG Database Statistics');
  console.log(`🔗 Database: ${config.DATABASE_URL.replace(/:[^:]*@/, ':****@')}`);
  console.log('');

  let vectorStore: PostgresVectorAdapter | undefined;

  try {
    vectorStore = new PostgresVectorAdapter();
    
    const isHealthy = await vectorStore.health();
    if (!isHealthy) {
      throw new Error('Database health check failed');
    }

    const stats = await vectorStore.getStats();
    
    console.log('📈 Document Statistics:');
    console.log(`   Total Documents: ${stats.totalDocuments}`);
    console.log(`   Unique URLs: ${stats.uniqueUrls}`);
    console.log(`   Average Content Length: ${stats.avgContentLength} characters`);
    console.log('');
    
    console.log('📝 Content Types:');
    Object.entries(stats.contentTypes).forEach(([type, count]) => {
      console.log(`   ${type}: ${count}`);
    });
    console.log('');
    
    console.log('🔧 Index Health:');
    console.log(`   Vector Index Size: ${stats.indexHealth.vectorIndexSize}`);
    if (stats.indexHealth.lastVacuum) {
      console.log(`   Last Vacuum: ${stats.indexHealth.lastVacuum}`);
    }

    return {
      success: true,
      message: 'Statistics retrieved successfully',
      details: { stats }
    };

  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Failed to get statistics',
      details: { originalError: error }
    };
  } finally {
    if (vectorStore) {
      try {
        await vectorStore.close();
      } catch (error) {
        console.error('Warning: Failed to close vector store connection:', error);
      }
    }
  }
}

/**
 * Collection configuration mapping using environment variables
 */
const COLLECTION_CONFIG = {
  'pssis-admin': {
    baseUrl: config.PSSIS_CRAWL_BASE_URL,
    collection: 'pssis-admin',
    maxPages: config.PSSIS_MAX_PAGES,
    delayMs: config.PSSIS_CRAWL_DELAY_MS,
  },
  'schoology': {
    baseUrl: config.SCHOOLOGY_CRAWL_BASE_URL,
    collection: 'schoology',
    maxPages: config.SCHOOLOGY_MAX_PAGES,
    delayMs: config.SCHOOLOGY_CRAWL_DELAY_MS,
  },
} as const;

type CollectionName = keyof typeof COLLECTION_CONFIG;

/**
 * Seed specific collection using crawlAndSeed
 */
async function seedCollection(collectionName: CollectionName): Promise<SeedResult> {
  const collectionConfig = COLLECTION_CONFIG[collectionName];
  const startTime = new Date();
  
  console.log(`🌱 Seeding collection: ${collectionName}`);
  console.log(`📊 Target: ${collectionConfig.baseUrl}`);
  console.log(`🔗 Database: ${config.DATABASE_URL.replace(/:[^:]*@/, ':****@')}`);
  console.log(`🤖 Embedding Provider: ${config.EMBEDDING_PROVIDER}`);
  console.log(`📝 Model: ${config.EMBEDDING_MODEL}`);
  console.log('');

  try {
    // Import crawlAndSeed from the seeding module
    const { crawlAndSeed } = await import('@/core/seeding/crawlAndSeed');
    
    const result = await crawlAndSeed({
      baseUrl: collectionConfig.baseUrl,
      collection: collectionConfig.collection,
      maxPages: collectionConfig.maxPages,
      delayMs: collectionConfig.delayMs,
      chunkSize: 4000,
    });

    const endTime = new Date();

    if (result.success) {
      return {
        success: true,
        message: `Successfully seeded ${collectionName} collection`,
        details: {
          collection: collectionName,
          pagesCrawled: result.pagesCrawled,
          chunksInserted: result.chunksInserted,
          duration_ms: result.duration_ms,
          startTime,
          endTime,
          ...(result.errors && { errors: result.errors }),
        },
      };
    } else {
      return {
        success: false,
        message: `Failed to seed ${collectionName} collection: ${result.message}`,
        details: {
          collection: collectionName,
          originalResult: result,
        },
      };
    }

  } catch (error) {
    return {
      success: false,
      message: `Unexpected error seeding ${collectionName}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      details: {
        collection: collectionName,
        originalError: error,
      },
    };
  }
}

/**
 * Main execution function
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0] || 'seed';
  const collectionArg = args[1];

  console.log(`🌱 PowerSchool RAG Database Seeder`);
  console.log(`📊 Command: ${command}`);
  if (collectionArg) {
    console.log(`📚 Collection: ${collectionArg}`);
  }
  console.log('');

  let result: SeedResult;

  switch (command) {
    case 'seed':
    case 'crawl':
      // Check if specific collection is requested
      if (collectionArg && collectionArg in COLLECTION_CONFIG) {
        result = await seedCollection(collectionArg as CollectionName);
      } else if (collectionArg) {
        console.error(`❌ Unknown collection: ${collectionArg}`);
        console.log('Available collections:');
        Object.keys(COLLECTION_CONFIG).forEach(name => {
          const config = COLLECTION_CONFIG[name as CollectionName];
          console.log(`  ${name} - ${config.baseUrl}`);
        });
        process.exit(1);
      } else {
        // Default to pssis-admin collection for backward compatibility
        result = await seedDatabase();
      }
      break;

    case 'clear':
    case 'clean':
      result = await clearDatabase();
      break;

    case 'stats':
    case 'status':
      result = await showStats();
      break;

    default:
      console.error(`❌ Unknown command: ${command}`);
      console.log('Available commands:');
      console.log('  seed, crawl  - Crawl documentation and seed database');
      console.log('  clear, clean - Clear all documents from database');
      console.log('  stats, status - Show database statistics');
      process.exit(1);
  }

  if (result.success) {
    console.log('');
    console.log(`✅ ${result.message}`);
    
    if (result.details) {
      console.log('📋 Details:');
      console.log(JSON.stringify(result.details, null, 2));
    }
    
    process.exit(0);
  } else {
    console.log('');
    console.error(`❌ ${result.message}`);
    
    if (result.details) {
      console.error('📋 Error details:');
      console.error(JSON.stringify(result.details, null, 2));
    }
    
    process.exit(1);
  }
}

// Execute if run directly
if (require.main === module) {
  main().catch(error => {
    console.error('💥 Unexpected error:', error);
    process.exit(1);
  });
}

export { seedDatabase, clearDatabase, showStats };