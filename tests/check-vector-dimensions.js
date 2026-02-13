/**
 * Check actual vector dimensions in database vs current embedding model
 */

const { Pool } = require('pg');
const { BedrockRuntimeClient, InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');
require('dotenv').config();

async function checkVectorDimensions() {
  console.log('🔍 Checking Vector Dimensions...\n');

  const connectionString = process.env.DATABASE_URL;
  const tableName = process.env.VECTOR_TABLE_NAME || 'documents';

  if (!connectionString) {
    console.log('❌ DATABASE_URL not found');
    return;
  }

  const pool = new Pool({ connectionString });

  try {
    // 1. Check what dimensions are actually stored in database
    console.log('1️⃣ Checking database vector dimensions...');
    
    const result = await pool.query(`
      SELECT 
        id, 
        title,
        LENGTH(embedding::text) as embedding_text_length,
        array_length(embedding::float4[], 1) as vector_dimensions
      FROM ${tableName} 
      WHERE embedding IS NOT NULL 
      LIMIT 5
    `);

    if (result.rows.length === 0) {
      console.log('❌ No documents with embeddings found');
      return;
    }

    console.log('📊 Database vectors:');
    result.rows.forEach((row, index) => {
      console.log(`   ${index + 1}. ${row.title}`);
      console.log(`      Vector dimensions: ${row.vector_dimensions}`);
      console.log(`      Embedding text length: ${row.embedding_text_length}`);
    });

    const dbDimensions = result.rows[0].vector_dimensions;
    console.log(`\n📏 Database vector dimensions: ${dbDimensions}`);

    // 2. Check what dimensions current embedding model produces
    console.log('\n2️⃣ Testing current embedding model dimensions...');
    
    const client = new BedrockRuntimeClient({
      region: process.env.AWS_REGION,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        ...(process.env.AWS_SESSION_TOKEN && { sessionToken: process.env.AWS_SESSION_TOKEN }),
      },
    });

    const input = {
      modelId: 'amazon.titan-embed-text-v2:0',
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        inputText: 'Test embedding dimension check'
      }),
    };

    const command = new InvokeModelCommand(input);
    const response = await client.send(command);
    
    if (response.body) {
      const responseText = new TextDecoder().decode(response.body);
      const responseJson = JSON.parse(responseText);
      
      if (responseJson.embedding && Array.isArray(responseJson.embedding)) {
        const currentDimensions = responseJson.embedding.length;
        console.log(`📏 Current model dimensions: ${currentDimensions}`);
        
        // 3. Compare dimensions
        console.log('\n3️⃣ Dimension comparison:');
        if (dbDimensions === currentDimensions) {
          console.log(`✅ MATCH: Database (${dbDimensions}) = Current model (${currentDimensions})`);
          console.log('   Vector search should work correctly');
        } else {
          console.log(`❌ MISMATCH: Database (${dbDimensions}) ≠ Current model (${currentDimensions})`);
          console.log('   This explains why vector search fails!');
          
          console.log('\n🔧 SOLUTIONS:');
          if (currentDimensions === 1024) {
            console.log('   Option 1: Re-seed database with 1024-dimensional embeddings');
            console.log('   Command: npm run seed clear && npm run seed');
          }
          if (dbDimensions === 1536) {
            console.log('   Option 2: Switch to 1536-dimensional model');
            console.log('   Update .env: EMBEDDING_MODEL=amazon.titan-embed-text-v1');
          }
        }

        // 4. Test vector search compatibility
        console.log('\n4️⃣ Testing vector search with current dimensions...');
        
        try {
          const testEmbedding = responseJson.embedding;
          const embeddingStr = JSON.stringify(testEmbedding);
          
          const searchResult = await pool.query(
            `SELECT id, title, (1 - (embedding <=> $1::vector)) as similarity_score
             FROM ${tableName}
             WHERE embedding IS NOT NULL
             ORDER BY embedding <=> $1::vector
             LIMIT 3`,
            [embeddingStr]
          );

          console.log(`✅ Vector search successful! Found ${searchResult.rows.length} results:`);
          searchResult.rows.forEach(row => {
            console.log(`   - ${row.title}: similarity ${row.similarity_score.toFixed(4)}`);
          });

        } catch (searchError) {
          console.log(`❌ Vector search failed: ${searchError.message}`);
          if (searchError.message.includes('different vector dimensions')) {
            console.log('   Confirmed: Dimension mismatch is the issue');
          }
        }

      } else {
        console.log('❌ Invalid embedding response');
      }
    }

  } catch (error) {
    console.log(`❌ Error: ${error.message}`);
  } finally {
    await pool.end();
  }
}

// Run check
if (require.main === module) {
  checkVectorDimensions().catch(console.error);
}

module.exports = { checkVectorDimensions };