/**
 * Test script to check vector database contents and AWS authentication
 */

const { Pool } = require('pg');
require('dotenv').config();

async function checkDatabase() {
  console.log('🔍 Checking Vector Database Contents...\n');

  const connectionString = process.env.DATABASE_URL;
  const tableName = process.env.VECTOR_TABLE_NAME || 'documents';

  if (!connectionString) {
    console.log('❌ DATABASE_URL not found in environment variables');
    return;
  }

  console.log(`🔗 Database: ${connectionString.replace(/:[^:@]*@/, ':***@')}`);
  console.log(`📋 Table: ${tableName}\n`);

  const pool = new Pool({ connectionString });

  try {
    // Test basic connection
    console.log('1️⃣ Testing database connection...');
    await pool.query('SELECT 1');
    console.log('✅ Database connection successful\n');

    // Check if table exists
    console.log('2️⃣ Checking if table exists...');
    const tableCheck = await pool.query(
      'SELECT 1 FROM information_schema.tables WHERE table_name = $1',
      [tableName]
    );
    
    if (tableCheck.rows.length === 0) {
      console.log(`❌ Table '${tableName}' does not exist`);
      console.log('   Run database migration: npm run migrate');
      return;
    }
    console.log(`✅ Table '${tableName}' exists\n`);

    // Check pgvector extension
    console.log('3️⃣ Checking pgvector extension...');
    const extensionCheck = await pool.query('SELECT 1 FROM pg_extension WHERE extname = \'vector\'');
    if (extensionCheck.rows.length === 0) {
      console.log('❌ pgvector extension not installed');
      return;
    }
    console.log('✅ pgvector extension installed\n');

    // Get document count
    console.log('4️⃣ Checking document count...');
    const countResult = await pool.query(`SELECT COUNT(*) as count FROM ${tableName}`);
    const totalDocs = parseInt(countResult.rows[0].count, 10);
    console.log(`📊 Total documents: ${totalDocs}`);

    if (totalDocs === 0) {
      console.log('⚠️  Database is empty! This explains why fallback is triggered.');
      console.log('   To fix: Run the crawler to populate data');
      return;
    }

    // Get documents with embeddings count
    console.log('5️⃣ Checking documents with embeddings...');
    const embeddingCountResult = await pool.query(
      `SELECT COUNT(*) as count FROM ${tableName} WHERE embedding IS NOT NULL`
    );
    const embeddingDocs = parseInt(embeddingCountResult.rows[0].count, 10);
    console.log(`🎯 Documents with embeddings: ${embeddingDocs}`);

    if (embeddingDocs === 0) {
      console.log('⚠️  No documents have embeddings! This explains why fallback is triggered.');
      console.log('   Documents exist but embeddings are missing.');
    }

    // Sample documents
    console.log('6️⃣ Sample documents:');
    const sampleResult = await pool.query(
      `SELECT id, title, url, content_type, 
              CASE WHEN embedding IS NOT NULL THEN 'YES' ELSE 'NO' END as has_embedding,
              LENGTH(content) as content_length
       FROM ${tableName} 
       LIMIT 5`
    );

    if (sampleResult.rows.length > 0) {
      console.table(sampleResult.rows);
    } else {
      console.log('   No documents found');
    }

    // Test vector search with a simple query
    if (embeddingDocs > 0) {
      console.log('7️⃣ Testing vector search with dummy embedding...');
      // Use 1024 dimensions to match current embedding model
      const dummyEmbedding = Array.from({ length: 1024 }, () => Math.random() * 2 - 1);
      const embeddingStr = JSON.stringify(dummyEmbedding);
      
      const searchResult = await pool.query(
        `SELECT id, title, (1 - (embedding <=> $1::vector)) as similarity_score
         FROM ${tableName}
         WHERE embedding IS NOT NULL
         ORDER BY embedding <=> $1::vector
         LIMIT 3`,
        [embeddingStr]
      );

      console.log(`🔍 Vector search returned ${searchResult.rows.length} results:`);
      searchResult.rows.forEach(row => {
        console.log(`   - ${row.title}: similarity ${row.similarity_score.toFixed(4)}`);
      });
    }

  } catch (error) {
    console.log('❌ Database error:', error.message);
    if (error.code) {
      console.log(`   Error code: ${error.code}`);
    }
  } finally {
    await pool.end();
  }
}

async function checkAWSAuth() {
  console.log('\n🔐 Checking AWS Authentication...\n');

  const requiredVars = [
    'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY', 
    'AWS_REGION'
  ];

  let allVarsPresent = true;

  requiredVars.forEach(varName => {
    const value = process.env[varName];
    if (value) {
      console.log(`✅ ${varName}: ${'*'.repeat(Math.min(value.length, 20))}`);
    } else {
      console.log(`❌ ${varName}: Not set`);
      allVarsPresent = false;
    }
  });

  if (process.env.AWS_SESSION_TOKEN) {
    console.log(`✅ AWS_SESSION_TOKEN: ${'*'.repeat(20)} (temporary credentials)`);
  }

  if (!allVarsPresent) {
    console.log('\n⚠️  Missing AWS credentials will cause embedding failures');
    console.log('   This forces the system to use mock embeddings');
    console.log('   Mock embeddings are random and won\'t match any real documents');
  }

  // Check embedding provider config
  console.log(`\n📝 Embedding Provider: ${process.env.EMBEDDING_PROVIDER || 'not set'}`);
  console.log(`📝 Embedding Model: ${process.env.EMBEDDING_MODEL || 'not set'}`);
}

async function runDatabaseDiagnostics() {
  console.log('🚀 Database Diagnostics Starting...\n');
  
  await checkDatabase();
  await checkAWSAuth();

  console.log('\n🎯 Summary:');
  console.log('1. If database is empty → Run crawler to populate data');
  console.log('2. If embeddings are missing → Re-run embedding generation');
  console.log('3. If AWS auth fails → Fix AWS credentials');
  console.log('4. Mock embeddings + any data = no matches = fallback triggered');
}

// Run diagnostics if this file is executed directly
if (require.main === module) {
  runDatabaseDiagnostics().catch(console.error);
}

module.exports = { runDatabaseDiagnostics, checkDatabase, checkAWSAuth };