-- PowerSchool RAG API Database Schema
-- PostgreSQL + vector extension for vector similarity search

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";

-- Documents table for storing PowerSchool documentation with embeddings
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
);

-- Indexes for optimal performance

-- Primary vector similarity search index (IVFFlat for production)
CREATE INDEX IF NOT EXISTS idx_documents_embedding_ivfflat 
ON documents USING ivfflat (embedding vector_cosine_ops) 
WITH (lists = 100);

-- Alternative HNSW index (better for smaller datasets, more memory intensive)
-- CREATE INDEX IF NOT EXISTS idx_documents_embedding_hnsw 
-- ON documents USING hnsw (embedding vector_cosine_ops) 
-- WITH (m = 16, ef_construction = 64);

-- URL lookup index
CREATE UNIQUE INDEX IF NOT EXISTS idx_documents_url ON documents (url);

-- Metadata search index
CREATE INDEX IF NOT EXISTS idx_documents_metadata_gin ON documents USING gin (metadata);

-- Full-text search index
CREATE INDEX IF NOT EXISTS idx_documents_search_vector ON documents USING gin (search_vector);

-- Content type filtering
CREATE INDEX IF NOT EXISTS idx_documents_content_type ON documents (content_type);

-- Section-based filtering
CREATE INDEX IF NOT EXISTS idx_documents_section ON documents (section) WHERE section IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_documents_subsection ON documents (subsection) WHERE subsection IS NOT NULL;

-- Collection-based filtering
CREATE INDEX IF NOT EXISTS idx_documents_collection ON documents (collection);

-- Chunk-based queries
CREATE INDEX IF NOT EXISTS idx_documents_chunks ON documents (url, chunk_index);

-- Timestamp-based queries
CREATE INDEX IF NOT EXISTS idx_documents_created_at ON documents (created_at);
CREATE INDEX IF NOT EXISTS idx_documents_updated_at ON documents (updated_at);

-- Query statistics table for monitoring and analytics
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
);

-- Indexes for query stats
CREATE INDEX IF NOT EXISTS idx_query_stats_user_id ON query_stats (user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_query_stats_created_at ON query_stats (created_at);
CREATE INDEX IF NOT EXISTS idx_query_stats_query_type ON query_stats (query_type);
CREATE INDEX IF NOT EXISTS idx_query_stats_performance ON query_stats (total_time_ms, results_count);

-- Document processing jobs table for crawling and indexing
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
);

-- Indexes for processing jobs
CREATE INDEX IF NOT EXISTS idx_processing_jobs_status ON processing_jobs (status);
CREATE INDEX IF NOT EXISTS idx_processing_jobs_type_status ON processing_jobs (job_type, status);
CREATE INDEX IF NOT EXISTS idx_processing_jobs_created_at ON processing_jobs (created_at);

-- Function to update search_vector automatically
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
$$ LANGUAGE plpgsql;

-- Trigger to automatically update search vector and timestamp
DROP TRIGGER IF EXISTS trigger_update_document_search_vector ON documents;
CREATE TRIGGER trigger_update_document_search_vector
    BEFORE INSERT OR UPDATE ON documents
    FOR EACH ROW
    EXECUTE FUNCTION update_document_search_vector();

-- Function to get similar documents using vector search
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

-- Function to perform hybrid search (vector + full-text)
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

-- Performance monitoring view
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

-- Query performance view
CREATE OR REPLACE VIEW query_performance AS
SELECT 
    DATE_TRUNC('hour', created_at) as hour,
    COUNT(*) as query_count,
    AVG(total_time_ms) as avg_response_time,
    PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY total_time_ms) as p95_response_time,
    AVG(results_count) as avg_results_count,
    COUNT(*) FILTER (WHERE user_feedback IS NOT NULL) as feedback_count,
    AVG(user_feedback) FILTER (WHERE user_feedback IS NOT NULL) as avg_rating
FROM query_stats
WHERE created_at >= NOW() - INTERVAL '7 days'
GROUP BY DATE_TRUNC('hour', created_at)
ORDER BY hour DESC;

-- Grant permissions (adjust as needed for your deployment)
-- GRANT SELECT, INSERT, UPDATE, DELETE ON documents TO rag_api_user;
-- GRANT SELECT, INSERT ON query_stats TO rag_api_user;
-- GRANT SELECT ON processing_jobs TO rag_api_user;
-- GRANT USAGE ON SEQUENCE documents_id_seq TO rag_api_user;

-- Comments for documentation
COMMENT ON TABLE documents IS 'Stores PowerSchool PSSIS-Admin documentation with vector embeddings for similarity search';
COMMENT ON COLUMN documents.embedding IS 'Vector embedding using amazon.titan-embed-text-v2:0 (1024 dimensions)';
COMMENT ON COLUMN documents.metadata IS 'Flexible metadata storage including page hierarchy, tags, etc.';
COMMENT ON COLUMN documents.search_vector IS 'Full-text search vector for hybrid search capabilities';
COMMENT ON TABLE query_stats IS 'Tracks query performance and user feedback for analytics';
COMMENT ON FUNCTION find_similar_documents IS 'Vector similarity search with configurable threshold and filters';
COMMENT ON FUNCTION hybrid_search IS 'Combines vector similarity and full-text search for better results';