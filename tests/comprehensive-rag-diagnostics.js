/**
 * Comprehensive RAG API Diagnostics Script
 * Analyzes why queries return fallback responses with empty retrieval results
 */

const { Pool } = require('pg');
const config = require('./src/utils/config').default;

async function runDiagnostics() {
  console.log('🔍 RAG API Comprehensive Diagnostics');
  console.log('=====================================');
  console.log('');

  const results = {
    database: {},
    embeddings: {},
    vectorStore: {},
    queryAnalysis: {},
    recommendations: []
  };

  let pool;

  try {
    // 1. Database Connection Test
    console.log('📊 1. Testing Database Connection...');
    pool = new Pool({ connectionString: config.DATABASE_URL });
    
    try {
      await pool.query('SELECT 1');
      console.log('✅ Database connection successful');
      results.database.connected = true;
    } catch (error) {
      console.error('❌ Database connection failed:', error.message);
      results.database.connected = false;
      results.database.error = error.message;
      results.recommendations.push('Fix database connection - check DATABASE_URL in .env file');
      return results;
    }

    // 2. Check pgvector Extension
    console.log('\n📊 2. Checking pgvector Extension...');
    try {
      const extensionCheck = await pool.query(
        "SELECT 1 FROM pg_extension WHERE extname = 'vector'"
      );
      if (extensionCheck.rows.length > 0) {
        console.log('✅ pgvector extension is installed');
        results.database.pgvector = true;
      } else {
        console.log('❌ pgvector extension not installed');
        results.database.pgvector = false;
        results.recommendations.push('Install pgvector extension: CREATE EXTENSION vector;');
      }
    } catch (error) {
      console.error('❌ Failed to check pgvector extension:', error.message);
      results.database.pgvector = false;
      results.recommendations.push('Check database permissions and pgvector installation');
    }

    // 3. Check Documents Table
    console.log('\n📊 3. Checking Documents Table...');
    try {
      const tableCheck = await pool.query(`
        SELECT column_name, data_type, is_nullable 
        FROM information_schema.columns 
        WHERE table_name = 'documents' 
        ORDER BY ordinal_position
      `);
      
      if (tableCheck.rows.length > 0) {
        console.log('✅ Documents table exists');
        console.log('   Columns found:', tableCheck.rows.map(r => `${r.column_name}(${r.data_type})`).join(', '));
        results.database.tableExists = true;
        
        // Check for embedding column specifically
        const embeddingCol = tableCheck.rows.find(r => r.column_name === 'embedding');
        if (embeddingCol) {
          console.log('✅ Embedding column exists:', embeddingCol.data_type);
          results.database.embeddingColumn = true;
        } else {
          console.log('❌ Embedding column not found');
          results.database.embeddingColumn = false;
          results.recommendations.push('Run database migration to create embedding column');
        }
      } else {
        console.log('❌ Documents table not found');
        results.database.tableExists = false;
        results.recommendations.push('Run database migration: npm run migrate');
      }
    } catch (error) {
      console.error('❌ Failed to check documents table:', error.message);
      results.database.tableExists = false;
    }

    // 4. Check Document Count
    console.log('\n📊 4. Checking Document Count...');
    try {
      const countResult = await pool.query('SELECT COUNT(*) as count FROM documents');
      const count = parseInt(countResult.rows[0].count);
      console.log(`📄 Total documents: ${count}`);
      results.vectorStore.totalDocs = count;
      
      if (count === 0) {
        console.log('❌ No documents found - database needs seeding');
        results.recommendations.push('Seed the database: npm run seed');
      } else {
        // Check for documents with embeddings
        const embeddedCount = await pool.query('SELECT COUNT(*) as count FROM documents WHERE embedding IS NOT NULL');
        const embeddedTotal = parseInt(embeddedCount.rows[0].count);
        console.log(`🔢 Documents with embeddings: ${embeddedTotal}`);
        results.vectorStore.embeddedDocs = embeddedTotal;
        
        if (embeddedTotal === 0) {
          console.log('❌ No documents have embeddings');
          results.recommendations.push('Re-seed database with embeddings: npm run seed');
        } else if (embeddedTotal < count) {
          console.log('⚠️  Some documents missing embeddings');
          results.recommendations.push('Some documents missing embeddings - consider re-seeding');
        }
      }
    } catch (error) {
      console.error('❌ Failed to check document count:', error.message);
      results.vectorStore.totalDocs = 0;
    }

    // 5. Sample Documents Analysis
    if (results.vectorStore.embeddedDocs > 0) {
      console.log('\n📊 5. Analyzing Sample Documents...');
      try {
        const sampleDocs = await pool.query(`
          SELECT title, content_type, section, 
                 LENGTH(content) as content_length,
                 array_length(embedding::float[], 1) as embedding_dims
          FROM documents 
          WHERE embedding IS NOT NULL 
          LIMIT 5
        `);
        
        console.log('📋 Sample documents:');
        sampleDocs.rows.forEach((doc, i) => {
          console.log(`   ${i + 1}. "${doc.title}" (${doc.content_type})`);
          console.log(`      Section: ${doc.section || 'N/A'}`);
          console.log(`      Content length: ${doc.content_length} chars`);
          console.log(`      Embedding dimensions: ${doc.embedding_dims || 'N/A'}`);
        });

        // Check embedding dimensions consistency
        const dimensionCheck = await pool.query(`
          SELECT array_length(embedding::float[], 1) as dims, COUNT(*) as count
          FROM documents 
          WHERE embedding IS NOT NULL 
          GROUP BY array_length(embedding::float[], 1)
        `);
        
        console.log('\n🔢 Embedding dimensions distribution:');
        dimensionCheck.rows.forEach(row => {
          console.log(`   ${row.dims} dimensions: ${row.count} documents`);
        });
        
        results.vectorStore.embeddingDimensions = dimensionCheck.rows;
        
        // Check if dimensions match expected (1024 for Titan v2)
        const expectedDims = 1024;
        const correctDims = dimensionCheck.rows.find(r => r.dims == expectedDims);
        if (!correctDims) {
          console.log(`⚠️  No documents found with expected ${expectedDims} dimensions`);
          results.recommendations.push(`Embedding dimension mismatch - expected ${expectedDims}, check embedding model configuration`);
        }

      } catch (error) {
        console.error('❌ Failed to analyze sample documents:', error.message);
      }
    }

    // 6. Query Analysis for "Enroll a New Student"
    if (results.vectorStore.embeddedDocs > 0) {
      console.log('\n📊 6. Testing Query: "Enroll a New Student"...');
      try {
        // Search for relevant terms in content
        const contentSearch = await pool.query(`
          SELECT title, section, subsection, 
                 LENGTH(content) as content_length,
                 content_type,
                 ts_rank(search_vector, plainto_tsquery('english', $1)) as text_rank
          FROM documents 
          WHERE search_vector @@ plainto_tsquery('english', $1)
             OR LOWER(content) LIKE LOWER($2)
             OR LOWER(title) LIKE LOWER($2)
          ORDER BY text_rank DESC, LENGTH(content) DESC
          LIMIT 10
        `, ['enroll new student', '%enroll%student%']);
        
        if (contentSearch.rows.length > 0) {
          console.log('✅ Found documents matching "enroll student":');
          contentSearch.rows.forEach((doc, i) => {
            console.log(`   ${i + 1}. "${doc.title}"`);
            console.log(`      Section: ${doc.section || 'N/A'} > ${doc.subsection || 'N/A'}`);
            console.log(`      Type: ${doc.content_type}, Text rank: ${doc.text_rank}`);
          });
          results.queryAnalysis.foundMatching = true;
          results.queryAnalysis.matchingDocs = contentSearch.rows.length;
        } else {
          console.log('❌ No documents found containing "enroll" or "student"');
          results.queryAnalysis.foundMatching = false;
          
          // Check what topics ARE available
          const topicSample = await pool.query(`
            SELECT DISTINCT section, COUNT(*) as doc_count
            FROM documents 
            WHERE section IS NOT NULL
            GROUP BY section
            ORDER BY doc_count DESC
            LIMIT 10
          `);
          
          console.log('\n📚 Available sections in documentation:');
          topicSample.rows.forEach(row => {
            console.log(`   - ${row.section}: ${row.doc_count} documents`);
          });
          
          results.recommendations.push('The query "Enroll a New Student" may not exist in the crawled documentation - check if the right pages were crawled');
        }

      } catch (error) {
        console.error('❌ Failed to test query:', error.message);
      }
    }

    // 7. Configuration Analysis
    console.log('\n📊 7. Checking Configuration...');
    console.log(`🔧 Embedding Provider: ${config.EMBEDDING_PROVIDER}`);
    console.log(`🤖 Embedding Model: ${config.EMBEDDING_MODEL}`);
    console.log(`🔗 Crawl Base URL: ${config.CRAWL_BASE_URL}`);
    console.log(`📊 Max Pages: ${config.MAX_PAGES}`);
    console.log(`🎯 Vector Table: ${config.VECTOR_TABLE_NAME}`);
    
    results.configuration = {
      embeddingProvider: config.EMBEDDING_PROVIDER,
      embeddingModel: config.EMBEDDING_MODEL,
      crawlBaseUrl: config.CRAWL_BASE_URL,
      maxPages: config.MAX_PAGES,
      vectorTable: config.VECTOR_TABLE_NAME
    };

    // AWS Bedrock specific checks
    if (config.EMBEDDING_PROVIDER === 'bedrock') {
      console.log('\n🔧 AWS Bedrock Configuration:');
      console.log(`   Region: ${config.AWS_REGION}`);
      console.log(`   Access Key ID: ${config.AWS_ACCESS_KEY_ID ? 'Set' : 'Not set'}`);
      console.log(`   Secret Key: ${config.AWS_SECRET_ACCESS_KEY ? 'Set' : 'Not set'}`);
      
      if (!config.AWS_ACCESS_KEY_ID || !config.AWS_SECRET_ACCESS_KEY) {
        results.recommendations.push('AWS credentials not configured - set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY in .env');
      }
    }

  } catch (error) {
    console.error('💥 Diagnostic failed:', error);
    results.error = error.message;
  } finally {
    if (pool) {
      await pool.end();
    }
  }

  // 8. Generate Final Recommendations
  console.log('\n🎯 DIAGNOSIS SUMMARY');
  console.log('==================');
  
  if (results.recommendations.length === 0) {
    console.log('✅ No major issues found - investigate similarity thresholds and query preprocessing');
    results.recommendations.push('Lower similarity threshold in RAG pipeline (try 0.3 instead of 0.7)');
    results.recommendations.push('Add query expansion/synonym matching');
    results.recommendations.push('Check embedding quality with test queries');
  } else {
    console.log('❌ Issues found that need to be fixed:');
    results.recommendations.forEach((rec, i) => {
      console.log(`   ${i + 1}. ${rec}`);
    });
  }

  console.log('\n📋 Quick Fix Commands:');
  console.log('  npm run migrate    # Create database schema');
  console.log('  npm run seed       # Crawl and embed documents');
  console.log('  npm run seed stats # Check database status');

  return results;
}

// Execute diagnostics
runDiagnostics()
  .then(results => {
    console.log('\n✅ Diagnostics completed');
    process.exit(0);
  })
  .catch(error => {
    console.error('💥 Diagnostics failed:', error);
    process.exit(1);
  });