/**
 * Safe database migration script that handles existing structures gracefully
 */

import { Pool } from 'pg';
import config from '@/utils/config';

interface MigrationResult {
  success: boolean;
  message: string;
  details?: Record<string, unknown>;
}

/**
 * Execute SQL with better error context
 */
async function executeSqlSafely(client: any, sql: string, description: string): Promise<void> {
  try {
    console.log(`🔄 ${description}...`);
    await client.query(sql);
    console.log(`✅ ${description} completed`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ ${description} failed:`, errorMessage);
    throw new Error(`${description} failed: ${errorMessage}`);
  }
}

/**
 * Run safe migrations step by step
 */
async function runSafeMigrations(): Promise<MigrationResult> {
  const pool = new Pool({
    connectionString: config.DATABASE_URL,
    max: 5,
    connectionTimeoutMillis: 10000,
  });

  try {
    const client = await pool.connect();

    try {
      console.log('🔍 Checking database connection...');
      
      // Test basic connection
      await client.query('SELECT NOW()');
      console.log('✅ Database connection successful');

      // Check PostgreSQL version
      const versionResult = await client.query('SELECT version()');
      const version = versionResult.rows[0]?.version || 'Unknown';
      console.log(`📊 PostgreSQL version: ${version}`);

      console.log('🔧 Installing required extensions...');
      
      // Install extensions
      await executeSqlSafely(client, 'CREATE EXTENSION IF NOT EXISTS "uuid-ossp"', 'Installing uuid-ossp extension');
      await executeSqlSafely(client, 'CREATE EXTENSION IF NOT EXISTS "vector"', 'Installing vector extension');

      // Verify pgvector installation
      const vectorCheck = await client.query(
        "SELECT 1 FROM pg_extension WHERE extname = 'vector'"
      );
      
      if (vectorCheck.rows.length === 0) {
        throw new Error('vector extension not found after installation');
      }

      console.log('📄 Running step-by-step schema migration...');
      
      // Step 1: Create documents table
      await executeSqlSafely(client, `
        CREATE TABLE IF NOT EXISTS documents (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            url TEXT UNIQUE NOT NULL,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            raw_html TEXT,
            
            -- Vector embedding for similarity search (1024 dimensions for amazon.titan-embed-text-v2:0)
            embedding vector(1024),
            
            -- Metadata as JSONB for flexibility
            metadata JSONB NOT NULL DEFAULT '{}',
            
            -- Content type classification
            content_type VARCHAR(50) NOT NULL DEFAULT 'text' CHECK (content_type IN ('text', 'code', 'heading', 'list', 'table')),
            
            -- Chunk information for large documents
            chunk_index INTEGER NOT NULL DEFAULT 0,
            total_chunks INTEGER NOT NULL DEFAULT 1,
            
            -- Hierarchical content organization
            section TEXT,
            subsection TEXT,
            
            -- Collection/source identifier (e.g., 'pssis-admin', 'schoology')
            collection TEXT NOT NULL DEFAULT 'pssis-admin',
            
            -- Full-text search vector
            search_vector tsvector,
            
            -- Timestamps
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            
            -- Constraints
            CONSTRAINT valid_chunk_index CHECK (chunk_index >= 0),
            CONSTRAINT valid_total_chunks CHECK (total_chunks > 0),
            CONSTRAINT valid_chunk_relationship CHECK (chunk_index < total_chunks)
        )
      `, 'Creating documents table');

      // Step 2: Create other tables
      await executeSqlSafely(client, `
        CREATE TABLE IF NOT EXISTS query_stats (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            query_text TEXT NOT NULL,
            user_id TEXT,
            
            -- Query performance metrics
            embedding_time_ms INTEGER,
            search_time_ms INTEGER,
            total_time_ms INTEGER,
            
            -- Search results metadata
            results_count INTEGER NOT NULL DEFAULT 0,
            top_score DECIMAL(5,4),
            
            -- Query classification
            query_type VARCHAR(50) DEFAULT 'unknown' CHECK (query_type IN ('feature', 'configuration', 'troubleshooting', 'general', 'unknown')),
            prefer_steps BOOLEAN DEFAULT false,
            
            -- Response quality tracking (can be updated later)
            user_feedback INTEGER CHECK (user_feedback >= 1 AND user_feedback <= 5),
            
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
      `, 'Creating query_stats table');

      await executeSqlSafely(client, `
        CREATE TABLE IF NOT EXISTS processing_jobs (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            job_type VARCHAR(50) NOT NULL CHECK (job_type IN ('crawl', 'index', 'reindex', 'cleanup')),
            status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
            
            -- Job configuration
            config JSONB NOT NULL DEFAULT '{}',
            
            -- Progress tracking
            progress_current INTEGER DEFAULT 0,
            progress_total INTEGER DEFAULT 0,
            
            -- Results and errors
            result JSONB,
            error_message TEXT,
            
            -- Timing information
            started_at TIMESTAMP WITH TIME ZONE,
            completed_at TIMESTAMP WITH TIME ZONE,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            
            CONSTRAINT valid_progress CHECK (progress_current >= 0 AND progress_total >= 0)
        )
      `, 'Creating processing_jobs table');

      // Step 3: Create indexes
      console.log('🔗 Creating indexes...');
      
      const indexes = [
        { name: 'idx_documents_embedding_ivfflat', sql: 'CREATE INDEX IF NOT EXISTS idx_documents_embedding_ivfflat ON documents USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100)' },
        { name: 'idx_documents_url', sql: 'CREATE UNIQUE INDEX IF NOT EXISTS idx_documents_url ON documents (url)' },
        { name: 'idx_documents_metadata_gin', sql: 'CREATE INDEX IF NOT EXISTS idx_documents_metadata_gin ON documents USING gin (metadata)' },
        { name: 'idx_documents_search_vector', sql: 'CREATE INDEX IF NOT EXISTS idx_documents_search_vector ON documents USING gin (search_vector)' },
        { name: 'idx_documents_content_type', sql: 'CREATE INDEX IF NOT EXISTS idx_documents_content_type ON documents (content_type)' },
        { name: 'idx_documents_section', sql: 'CREATE INDEX IF NOT EXISTS idx_documents_section ON documents (section) WHERE section IS NOT NULL' },
        { name: 'idx_documents_subsection', sql: 'CREATE INDEX IF NOT EXISTS idx_documents_subsection ON documents (subsection) WHERE subsection IS NOT NULL' },
        { name: 'idx_documents_collection', sql: 'CREATE INDEX IF NOT EXISTS idx_documents_collection ON documents (collection)' },
        { name: 'idx_documents_chunks', sql: 'CREATE INDEX IF NOT EXISTS idx_documents_chunks ON documents (url, chunk_index)' },
        { name: 'idx_documents_created_at', sql: 'CREATE INDEX IF NOT EXISTS idx_documents_created_at ON documents (created_at)' },
        { name: 'idx_documents_updated_at', sql: 'CREATE INDEX IF NOT EXISTS idx_documents_updated_at ON documents (updated_at)' }
      ];

      for (const index of indexes) {
        await executeSqlSafely(client, index.sql, `Creating index ${index.name}`);
      }

      // Step 4: Create functions and triggers
      await executeSqlSafely(client, `
        CREATE OR REPLACE FUNCTION update_document_search_vector()
        RETURNS TRIGGER AS $$
        BEGIN
            NEW.search_vector := to_tsvector('english', 
                COALESCE(NEW.title, '') || ' ' || 
                COALESCE(NEW.content, '') || ' ' ||
                COALESCE(NEW.section, '') || ' ' ||
                COALESCE(NEW.subsection, '')
            );
            NEW.updated_at := NOW();
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql
      `, 'Creating update_document_search_vector function');

      await executeSqlSafely(client, `
        DROP TRIGGER IF EXISTS trigger_update_document_search_vector ON documents;
        CREATE TRIGGER trigger_update_document_search_vector
            BEFORE INSERT OR UPDATE ON documents
            FOR EACH ROW
            EXECUTE FUNCTION update_document_search_vector()
      `, 'Creating search vector trigger');

      // Step 5: Create search functions
      await executeSqlSafely(client, `
        CREATE OR REPLACE FUNCTION find_similar_documents(
            query_embedding vector(1024),
            similarity_threshold DECIMAL DEFAULT 0.7,
            max_results INTEGER DEFAULT 10,
            content_type_filter TEXT[] DEFAULT NULL,
            collection_filter TEXT[] DEFAULT NULL
        )
        RETURNS TABLE(
            id UUID,
            url TEXT,
            title TEXT,
            content TEXT,
            metadata JSONB,
            content_type VARCHAR(50),
            section TEXT,
            subsection TEXT,
            collection TEXT,
            similarity_score DECIMAL
        ) AS $$
        BEGIN
            RETURN QUERY
            SELECT
                d.id,
                d.url,
                d.title,
                d.content,
                d.metadata,
                d.content_type,
                d.section,
                d.subsection,
                d.collection,
                ROUND((1 - (d.embedding <=> query_embedding))::DECIMAL, 4) as similarity_score
            FROM documents d
            WHERE
                (content_type_filter IS NULL OR d.content_type = ANY(content_type_filter))
                AND (collection_filter IS NULL OR d.collection = ANY(collection_filter))
                AND (1 - (d.embedding <=> query_embedding)) >= similarity_threshold
            ORDER BY d.embedding <=> query_embedding
            LIMIT max_results;
        END;
        $$ LANGUAGE plpgsql
      `, 'Creating find_similar_documents function');

      console.log('✅ Schema migration completed successfully');

      // Verify table creation
      const tablesResult = await client.query(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
          AND table_name IN ('documents', 'query_stats', 'processing_jobs')
        ORDER BY table_name
      `);

      const createdTables = tablesResult.rows.map(row => row.table_name);
      console.log(`📋 Available tables: ${createdTables.join(', ')}`);

      return {
        success: true,
        message: 'Safe database migration completed successfully',
        details: {
          tablesCreated: createdTables,
          migrationTimestamp: new Date().toISOString(),
        },
      };

    } finally {
      client.release();
    }

  } catch (error) {
    console.error('❌ Safe migration failed:', error);
    
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Unknown migration error',
      details: { originalError: error },
    };
  } finally {
    await pool.end();
  }
}

/**
 * Main execution function
 */
async function main(): Promise<void> {
  console.log(`🚀 PowerSchool RAG API Safe Database Migration`);
  console.log(`🔗 Database: ${config.DATABASE_URL.replace(/:[^:]*@/, ':****@')}`);
  console.log('');

  const result = await runSafeMigrations();

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

export { runSafeMigrations };