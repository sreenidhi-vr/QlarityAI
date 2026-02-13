/**
 * Database migration script for PowerSchool RAG API
 * Sets up PostgreSQL with pgvector extension and creates all required tables
 */

import { Pool, PoolClient } from 'pg';
import config from '@/utils/config';

interface MigrationResult {
  success: boolean;
  message: string;
  details?: Record<string, unknown>;
}

/**
 * Execute SQL with better error context
 */
async function executeSqlSafely(client: PoolClient, sql: string, description: string): Promise<void> {
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
 * Run database migrations
 */
async function runMigrations(): Promise<MigrationResult> {
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
      
      // Install uuid-ossp extension
      await client.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
      console.log('✅ uuid-ossp extension installed');

      // Install pgvector extension
      try {
        await client.query('CREATE EXTENSION IF NOT EXISTS "vector"');
        console.log('✅ vector extension installed');
      } catch (error) {
        console.error('❌ Failed to install pgvector extension');
        console.error('   Make sure pgvector is installed on your PostgreSQL server');
        console.error('   Installation guide: https://github.com/pgvector/pgvector#installation');
        throw error;
      }

      // Verify pgvector installation
      const vectorCheck = await client.query(
        "SELECT 1 FROM pg_extension WHERE extname = 'vector'"
      );
      
      if (vectorCheck.rows.length === 0) {
        throw new Error('vector extension not found after installation');
      }

      console.log('📄 Executing schema migration...');
      
      // Check if documents table exists and its structure
      console.log('🔍 Checking existing table structure...');
      const tableExistsResult = await client.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = 'documents'
        )
      `);
      
      const tableExists = tableExistsResult.rows[0].exists;
      
      if (tableExists) {
        console.log('⚠️  Documents table already exists, checking structure...');
        const columnsResult = await client.query(`
          SELECT column_name
          FROM information_schema.columns
          WHERE table_name = 'documents' AND table_schema = 'public'
        `);
        
        const existingColumns = columnsResult.rows.map(row => row.column_name);
        const requiredColumns = ['id', 'url', 'title', 'content', 'raw_html', 'embedding', 'metadata', 'content_type', 'chunk_index', 'total_chunks', 'section', 'subsection', 'collection', 'search_vector', 'created_at', 'updated_at'];
        
        const missingColumns = requiredColumns.filter(col => !existingColumns.includes(col));
        
        if (missingColumns.length > 0) {
          console.log(`❌ Table incomplete, missing columns: ${missingColumns.join(', ')}`);
          console.log('🔄 Dropping and recreating documents table...');
          
          await executeSqlSafely(client, `DROP TABLE IF EXISTS documents CASCADE`, 'Dropping incomplete documents table');
        } else {
          console.log('✅ Documents table structure is complete');
        }
      }
      
      // Create documents table (will only run if table doesn't exist or was dropped)
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

      // Verify documents table structure before creating indexes
      console.log('🔍 Verifying documents table structure...');
      const columnsResult = await client.query(`
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_name = 'documents' AND table_schema = 'public'
        ORDER BY ordinal_position
      `);
      
      console.log('📋 Documents table columns:');
      columnsResult.rows.forEach(row => {
        console.log(`  - ${row.column_name}: ${row.data_type} (nullable: ${row.is_nullable})`);
      });

      // Check if metadata column exists
      const metadataExists = columnsResult.rows.some(row => row.column_name === 'metadata');
      if (!metadataExists) {
        console.log('❌ Metadata column missing - attempting to add it...');
        await executeSqlSafely(client, `
          ALTER TABLE documents ADD COLUMN metadata JSONB NOT NULL DEFAULT '{}'
        `, 'Adding missing metadata column');
      }

      // Create indexes step by step
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

      // Create functions and triggers
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

      await executeSqlSafely(client, `
        CREATE OR REPLACE FUNCTION hybrid_search(
            query_embedding vector(1024),
            query_text TEXT,
            vector_weight DECIMAL DEFAULT 0.7,
            text_weight DECIMAL DEFAULT 0.3,
            max_results INTEGER DEFAULT 10,
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
            combined_score DECIMAL
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
                ROUND((
                    vector_weight * (1 - (d.embedding <=> query_embedding)) +
                    text_weight * ts_rank(d.search_vector, plainto_tsquery('english', query_text))
                )::DECIMAL, 4) as combined_score
            FROM documents d
            WHERE
                (collection_filter IS NULL OR d.collection = ANY(collection_filter))
                AND (
                    d.search_vector @@ plainto_tsquery('english', query_text)
                    OR (d.embedding <=> query_embedding) < 0.5
                )
            ORDER BY combined_score DESC
            LIMIT max_results;
        END;
        $$ LANGUAGE plpgsql
      `, 'Creating hybrid_search function');

      console.log('✅ Schema migration completed');

      // Verify table creation
      const tablesResult = await client.query(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
          AND table_name IN ('documents', 'query_stats', 'processing_jobs')
        ORDER BY table_name
      `);

      const createdTables = tablesResult.rows.map(row => row.table_name);
      console.log(`📋 Created tables: ${createdTables.join(', ')}`);

      // Verify vector column
      const vectorColumnResult = await client.query(`
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_name = 'documents' 
          AND column_name = 'embedding'
      `);

      if (vectorColumnResult.rows.length === 0) {
        throw new Error('Vector embedding column not found in documents table');
      }

      console.log('✅ Vector column verified');

      // Test vector operations with dynamic dimensions
      console.log('🧪 Testing vector operations...');
      
      const vectorDimensions = await detectVectorDimensions(client);
      console.log(`📐 Detected vector dimensions: ${vectorDimensions}`);
      
      const testVector = Array.from({ length: vectorDimensions }, () => Math.random() - 0.5);
      await client.query('SELECT $1::vector', [JSON.stringify(testVector)]);
      console.log('✅ Vector operations working correctly');

      // Get final statistics
      const stats = await getDatabaseStats(client);
      
      return {
        success: true,
        message: 'Database migration completed successfully',
        details: {
          tablesCreated: createdTables,
          vectorDimensions,
          stats,
        },
      };

    } finally {
      client.release();
    }

  } catch (error) {
    console.error('❌ Migration failed:', error);
    
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
 * Detect current vector dimensions from the database schema
 */
async function detectVectorDimensions(client: PoolClient): Promise<number> {
  try {
    const result = await client.query(`
      SELECT
        atttypmod
      FROM pg_attribute
      JOIN pg_class ON pg_attribute.attrelid = pg_class.oid
      JOIN pg_namespace ON pg_class.relnamespace = pg_namespace.oid
      WHERE pg_class.relname = 'documents'
        AND pg_namespace.nspname = 'public'
        AND pg_attribute.attname = 'embedding'
        AND NOT pg_attribute.attisdropped
    `);

    if (result.rows.length > 0 && result.rows[0].atttypmod > 0) {
      // atttypmod for vector type stores dimensions + 4
      return result.rows[0].atttypmod - 4;
    }

    // Fallback: try to parse from column definition
    const fallbackResult = await client.query(`
      SELECT
        column_name,
        data_type,
        udt_name
      FROM information_schema.columns
      WHERE table_name = 'documents'
        AND column_name = 'embedding'
        AND table_schema = 'public'
    `);

    if (fallbackResult.rows.length > 0 && fallbackResult.rows[0].udt_name === 'vector') {
      // Default to 1024 if we can't detect (current schema default)
      return 1024;
    }

    throw new Error('No vector column found in documents table');
  } catch (error) {
    console.warn('Could not detect vector dimensions, defaulting to 1024:', error);
    return 1024;
  }
}

/**
 * Get database statistics after migration
 */
async function getDatabaseStats(client: PoolClient): Promise<Record<string, unknown>> {
  try {
    // Check table sizes
    const sizeResult = await client.query(`
      SELECT 
        schemaname,
        tablename,
        pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size,
        pg_total_relation_size(schemaname||'.'||tablename) as size_bytes
      FROM pg_tables 
      WHERE schemaname = 'public'
        AND tablename IN ('documents', 'query_stats', 'processing_jobs')
      ORDER BY size_bytes DESC
    `);

    // Check index information
    const indexResult = await client.query(`
      SELECT 
        indexname,
        tablename,
        indexdef
      FROM pg_indexes 
      WHERE schemaname = 'public'
        AND tablename IN ('documents', 'query_stats', 'processing_jobs')
      ORDER BY tablename, indexname
    `);

    return {
      tableSizes: sizeResult.rows,
      indexes: indexResult.rows,
      migrationTimestamp: new Date().toISOString(),
    };

  } catch (error) {
    return {
      error: 'Failed to collect database statistics',
      details: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Rollback migrations (drops all tables - USE WITH CAUTION)
 */
async function rollbackMigrations(): Promise<MigrationResult> {
  const pool = new Pool({
    connectionString: config.DATABASE_URL,
    max: 5,
  });

  try {
    const client = await pool.connect();

    try {
      console.log('⚠️  ROLLBACK: Dropping all tables...');
      
      await client.query('DROP TABLE IF EXISTS processing_jobs CASCADE');
      await client.query('DROP TABLE IF EXISTS query_stats CASCADE');
      await client.query('DROP TABLE IF EXISTS documents CASCADE');
      
      console.log('✅ All tables dropped');

      return {
        success: true,
        message: 'Migration rollback completed successfully',
      };

    } finally {
      client.release();
    }

  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Rollback failed',
      details: { originalError: error },
    };
  } finally {
    await pool.end();
  }
}

/**
 * Migrate vector dimensions (e.g., from 1536 to 1024)
 */
async function migrateDimensions(): Promise<MigrationResult> {
  const pool = new Pool({
    connectionString: config.DATABASE_URL,
    max: 5,
    connectionTimeoutMillis: 10000,
  });

  try {
    const client = await pool.connect();
    
    try {
      console.log('🔧 Running vector dimension migration...');
      console.log(`🔗 Database: ${config.DATABASE_URL.replace(/:[^:]*@/, ':****@')}`);
      
      // Detect current dimensions
      const currentDimensions = await detectVectorDimensions(client);
      console.log(`📐 Current vector dimensions: ${currentDimensions}`);
      
      console.log('⚠️  This will clear all existing document data!');
      console.log('');

      // Execute dimension migration steps inline
      console.log('⚡ Executing dimension migration steps...');
      
      // Step 1: Drop existing functions that depend on old vector dimensions
      console.log('🔧 Dropping existing vector functions...');
      await client.query('DROP FUNCTION IF EXISTS find_similar_documents(vector, DECIMAL, INTEGER, TEXT[])');
      await client.query('DROP FUNCTION IF EXISTS hybrid_search(vector, TEXT, DECIMAL, DECIMAL, INTEGER)');
      
      // Step 2: Clear existing data (vector dimension changes require data recreation)
      console.log('🗑️  Clearing existing document data...');
      await client.query('TRUNCATE TABLE documents RESTART IDENTITY');
      
      // Step 3: Drop and recreate the embedding column with target dimensions
      console.log('📐 Updating vector column to 1024 dimensions...');
      await client.query('ALTER TABLE documents DROP COLUMN IF EXISTS embedding');
      await client.query('ALTER TABLE documents ADD COLUMN embedding vector(1024)');
      
      // Step 4: Recreate the vector index
      console.log('📊 Recreating vector index...');
      await client.query('DROP INDEX IF EXISTS idx_documents_embedding_ivfflat');
      await client.query(`
        CREATE INDEX idx_documents_embedding_ivfflat
        ON documents USING ivfflat (embedding vector_cosine_ops)
        WITH (lists = 100)
      `);
      
      // Step 5: Recreate functions with correct vector dimensions (1024)
      console.log('🔄 Recreating vector functions...');
      
      // Recreate find_similar_documents function
      await client.query(`
        CREATE OR REPLACE FUNCTION find_similar_documents(
            query_embedding vector(1024),
            similarity_threshold DECIMAL DEFAULT 0.7,
            max_results INTEGER DEFAULT 10,
            content_type_filter TEXT[] DEFAULT NULL
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
                ROUND((1 - (d.embedding <=> query_embedding))::DECIMAL, 4) as similarity_score
            FROM documents d
            WHERE
                (content_type_filter IS NULL OR d.content_type = ANY(content_type_filter))
                AND (1 - (d.embedding <=> query_embedding)) >= similarity_threshold
            ORDER BY d.embedding <=> query_embedding
            LIMIT max_results;
        END;
        $$ LANGUAGE plpgsql;
      `);
      
      // Recreate hybrid_search function
      await client.query(`
        CREATE OR REPLACE FUNCTION hybrid_search(
            query_embedding vector(1024),
            query_text TEXT,
            vector_weight DECIMAL DEFAULT 0.7,
            text_weight DECIMAL DEFAULT 0.3,
            max_results INTEGER DEFAULT 10
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
            combined_score DECIMAL
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
                ROUND((
                    vector_weight * (1 - (d.embedding <=> query_embedding)) +
                    text_weight * ts_rank(d.search_vector, plainto_tsquery('english', query_text))
                )::DECIMAL, 4) as combined_score
            FROM documents d
            WHERE
                d.search_vector @@ plainto_tsquery('english', query_text)
                OR (d.embedding <=> query_embedding) < 0.5
            ORDER BY combined_score DESC
            LIMIT max_results;
        END;
        $$ LANGUAGE plpgsql;
      `);
      
      // Update comments
      await client.query(`
        COMMENT ON COLUMN documents.embedding IS 'Vector embedding using amazon.titan-embed-text-v2:0 (1024 dimensions)'
      `);
      
      console.log('✅ Dimension migration completed successfully');
      
      // Test the new dimensions
      console.log('🧪 Testing new vector dimensions...');
      const newDimensions = await detectVectorDimensions(client);
      console.log(`📐 New vector dimensions: ${newDimensions}`);
      
      const testVector = Array.from({ length: newDimensions }, () => Math.random() - 0.5);
      await client.query('SELECT $1::vector', [JSON.stringify(testVector)]);
      console.log('✅ Vector operations working correctly with new dimensions');
      
      return {
        success: true,
        message: 'Dimension migration completed successfully',
        details: {
          previousDimensions: currentDimensions,
          newDimensions: newDimensions,
          migrationTimestamp: new Date().toISOString(),
        },
      };
      
    } finally {
      client.release();
    }
    
  } catch (error) {
    console.error('❌ Dimension migration failed:', error);
    
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Dimension migration failed',
      details: { originalError: error },
    };
  } finally {
    await pool.end();
  }
}

/**
 * Migrate collection field to existing database
 */
async function migrateCollectionField(): Promise<MigrationResult> {
  const pool = new Pool({
    connectionString: config.DATABASE_URL,
    max: 5,
    connectionTimeoutMillis: 10000,
  });

  try {
    const client = await pool.connect();
    
    try {
      console.log('🔧 Running collection field migration...');
      console.log(`🔗 Database: ${config.DATABASE_URL.replace(/:[^:]*@/, ':****@')}`);
      
      // Check if collection column already exists
      const checkResult = await client.query(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name = 'documents' AND column_name = 'collection'
      `);

      if (checkResult.rows.length > 0) {
        console.log('✅ Collection column already exists, skipping migration');
        return {
          success: true,
          message: 'Collection field already exists - no migration needed',
        };
      }

      console.log('📝 Adding collection column to documents table...');
      
      // Add the collection column
      await client.query(`
        ALTER TABLE documents
        ADD COLUMN collection TEXT NOT NULL DEFAULT 'pssis-admin'
      `);
      
      // Add index for collection
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_documents_collection ON documents (collection)
      `);

      console.log('✅ Successfully added collection column and index');

      // Update existing database functions
      console.log('🔧 Updating database functions for collection support...');
      
      // Drop and recreate find_similar_documents function with collection support
      await client.query(`
        DROP FUNCTION IF EXISTS find_similar_documents(vector(1024), DECIMAL, INTEGER, TEXT[])
      `);
      
      await client.query(`
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
        $$ LANGUAGE plpgsql;
      `);

      // Drop and recreate hybrid_search function with collection support
      await client.query(`
        DROP FUNCTION IF EXISTS hybrid_search(vector(1024), TEXT, DECIMAL, DECIMAL, INTEGER)
      `);
      
      await client.query(`
        CREATE OR REPLACE FUNCTION hybrid_search(
            query_embedding vector(1024),
            query_text TEXT,
            vector_weight DECIMAL DEFAULT 0.7,
            text_weight DECIMAL DEFAULT 0.3,
            max_results INTEGER DEFAULT 10,
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
            combined_score DECIMAL
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
                ROUND((
                    vector_weight * (1 - (d.embedding <=> query_embedding)) +
                    text_weight * ts_rank(d.search_vector, plainto_tsquery('english', query_text))
                )::DECIMAL, 4) as combined_score
            FROM documents d
            WHERE
                (collection_filter IS NULL OR d.collection = ANY(collection_filter))
                AND (
                    d.search_vector @@ plainto_tsquery('english', query_text)
                    OR (d.embedding <=> query_embedding) < 0.5
                )
            ORDER BY combined_score DESC
            LIMIT max_results;
        END;
        $$ LANGUAGE plpgsql;
      `);

      // Update document_stats view to include collection statistics
      await client.query(`
        DROP VIEW IF EXISTS document_stats
      `);
      
      await client.query(`
        CREATE OR REPLACE VIEW document_stats AS
        SELECT
            COUNT(*) as total_documents,
            COUNT(DISTINCT url) as unique_urls,
            COUNT(DISTINCT section) as unique_sections,
            COUNT(DISTINCT collection) as unique_collections,
            AVG(LENGTH(content)) as avg_content_length,
            COUNT(*) FILTER (WHERE content_type = 'text') as text_documents,
            COUNT(*) FILTER (WHERE content_type = 'code') as code_documents,
            COUNT(*) FILTER (WHERE content_type = 'heading') as heading_documents,
            COUNT(*) FILTER (WHERE total_chunks > 1) as chunked_documents,
            MIN(created_at) as earliest_document,
            MAX(created_at) as latest_document
        FROM documents;
      `);

      console.log('✅ Successfully updated database functions and views');
      
      return {
        success: true,
        message: 'Collection field migration completed successfully',
        details: {
          migrationTimestamp: new Date().toISOString(),
        },
      };
      
    } finally {
      client.release();
    }
    
  } catch (error) {
    console.error('❌ Collection field migration failed:', error);
    
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Collection migration failed',
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
  const args = process.argv.slice(2);
  const command = args[0] || 'migrate';

  console.log(`🚀 PowerSchool RAG API Database Migration`);
  console.log(`📊 Command: ${command}`);
  console.log(`🔗 Database: ${config.DATABASE_URL.replace(/:[^:]*@/, ':****@')}`);
  console.log('');

  let result: MigrationResult;

  switch (command) {
    case 'migrate':
    case 'up':
      result = await runMigrations();
      break;

    case 'rollback':
    case 'down':
      console.log('⚠️  WARNING: This will drop all tables and data!');
      console.log('⚠️  Press Ctrl+C to cancel, or wait 5 seconds to continue...');
      
      await new Promise(resolve => setTimeout(resolve, 5000));
      result = await rollbackMigrations();
      break;

    case 'migrate-dimensions':
    case 'dimensions':
      console.log('⚠️  WARNING: This will clear all document data!');
      console.log('⚠️  Press Ctrl+C to cancel, or wait 5 seconds to continue...');
      
      await new Promise(resolve => setTimeout(resolve, 5000));
      result = await migrateDimensions();
      break;

    case 'migrate-collection':
    case 'collection':
      result = await migrateCollectionField();
      break;

    default:
      console.error(`❌ Unknown command: ${command}`);
      console.log('Available commands:');
      console.log('  migrate, up           - Run migrations');
      console.log('  rollback, down        - Rollback migrations (drops all tables)');
      console.log('  migrate-dimensions    - Migrate vector dimensions (clears data)');
      console.log('  migrate-collection    - Add collection field to existing database');
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

export { runMigrations, rollbackMigrations, migrateDimensions, migrateCollectionField, detectVectorDimensions };