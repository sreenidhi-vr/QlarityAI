/**
 * Comprehensive Vector Dimension Diagnostics
 * Checks all potential sources of dimension mismatches
 */

const { Pool } = require('pg');
const { BedrockRuntimeClient, InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');
require('dotenv').config();

class VectorDimensionDiagnostics {
  constructor() {
    this.pool = new Pool({ connectionString: process.env.DATABASE_URL });
    this.issues = [];
    this.recommendations = [];
  }

  async runFullDiagnostics() {
    console.log('🔍 COMPREHENSIVE VECTOR DIMENSION DIAGNOSTICS\n');
    console.log('=' .repeat(60));

    try {
      // 1. Check environment configuration
      await this.checkEnvironmentConfig();
      
      // 2. Check database schema
      await this.checkDatabaseSchema();
      
      // 3. Check actual stored vectors
      await this.checkStoredVectors();
      
      // 4. Test current embedding model
      await this.testCurrentEmbeddingModel();
      
      // 5. Check configuration consistency
      await this.checkConfigurationConsistency();
      
      // 6. Test vector search compatibility
      await this.testVectorSearchCompatibility();
      
      // 7. Generate diagnosis summary
      this.generateDiagnosisSummary();
      
    } catch (error) {
      console.error('❌ Diagnostics failed:', error.message);
    } finally {
      await this.pool.end();
    }
  }

  async checkEnvironmentConfig() {
    console.log('\n1️⃣ ENVIRONMENT CONFIGURATION CHECK');
    console.log('-'.repeat(40));

    const embeddingProvider = process.env.EMBEDDING_PROVIDER || 'openai';
    const embeddingModel = process.env.EMBEDDING_MODEL || 'text-embedding-3-large';
    const llmProvider = process.env.LLM_PROVIDER || 'openai';
    
    console.log(`   Embedding Provider: ${embeddingProvider}`);
    console.log(`   Embedding Model: ${embeddingModel}`);
    console.log(`   LLM Provider: ${llmProvider}`);
    console.log(`   AWS Region: ${process.env.AWS_REGION || 'us-east-1'}`);
    
    // Check for provider/model mismatch
    if (embeddingProvider === 'bedrock' && embeddingModel.includes('text-embedding')) {
      this.issues.push({
        type: 'CONFIG_MISMATCH',
        severity: 'HIGH',
        message: 'EMBEDDING_PROVIDER is "bedrock" but EMBEDDING_MODEL is OpenAI format',
        fix: 'Set EMBEDDING_MODEL to amazon.titan-embed-text-v2:0 for Bedrock'
      });
    }
    
    if (embeddingProvider === 'openai' && embeddingModel.includes('amazon.titan')) {
      this.issues.push({
        type: 'CONFIG_MISMATCH',
        severity: 'HIGH',
        message: 'EMBEDDING_PROVIDER is "openai" but EMBEDDING_MODEL is Bedrock format',
        fix: 'Set EMBEDDING_PROVIDER to "bedrock" for Titan models'
      });
    }

    // Validate AWS credentials if using Bedrock
    if (embeddingProvider === 'bedrock' || llmProvider === 'bedrock') {
      const hasCredentials = process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY;
      console.log(`   AWS Credentials: ${hasCredentials ? '✅ Present' : '❌ Missing'}`);
      
      if (!hasCredentials) {
        this.issues.push({
          type: 'MISSING_CREDENTIALS',
          severity: 'HIGH',
          message: 'AWS credentials missing but Bedrock provider selected',
          fix: 'Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY in .env'
        });
      }
    }
  }

  async checkDatabaseSchema() {
    console.log('\n2️⃣ DATABASE SCHEMA CHECK');
    console.log('-'.repeat(40));

    try {
      // Check vector extension
      const vectorExt = await this.pool.query(
        "SELECT 1 FROM pg_extension WHERE extname = 'vector'"
      );
      console.log(`   Vector Extension: ${vectorExt.rows.length > 0 ? '✅ Installed' : '❌ Missing'}`);

      // Check table schema
      const tableInfo = await this.pool.query(`
        SELECT 
          column_name,
          data_type,
          character_maximum_length,
          is_nullable
        FROM information_schema.columns 
        WHERE table_name = 'documents' AND column_name = 'embedding'
      `);

      if (tableInfo.rows.length === 0) {
        this.issues.push({
          type: 'SCHEMA_MISSING',
          severity: 'CRITICAL',
          message: 'Documents table or embedding column not found',
          fix: 'Run database migration: npm run migrate'
        });
        return;
      }

      const embeddingCol = tableInfo.rows[0];
      console.log(`   Embedding Column Type: ${embeddingCol.data_type}`);

      // Check vector dimension constraint
      const vectorDimQuery = await this.pool.query(`
        SELECT 
          pg_get_constraintdef(c.oid) as constraint_def
        FROM pg_constraint c
        JOIN pg_class t ON c.conrelid = t.oid
        WHERE t.relname = 'documents' 
        AND c.conname LIKE '%embedding%'
      `);

      console.log(`   Vector Constraints: ${vectorDimQuery.rows.length} found`);
      
      // Try to extract dimension from constraint or type info
      try {
        const dimensionCheck = await this.pool.query(`
          SELECT atttypmod 
          FROM pg_attribute 
          WHERE attrelid = 'documents'::regclass 
          AND attname = 'embedding'
        `);
        
        if (dimensionCheck.rows[0]?.atttypmod) {
          const schemaDimensions = dimensionCheck.rows[0].atttypmod;
          console.log(`   Schema Vector Dimensions: ${schemaDimensions}`);
        }
      } catch (e) {
        console.log('   Schema Vector Dimensions: Could not determine');
      }

    } catch (error) {
      this.issues.push({
        type: 'SCHEMA_ERROR',
        severity: 'HIGH',
        message: `Database schema check failed: ${error.message}`,
        fix: 'Check database connection and permissions'
      });
    }
  }

  async checkStoredVectors() {
    console.log('\n3️⃣ STORED VECTORS ANALYSIS');
    console.log('-'.repeat(40));

    try {
      // Get vector statistics
      const vectorStats = await this.pool.query(`
        SELECT 
          COUNT(*) as total_docs,
          COUNT(embedding) as docs_with_embeddings,
          MIN(array_length(embedding::float4[], 1)) as min_dimensions,
          MAX(array_length(embedding::float4[], 1)) as max_dimensions,
          AVG(array_length(embedding::float4[], 1))::INTEGER as avg_dimensions,
          COUNT(DISTINCT array_length(embedding::float4[], 1)) as unique_dimensions
        FROM documents 
        WHERE embedding IS NOT NULL
      `);

      if (vectorStats.rows.length === 0 || vectorStats.rows[0].total_docs === '0') {
        console.log('   📊 No documents with embeddings found');
        this.issues.push({
          type: 'NO_VECTORS',
          severity: 'MEDIUM',
          message: 'No documents with embeddings in database',
          fix: 'Run seeding process: npm run seed'
        });
        return;
      }

      const stats = vectorStats.rows[0];
      console.log(`   📊 Total Documents: ${stats.total_docs}`);
      console.log(`   📊 Documents with Embeddings: ${stats.docs_with_embeddings}`);
      console.log(`   📊 Vector Dimensions Range: ${stats.min_dimensions} - ${stats.max_dimensions}`);
      console.log(`   📊 Average Dimensions: ${stats.avg_dimensions}`);
      console.log(`   📊 Unique Dimension Counts: ${stats.unique_dimensions}`);

      // Check for dimension inconsistency
      if (parseInt(stats.unique_dimensions) > 1) {
        this.issues.push({
          type: 'DIMENSION_INCONSISTENCY',
          severity: 'HIGH',
          message: `Multiple vector dimensions found in database (${stats.min_dimensions}-${stats.max_dimensions})`,
          fix: 'Clear and re-seed database with consistent embedding model'
        });

        // Get sample of different dimensions
        const dimensionBreakdown = await this.pool.query(`
          SELECT 
            array_length(embedding::float4[], 1) as dimensions,
            COUNT(*) as count,
            MIN(created_at) as earliest,
            MAX(created_at) as latest
          FROM documents 
          WHERE embedding IS NOT NULL
          GROUP BY array_length(embedding::float4[], 1)
          ORDER BY count DESC
        `);

        console.log('\n   📈 Dimension Breakdown:');
        dimensionBreakdown.rows.forEach(row => {
          console.log(`      ${row.dimensions}D: ${row.count} docs (${row.earliest.toISOString().split('T')[0]} to ${row.latest.toISOString().split('T')[0]})`);
        });
      }

    } catch (error) {
      this.issues.push({
        type: 'VECTOR_ANALYSIS_ERROR',
        severity: 'HIGH',
        message: `Vector analysis failed: ${error.message}`,
        fix: 'Check database connection and vector extension'
      });
    }
  }

  async testCurrentEmbeddingModel() {
    console.log('\n4️⃣ CURRENT EMBEDDING MODEL TEST');
    console.log('-'.repeat(40));

    const embeddingProvider = process.env.EMBEDDING_PROVIDER || 'openai';
    const embeddingModel = process.env.EMBEDDING_MODEL || 'text-embedding-3-large';

    console.log(`   Testing: ${embeddingProvider} / ${embeddingModel}`);

    if (embeddingProvider === 'bedrock') {
      await this.testBedrockEmbedding(embeddingModel);
    } else if (embeddingProvider === 'openai') {
      await this.testOpenAIEmbedding(embeddingModel);
    } else {
      console.log(`   ⚠️ Provider ${embeddingProvider} not supported in diagnostics`);
    }
  }

  async testBedrockEmbedding(model = 'amazon.titan-embed-text-v2:0') {
    try {
      const client = new BedrockRuntimeClient({
        region: process.env.AWS_REGION || 'us-east-1',
        credentials: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
          ...(process.env.AWS_SESSION_TOKEN && { sessionToken: process.env.AWS_SESSION_TOKEN }),
        },
      });

      const input = {
        modelId: model,
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
          const actualDimensions = responseJson.embedding.length;
          console.log(`   ✅ Model Response: ${actualDimensions} dimensions`);
          
          // Expected dimensions for known models
          const expectedDimensions = {
            'amazon.titan-embed-text-v1': 1536,
            'amazon.titan-embed-text-v2:0': 1024,
            'cohere.embed-english-v3': 1024,
            'cohere.embed-multilingual-v3': 1024,
          };

          const expected = expectedDimensions[model];
          if (expected && expected !== actualDimensions) {
            this.issues.push({
              type: 'MODEL_DIMENSION_MISMATCH',
              severity: 'HIGH',
              message: `${model} returned ${actualDimensions} dimensions, expected ${expected}`,
              fix: 'Check model configuration or switch to correct model'
            });
          }

          return actualDimensions;
        }
      }
    } catch (error) {
      console.log(`   ❌ Bedrock test failed: ${error.message}`);
      this.issues.push({
        type: 'EMBEDDING_TEST_FAILED',
        severity: 'HIGH',
        message: `Bedrock embedding test failed: ${error.message}`,
        fix: 'Check AWS credentials and model availability'
      });
    }
    return null;
  }

  async testOpenAIEmbedding(model) {
    console.log(`   ⚠️ OpenAI embedding test not implemented in diagnostics`);
    console.log(`   ℹ️ Expected dimensions for ${model}:`);
    
    const openaiDimensions = {
      'text-embedding-3-small': 1536,
      'text-embedding-3-large': 3072,
      'text-embedding-ada-002': 1536,
    };
    
    const expected = openaiDimensions[model] || 'Unknown';
    console.log(`      ${expected} dimensions`);
    
    return expected;
  }

  async checkConfigurationConsistency() {
    console.log('\n5️⃣ CONFIGURATION CONSISTENCY CHECK');
    console.log('-'.repeat(40));

    // Check if config.ts defaults match environment
    const configDefaults = {
      EMBEDDING_PROVIDER: 'openai',
      EMBEDDING_MODEL: 'text-embedding-3-large',
      LLM_PROVIDER: 'openai',
      AWS_REGION: 'us-east-1'
    };

    console.log('   Config Defaults vs Environment:');
    Object.entries(configDefaults).forEach(([key, defaultValue]) => {
      const envValue = process.env[key] || defaultValue;
      const matches = envValue === defaultValue;
      console.log(`      ${key}: ${matches ? '✅' : '⚠️'} ${envValue} ${!matches ? `(default: ${defaultValue})` : ''}`);
      
      if (!matches && key === 'EMBEDDING_PROVIDER') {
        this.issues.push({
          type: 'PROVIDER_OVERRIDE',
          severity: 'MEDIUM',
          message: `EMBEDDING_PROVIDER overridden from default "${defaultValue}" to "${envValue}"`,
          fix: 'Ensure all related configurations are updated for the new provider'
        });
      }
    });
  }

  async testVectorSearchCompatibility() {
    console.log('\n6️⃣ VECTOR SEARCH COMPATIBILITY TEST');
    console.log('-'.repeat(40));

    try {
      // Test if we can create a sample vector and search
      const testVector = Array(1024).fill(0).map(() => Math.random());
      const testVectorStr = JSON.stringify(testVector);

      const searchTest = await this.pool.query(`
        SELECT 
          id, 
          title,
          (1 - (embedding <=> $1::vector)) as similarity_score
        FROM documents
        WHERE embedding IS NOT NULL
        ORDER BY embedding <=> $1::vector
        LIMIT 3
      `, [testVectorStr]);

      console.log(`   ✅ Vector search test: Found ${searchTest.rows.length} results`);
      
      if (searchTest.rows.length > 0) {
        const avgScore = searchTest.rows.reduce((sum, row) => sum + parseFloat(row.similarity_score), 0) / searchTest.rows.length;
        console.log(`   📊 Average similarity score: ${avgScore.toFixed(4)}`);
      }

    } catch (error) {
      console.log(`   ❌ Vector search test failed: ${error.message}`);
      this.issues.push({
        type: 'VECTOR_SEARCH_FAILED',
        severity: 'HIGH',
        message: `Vector search compatibility test failed: ${error.message}`,
        fix: 'Check vector dimensions and database schema consistency'
      });
    }
  }

  generateDiagnosisSummary() {
    console.log('\n7️⃣ DIAGNOSIS SUMMARY');
    console.log('='.repeat(60));

    if (this.issues.length === 0) {
      console.log('✅ NO ISSUES FOUND');
      console.log('   Vector dimensions appear to be consistent across your system.');
      return;
    }

    // Group issues by severity
    const critical = this.issues.filter(i => i.severity === 'CRITICAL');
    const high = this.issues.filter(i => i.severity === 'HIGH');
    const medium = this.issues.filter(i => i.severity === 'MEDIUM');

    console.log(`❌ FOUND ${this.issues.length} ISSUES:`);
    
    if (critical.length > 0) {
      console.log(`\n🚨 CRITICAL ISSUES (${critical.length}):`);
      critical.forEach((issue, i) => {
        console.log(`   ${i + 1}. ${issue.message}`);
        console.log(`      Fix: ${issue.fix}`);
      });
    }

    if (high.length > 0) {
      console.log(`\n⚠️ HIGH PRIORITY ISSUES (${high.length}):`);
      high.forEach((issue, i) => {
        console.log(`   ${i + 1}. ${issue.message}`);
        console.log(`      Fix: ${issue.fix}`);
      });
    }

    if (medium.length > 0) {
      console.log(`\n📋 MEDIUM PRIORITY ISSUES (${medium.length}):`);
      medium.forEach((issue, i) => {
        console.log(`   ${i + 1}. ${issue.message}`);
        console.log(`      Fix: ${issue.fix}`);
      });
    }

    // Primary recommendations
    console.log('\n🔧 PRIMARY RECOMMENDATIONS:');
    
    const hasConfigMismatch = this.issues.some(i => i.type === 'CONFIG_MISMATCH');
    const hasDimensionIssues = this.issues.some(i => i.type === 'DIMENSION_INCONSISTENCY');
    const hasNoVectors = this.issues.some(i => i.type === 'NO_VECTORS');

    if (hasConfigMismatch) {
      console.log('   1. Fix provider/model configuration mismatches in .env');
    }
    
    if (hasDimensionIssues) {
      console.log('   2. Clear database and re-seed with consistent embedding model');
      console.log('      Commands: npm run seed clear && npm run seed');
    }
    
    if (hasNoVectors) {
      console.log('   3. Run initial seeding process to populate embeddings');
      console.log('      Command: npm run seed');
    }

    console.log('\n📞 NEXT STEPS:');
    console.log('   Please review the issues above and confirm which fix to apply.');
    console.log('   The most likely cause is a provider/model configuration mismatch.');
  }
}

// Run diagnostics
if (require.main === module) {
  const diagnostics = new VectorDimensionDiagnostics();
  diagnostics.runFullDiagnostics().catch(console.error);
}

module.exports = { VectorDimensionDiagnostics };