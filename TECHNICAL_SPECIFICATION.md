# PowerSchool RAG API - Technical Specification

## Overview

Production-ready TypeScript Node.js RAG (Retrieval-Augmented Generation) API service for PowerSchool PSSIS-Admin documentation, designed for Implementation Specialists via Slack integration through n8n.

## Architecture Decisions

### Core Technology Stack
- **Runtime**: Node.js 18+ with TypeScript 5.x
- **Web Framework**: Fastify 4.x (chosen for TypeScript-first design, performance, and built-in validation)
- **Embedding Model**: OpenAI text-embedding-3-large (1536 dimensions, superior accuracy)
- **Context Budget**: 4K context window, ~1500 token response limit
- **Vector Database**: PostgreSQL 15+ with pgvector extension
- **Fallback Storage**: In-memory vector store for development
- **LLM Provider**: Configurable adapters (OpenAI GPT-4 default)

### System Architecture

```mermaid
graph TB
    subgraph "External Systems"
        SLACK[Slack Channel]
        N8N[n8n Workflow Engine]
        PSSIS[PowerSchool PSSIS Docs]
        OPENAI[OpenAI API]
    end
    
    subgraph "RAG API Service"
        subgraph "API Layer"
            ROUTES[Fastify Routes]
            MIDDLEWARE[Security Middleware]
            VALIDATION[Schema Validation]
        end
        
        subgraph "Core Services"
            RAG[RAG Pipeline]
            PROMPT[Prompt Engine]
            CRAWLER[Document Crawler]
        end
        
        subgraph "Adapter Layer"
            EMB_ADAPTER[Embedding Adapters]
            LLM_ADAPTER[LLM Adapters]
            VECTOR_ADAPTER[Vector Store Adapters]
        end
        
        subgraph "Storage Layer"
            POSTGRES[(PostgreSQL + pgvector)]
            MEMORY[(In-Memory Store)]
        end
    end
    
    SLACK --> N8N
    N8N --> ROUTES
    ROUTES --> MIDDLEWARE
    MIDDLEWARE --> VALIDATION
    VALIDATION --> RAG
    RAG --> PROMPT
    RAG --> EMB_ADAPTER
    RAG --> LLM_ADAPTER
    RAG --> VECTOR_ADAPTER
    EMB_ADAPTER --> OPENAI
    LLM_ADAPTER --> OPENAI
    VECTOR_ADAPTER --> POSTGRES
    VECTOR_ADAPTER --> MEMORY
    CRAWLER --> PSSIS
    CRAWLER --> VECTOR_ADAPTER
```

## Component Specifications

### 1. API Layer (`src/api/`)

#### Routes (`src/api/routes/`)
- **POST /api/v1/ask**: Main RAG query endpoint
- **GET /api/v1/health**: Service health check
- **POST /api/v1/admin/reindex**: Document reindexing (admin only)

#### Request/Response Schemas (`src/api/schemas/`)
```typescript
// Ask Request Schema
interface AskRequest {
  query: string;           // Max 1000 characters
  userId?: string;         // Optional user tracking
  prefer_steps?: boolean;  // Prefer step-by-step format
  max_tokens?: number;     // Override default token limit
}

// Ask Response Schema
interface AskResponse {
  answer: string;                    // Markdown-formatted response
  summary: string;                   // 1-2 sentence summary
  steps?: string[];                  // Optional step-by-step instructions
  citations: Citation[];             // Source references
  retrieved_docs: RetrievedDoc[];    // Supporting documents
}

interface Citation {
  title: string;
  url: string;
}

interface RetrievedDoc {
  id: string;
  score: number;
  excerpt: string;
}
```

### 2. Adapter Patterns (`src/adapters/`)

#### Embedding Adapters (`src/adapters/embedding/`)
```typescript
interface EmbeddingAdapter {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
  getDimensions(): number;
  getModel(): string;
}

// Implementations:
// - OpenAIEmbeddingAdapter (text-embedding-3-large)
// - OpenRouterEmbeddingAdapter
// - LocalEmbeddingAdapter (for future local models)
```

#### LLM Adapters (`src/adapters/llm/`)
```typescript
interface LLMAdapter {
  generate(messages: ChatMessage[], options?: GenerateOptions): Promise<string>;
  getMaxTokens(): number;
  getModel(): string;
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

// Implementations:
// - OpenAILLMAdapter (gpt-4)
// - OpenRouterLLMAdapter
// - AnthropicLLMAdapter
```

#### Vector Store Adapters (`src/adapters/vector-store/`)
```typescript
interface VectorStoreAdapter {
  upsert(docs: VectorDocument[]): Promise<void>;
  search(query: number[], topK: number): Promise<SearchResult[]>;
  delete(ids: string[]): Promise<void>;
  count(): Promise<number>;
}

interface VectorDocument {
  id: string;
  content: string;
  embedding: number[];
  metadata: DocumentMetadata;
}

// Implementations:
// - PostgresVectorAdapter (pgvector)
// - InMemoryVectorAdapter (development fallback)
```

### 3. Core Services (`src/core/`)

#### RAG Pipeline (`src/core/rag/`)
```typescript
class RAGPipeline {
  async process(query: string, options: RAGOptions): Promise<RAGResult> {
    // 1. Embed query using embedding adapter
    // 2. Search vector store for top-K similar documents
    // 3. Filter and rank results
    // 4. Assemble context within token budget
    // 5. Generate response using LLM adapter
    // 6. Parse and structure response
  }
}
```

#### Document Crawler (`src/core/crawler/`)
```typescript
class PowerSchoolCrawler {
  async crawlSite(baseUrl: string): Promise<CrawledDocument[]> {
    // 1. Discover pages under PSSIS-Admin docs
    // 2. Extract content (headings, code blocks, main text)
    // 3. Clean and sanitize HTML
    // 4. Generate metadata (title, URL, section, etc.)
    // 5. Chunk content for optimal embedding
  }
}
```

#### Prompt Engine (`src/core/prompts/`)
```typescript
class PromptEngine {
  buildRAGPrompt(query: string, context: string[], preferSteps: boolean): ChatMessage[] {
    // Parameterized prompt templates for:
    // - Feature explanations
    // - Step-by-step configurations
    // - Error handling and fallbacks
  }
}
```

### 4. Database Schema

#### PostgreSQL + pgvector Schema
```sql
-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Documents table
CREATE TABLE documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    url TEXT UNIQUE NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    raw_html TEXT,
    metadata JSONB,
    embedding vector(1536),  -- OpenAI text-embedding-3-large dimensions
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_documents_embedding ON documents USING ivfflat (embedding vector_cosine_ops);
CREATE INDEX idx_documents_url ON documents (url);
CREATE INDEX idx_documents_metadata ON documents USING gin (metadata);

-- Query stats table (optional)
CREATE TABLE query_stats (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    query TEXT NOT NULL,
    user_id TEXT,
    response_time_ms INTEGER,
    retrieved_count INTEGER,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

### 5. Environment Configuration

```bash
# Server Configuration
PORT=3000
NODE_ENV=production
LOG_LEVEL=info

# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/powerschool_rag
VECTOR_TABLE_NAME=documents

# OpenAI Configuration
OPENAI_API_KEY=sk-...
EMBEDDING_MODEL=text-embedding-3-large
LLM_MODEL=gpt-4
MAX_TOKENS=1500

# Security
RATE_LIMIT_PER_MIN=60
MAX_QUERY_LENGTH=1000
ADMIN_API_KEY=admin-secret-key

# Crawling
CRAWL_BASE_URL=https://ps.powerschool-docs.com/pssis-admin/latest/
CRAWL_DELAY_MS=1000
MAX_PAGES=1000
```

### 6. Security & Performance

#### Security Measures
- Rate limiting: 60 requests/minute per IP
- Input validation: Max query length, sanitized HTML
- API key authentication for admin endpoints
- CORS configuration for allowed origins
- Request logging and monitoring

#### Performance Optimizations
- Connection pooling for PostgreSQL
- Embedding caching for repeated queries
- Response compression (gzip)
- Vector index optimization (IVFFlat)
- Token budget management to prevent overage

### 7. Integration Patterns

#### n8n Workflow Design
```json
{
  "name": "PowerSchool RAG Slack Bot",
  "nodes": [
    {
      "name": "Slack Trigger",
      "type": "slack-webhook"
    },
    {
      "name": "Extract Query", 
      "type": "function"
    },
    {
      "name": "RAG API Call",
      "type": "http-request",
      "endpoint": "{{process.env.RAG_API_URL}}/api/v1/ask"
    },
    {
      "name": "Format Response",
      "type": "function" 
    },
    {
      "name": "Send to Slack",
      "type": "slack-send-message"
    }
  ]
}
```

#### Slack Message Format
```json
{
  "blocks": [
    {
      "type": "section",
      "text": {
        "type": "mrkdwn",
        "text": "*Summary:* {{summary}}"
      }
    },
    {
      "type": "section", 
      "text": {
        "type": "mrkdwn",
        "text": "{{answer}}"
      }
    },
    {
      "type": "context",
      "elements": [
        {
          "type": "mrkdwn",
          "text": "Sources: {{citations}}"
        }
      ]
    }
  ]
}
```

## Implementation Guidelines

### Code Quality Standards
- **TypeScript**: Strict mode enabled, no `any` types
- **Testing**: >80% code coverage, unit + integration tests
- **Linting**: ESLint + Prettier with consistent formatting
- **Documentation**: JSDoc comments for all public APIs
- **Error Handling**: Structured errors with proper HTTP codes

### Performance Targets
- **Response Time**: <2 seconds for typical queries
- **Throughput**: 100+ concurrent requests
- **Embedding**: Batch processing for efficiency
- **Memory Usage**: <512MB base footprint

### Monitoring & Observability
- Health checks and readiness probes
- Structured logging (JSON format)
- Metrics collection (response times, error rates)
- Request tracing for debugging

This specification serves as the complete blueprint for implementing the PowerSchool RAG API service with all required components, integrations, and operational considerations.