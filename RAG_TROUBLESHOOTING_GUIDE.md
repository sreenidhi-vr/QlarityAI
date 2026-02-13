# RAG API Troubleshooting Guide

This guide helps diagnose and fix issues when RAG queries return fallback responses with empty retrieval results.

## Quick Diagnosis Commands

```bash
# Check database and vector store status
node comprehensive-rag-diagnostics.js

# Test current API functionality
node test-rag-fix.js

# Check database seeding status
npm run seed stats
```

## Common Issues & Solutions

### 1. Empty Retrieval Results (`documents_found: 0`)

**Symptoms:**
- `debug_info.is_fallback: true`
- `debug_info.fallback_reason: "EMPTY_RETRIEVAL_RESULTS"`
- `debug_info.documents_found: 0`
- `retrieved_docs: []`

**Root Causes & Fixes:**

#### A. Database Not Seeded
**Check:** Run `npm run seed stats` - shows 0 documents
**Fix:** 
```bash
npm run migrate  # Create schema
npm run seed     # Crawl and embed documents
```

#### B. Similarity Threshold Too High
**Check:** Look for low similarity scores in logs
**Fix:** Lower similarity threshold in [`src/core/rag/retriever.ts`](src/core/rag/retriever.ts:42):
```typescript
similarityThreshold = 0.3, // CHANGED: Lowered from 0.7 to 0.3
```

#### C. Embedding Model Mismatch
**Check:** Vector dimensions don't match (1024 expected for Titan v2)
**Fix:** Ensure consistent embedding model:
```env
EMBEDDING_PROVIDER=bedrock
EMBEDDING_MODEL=amazon.titan-embed-text-v2:0
```

#### D. AWS Credentials Issues
**Check:** `debug_info.used_mock_embedding: true`
**Fix:** Configure AWS credentials in `.env`:
```env
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
AWS_REGION=us-east-1
```

### 2. Pipeline Failures

**Symptoms:**
- `debug_info.pipeline_stage: "fallback"`
- Error messages in logs

**Solutions:**

#### Database Connection Issues
```bash
# Check PostgreSQL is running
pg_isready -h localhost -p 5432

# Verify DATABASE_URL format
# postgresql://username:password@localhost:5432/database_name
```

#### pgvector Extension Missing
```sql
-- Connect to your database and run:
CREATE EXTENSION IF NOT EXISTS vector;
```

#### Embedding Service Unavailable
- Check AWS Bedrock service status
- Verify region configuration
- Test credentials with `aws sts get-caller-identity`

### 3. Query-Specific Issues

#### Query Not Found in Documentation
**Check:** Run diagnostics to see available sections
**Solution:** 
- Use more general terms
- Check if pages were crawled properly
- Verify crawl base URL is correct

#### Poor Query Preprocessing
**Enhancement:** Add query expansion in [`src/core/rag/retriever.ts`](src/core/rag/retriever.ts):
```typescript
// Add synonyms/alternatives for common terms
const expandQuery = (query: string): string => {
  return query
    .replace(/enroll/gi, 'enroll OR register OR add')
    .replace(/student/gi, 'student OR pupil OR learner');
};
```

## Debugging Tools

### 1. Comprehensive Diagnostics
```bash
node comprehensive-rag-diagnostics.js
```
**Output Analysis:**
- ✅ Green checkmarks = working correctly
- ❌ Red X marks = needs fixing
- ⚠️ Warnings = may cause issues

### 2. Enhanced Logging
Enable debug logging by checking console output for:
- `[Retriever]` - Vector search details
- `[RAG Pipeline]` - Processing stages
- `[Bedrock Auth]` - AWS authentication

### 3. Manual Database Queries
```sql
-- Check document count
SELECT COUNT(*) FROM documents;

-- Check embedding dimensions
SELECT array_length(embedding::float[], 1) as dims, COUNT(*) 
FROM documents 
WHERE embedding IS NOT NULL 
GROUP BY dims;

-- Search for specific terms
SELECT title, section, ts_rank(search_vector, plainto_tsquery('english', 'enroll student'))
FROM documents 
WHERE search_vector @@ plainto_tsquery('english', 'enroll student')
ORDER BY ts_rank DESC
LIMIT 5;
```

## Performance Optimization

### 1. Similarity Threshold Tuning
- **0.1-0.3**: High recall, may include less relevant docs
- **0.3-0.5**: Balanced precision/recall (recommended)
- **0.5-0.7**: High precision, may miss relevant docs
- **0.7+**: Very strict, likely to return empty results

### 2. Hybrid Search Fallback
Enable in [`src/core/rag/ragPipeline.ts`](src/core/rag/ragPipeline.ts:72):
```typescript
useHybridSearch = true, // Combines vector + text search
```

### 3. Query Preprocessing
Add in [`src/core/rag/retriever.ts`](src/core/rag/retriever.ts):
```typescript
const preprocessQuery = (query: string): string => {
  return query
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')  // Remove punctuation
    .replace(/\s+/g, ' ')      // Normalize whitespace
    .trim();
};
```

## Configuration Reference

### Essential Environment Variables
```env
# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/powerschool_rag

# AWS Bedrock
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...
AWS_REGION=us-east-1
EMBEDDING_PROVIDER=bedrock
EMBEDDING_MODEL=amazon.titan-embed-text-v2:0
LLM_PROVIDER=bedrock
LLM_MODEL=anthropic.claude-3-haiku-20240307-v1:0

# API Settings
ADMIN_API_KEY=your-secret-admin-key
```

### Default RAG Parameters
```typescript
// In ragPipeline.ts
{
  topK: 10,                    // Max documents to retrieve
  similarityThreshold: 0.3,    // Minimum similarity score
  contextWindowTokens: 3000,   // Max context length
  maxTokens: 1500,            // Max response length
}
```

## Monitoring & Alerts

### Key Metrics to Watch
- **Fallback Rate**: Should be < 20%
- **Processing Time**: Should be < 10 seconds
- **Documents Retrieved**: Should average 5-10 per query
- **Similarity Scores**: Should be > 0.3 for relevant results

### Health Checks
```javascript
// Check API health
GET /health

// Example response
{
  "status": "ok",
  "checks": [
    {"name": "database", "status": "ok"},
    {"name": "aws_bedrock", "status": "ok"},
    {"name": "vector_store", "status": "ok"}
  ]
}
```

## Escalation Path

1. **Level 1**: Run diagnostics and check common issues
2. **Level 2**: Enable debug logging and analyze pipeline
3. **Level 3**: Check database and embedding service health
4. **Level 4**: Review and adjust similarity thresholds
5. **Level 5**: Consider re-seeding database or changing models

## Success Indicators

✅ **Fixed Successfully When:**
- `debug_info.is_fallback: false`
- `debug_info.documents_found > 0`
- `retrieved_docs.length > 0`
- Response contains relevant content
- Similarity scores > 0.3

## Common Fixes Applied

1. **Lowered similarity threshold** from 0.7 to 0.3
2. **Added enhanced debugging** throughout pipeline
3. **Implemented hybrid search fallback**
4. **Improved error handling** with specific failure reasons
5. **Added query preprocessing** and embedding validation

---

**Last Updated**: 2025-09-25  
**Version**: 1.0  
**Maintainer**: RAG Engineering Team