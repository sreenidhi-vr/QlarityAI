# Multi-Platform AI Assistant - Developer Guide

A production-ready TypeScript Node.js API service that provides intelligent question-answering capabilities for documentation using RAG (Retrieval-Augmented Generation) technology. Supports multiple knowledge bases with collection-based separation, accessible through both **Slack** and **Microsoft Teams** platforms.

## 📋 Table of Contents

- [Prerequisites](#prerequisites)
- [Environment Setup](#environment-setup)
- [Database Setup](#database-setup)
- [Collections & Knowledge Bases](#collections--knowledge-bases)
- [Seeding Documentation](#seeding-documentation)
- [Running the Service](#running-the-service)
- [API Usage](#api-usage)
- [Debugging Locally](#debugging-locally)
- [Slack Integration](#slack-app-integration)
- [Microsoft Teams Integration](#microsoft-teams-integration)
- [Troubleshooting](#troubleshooting)
- [Final Notes](#final-notes)

## 🛠️ Prerequisites

### Node.js (v18.0.0 or higher)

**macOS:**
```bash
# Using Homebrew
brew install node

# Using nvm (recommended)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
nvm install 18
nvm use 18
```

**Windows:**
- Download from [nodejs.org](https://nodejs.org/)
- Or using Chocolatey: `choco install nodejs`
- Or using winget: `winget install OpenJS.NodeJS`

**Linux (Ubuntu/Debian):**
```bash
# Using NodeSource repository
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Using nvm (recommended)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
nvm install 18
nvm use 18
```

### npm or yarn

npm comes with Node.js. For yarn:
```bash
npm install -g yarn
```

### PostgreSQL with pgvector

**macOS:**
```bash
# Install PostgreSQL
brew install postgresql
brew services start postgresql

# Install pgvector
brew install pgvector
```

**Windows:**
1. Download PostgreSQL from [postgresql.org](https://www.postgresql.org/download/windows/)
2. Install pgvector following [pgvector Windows guide](https://github.com/pgvector/pgvector#windows)

**Linux (Ubuntu/Debian):**
```bash
# Install PostgreSQL
sudo apt update
sudo apt install postgresql postgresql-contrib

# Install pgvector
sudo apt install postgresql-14-pgvector
# OR compile from source (see pgvector docs)
```

**Enable pgvector extension:**
```sql
-- Connect to your database and run:
CREATE EXTENSION IF NOT EXISTS vector;
```

### Docker & Docker Compose

**macOS:**
- Download [Docker Desktop for Mac](https://docs.docker.com/desktop/install/mac-install/)

**Windows:**
- Download [Docker Desktop for Windows](https://docs.docker.com/desktop/install/windows-install/)

**Linux:**
```bash
# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Install Docker Compose
sudo apt install docker-compose-plugin
```

### Git

**All platforms:**
- Download from [git-scm.com](https://git-scm.com/downloads)
- Or use your system's package manager

### Recommended Editor

- **VS Code**: Download from [code.visualstudio.com](https://code.visualstudio.com/)
- Recommended extensions:
  - TypeScript and JavaScript Language Features
  - ESLint
  - Prettier
  - PostgreSQL (by Chris Kolkman)

## 🚀 Environment Setup

### 1. Clone the Repository

```bash
git clone <your-repository-url>
cd qlarity-ai-assistant
```

### 2. Install Dependencies

```bash
npm install
# or
yarn install
```

### 3. Environment Configuration

```bash
# Copy the example environment file
cp .env.example .env
```

Edit the `.env` file with your configuration:

```env
# Server Configuration
PORT=3000
NODE_ENV=development
LOG_LEVEL=info

# Database Configuration
DATABASE_URL=postgresql://postgres:password@localhost:5432/qlarity_rag
VECTOR_TABLE_NAME=documents

# Provider Selection (Choose your AI provider)
EMBEDDING_PROVIDER=bedrock
LLM_PROVIDER=bedrock

# AWS Bedrock Configuration (Required when using Bedrock)
AWS_ACCESS_KEY_ID=your-aws-access-key-id
AWS_SECRET_ACCESS_KEY=your-aws-secret-access-key
AWS_SESSION_TOKEN=your-aws-session-token-if-using-temporary-credentials
AWS_REGION=us-east-1

# Model Configuration
EMBEDDING_MODEL=amazon.titan-embed-text-v2:0
LLM_MODEL=anthropic.claude-3-haiku-20240307-v1:0
MAX_TOKENS=1500

# OpenAI Configuration (Optional - when using OpenAI provider)
# OPENAI_API_KEY=sk-your-openai-api-key-here

# Platform Integrations
# Slack Configuration (Optional)
# SLACK_BOT_TOKEN=xoxb-your-slack-bot-token-here
# SLACK_SIGNING_SECRET=your-slack-signing-secret-here
# SLACK_VERIFIED_WORKSPACES=T1234567890

# Microsoft Teams Configuration (Optional)
# TEAMS_APP_ID=12345678-1234-1234-1234-123456789012
# TEAMS_APP_PASSWORD=your-teams-app-password-here
# TEAMS_VERIFIED_TENANTS=tenant-id-1,tenant-id-2

# Security Configuration
RATE_LIMIT_PER_MIN=60
MAX_QUERY_LENGTH=1000
ADMIN_API_KEY=your-admin-secret-key-here

# Collection Configuration
DEFAULT_COLLECTION=collection-a

# Collection A Crawling Configuration
COLLECTION_A_CRAWL_BASE_URL=https://docs.example.com/collection-a/latest/
COLLECTION_A_CRAWL_DELAY_MS=1000
COLLECTION_A_MAX_PAGES=1000

# Collection B Crawling Configuration
COLLECTION_B_CRAWL_BASE_URL=https://docs.example.com/collection-b/latest/
COLLECTION_B_CRAWL_DELAY_MS=1000
COLLECTION_B_MAX_PAGES=1000

# Optional: Alternative API Providers
# OPENROUTER_API_KEY=your-openrouter-key-here
# ANTHROPIC_API_KEY=your-anthropic-key-here
```

### 4. Environment Variable Explanations

| Variable | Description | Example |
|----------|-------------|---------|
| `PORT` | Server port | `3000` |
| `NODE_ENV` | Environment mode | `development`, `production`, `test` |
| `LOG_LEVEL` | Logging level | `debug`, `info`, `warn`, `error` |
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://user:pass@localhost:5432/dbname` |
| `EMBEDDING_PROVIDER` | AI provider for embeddings | `openai`, `bedrock`, `openrouter`, `local` |
| `LLM_PROVIDER` | AI provider for language models | `openai`, `bedrock`, `anthropic`, `openrouter`, `local` |
| `EMBEDDING_MODEL` | Embedding model name | `text-embedding-3-large`, `amazon.titan-embed-text-v2:0` |
| `LLM_MODEL` | Language model name | `gpt-4`, `anthropic.claude-3-haiku-20240307-v1:0` |
| `AWS_ACCESS_KEY_ID` | AWS access key (for Bedrock) | From AWS credentials |
| `AWS_SECRET_ACCESS_KEY` | AWS secret key (for Bedrock) | From AWS credentials |
| `AWS_SESSION_TOKEN` | AWS session token (if temporary) | From AWS STS |
| `AWS_REGION` | AWS region for Bedrock | `us-east-1`, `us-west-2` |
| `OPENAI_API_KEY` | OpenAI API key (optional) | `sk-...` |
| `SLACK_BOT_TOKEN` | Slack Bot User OAuth Token (optional) | `xoxb-...` |
| `SLACK_SIGNING_SECRET` | Slack App Signing Secret (optional) | From Slack app settings |
| `SLACK_VERIFIED_WORKSPACES` | Comma-separated workspace IDs (optional) | `T1234567890,T0987654321` |
| `TEAMS_APP_ID` | Microsoft Teams App ID (optional) | `12345678-1234-1234-1234-123456789012` |
| `TEAMS_APP_PASSWORD` | Microsoft Teams App Password (optional) | From Azure AD app registration |
| `TEAMS_VERIFIED_TENANTS` | Comma-separated tenant IDs (optional) | `tenant-id-1,tenant-id-2` |
| `ADMIN_API_KEY` | Admin endpoint authentication | Any secure string |
| `DEFAULT_COLLECTION` | Default knowledge base collection | `collection-a`, `collection-b` |
| `COLLECTION_A_CRAWL_BASE_URL` | Collection A docs base URL | URL to crawl |
| `COLLECTION_B_CRAWL_BASE_URL` | Collection B docs base URL | URL to crawl |

### 5. Generate API Keys

**AWS Bedrock (Recommended):**
1. Set up AWS credentials with Bedrock access
2. Ensure your AWS account has access to the required Bedrock models
3. Add credentials to your `.env` file

**AWS Credentials Setup Options:**

*Option 1: Direct credentials in .env (for development):*
```env
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
AWS_SESSION_TOKEN=your-session-token  # if using temporary credentials
AWS_REGION=us-east-1
```

*Option 2: Use AWS credential chain (recommended for production):*
- AWS credentials file (`~/.aws/credentials`)
- Environment variables
- IAM roles (for EC2/ECS deployment)

**OpenAI API Key (Alternative):**
1. Visit [OpenAI API Keys](https://platform.openai.com/api-keys)
2. Create a new API key
3. Copy and add to your `.env` file

**Other Providers:**
- **OpenRouter**: Visit [openrouter.ai](https://openrouter.ai/keys)
- **Anthropic**: Visit [Anthropic Console](https://console.anthropic.com/)

### 6. AWS Bedrock Model Access

Ensure you have access to the following models in AWS Bedrock:

**Embedding Models:**
- `amazon.titan-embed-text-v2:0` (1024 dimensions, recommended)
- `amazon.titan-embed-text-v1` (1536 dimensions)
- `cohere.embed-english-v3` (1024 dimensions)
- `cohere.embed-multilingual-v3` (1024 dimensions)

**Language Models:**
- `anthropic.claude-3-haiku-20240307-v1:0` (recommended, cost-effective)
- `anthropic.claude-3-sonnet-20240229-v1:0` (balanced performance)
- `anthropic.claude-3-opus-20240229-v1:0` (highest quality)
- `amazon.titan-text-express-v1`
- `cohere.command-text-v14`

To request model access:
1. Go to AWS Bedrock Console
2. Navigate to "Model access" in the left sidebar
3. Request access to the models you want to use
4. Wait for approval (usually immediate for most models)

## 🗄️ Database Setup

### 1. Create PostgreSQL Database

```bash
# Connect to PostgreSQL
psql -U postgres

# Create database
CREATE DATABASE qlarity_rag;

# Grant permissions (adjust username as needed)
GRANT ALL PRIVILEGES ON DATABASE qlarity_rag TO postgres;

# Exit psql
\q
```

### 2. Install pgvector Extension

```sql
-- Connect to your database
psql -U postgres -d qlarity_rag

-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Verify installation
SELECT * FROM pg_extension WHERE extname = 'vector';
```

### 3. Run Database Migrations

```bash
# Run the migration script
npm run db:migrate

# Or using yarn
yarn db:migrate
```

The migration script will:
- ✅ Test database connection
- ✅ Install required extensions (`uuid-ossp`, `vector`)
- ✅ Create tables (`documents`, `query_stats`, `processing_jobs`)
- ✅ Set up indexes for optimal performance
- ✅ Create helper functions for vector similarity search

### 4. Verify Database Setup

```sql
-- Check tables were created
\dt

-- Check vector column
\d documents

-- Test vector operations
SELECT '[1,2,3]'::vector;
```

## 📂 Collections & Knowledge Bases

The API supports multiple knowledge bases through a **collection-based architecture**. Each collection represents a separate knowledge base with isolated content and search capabilities.

### Available Collections

| Collection | Description | Documentation Source |
|------------|-------------|---------------------|
| `collection-a` | Primary documentation collection | https://docs.example.com/collection-a/latest/ |
| `collection-b` | Secondary documentation collection | https://docs.example.com/collection-b/latest/ |

### Collection Isolation

- **Vector Separation**: Documents from different collections are stored in the same table but filtered during retrieval
- **Search Isolation**: Queries are scoped to specific collections to prevent context bleed
- **Independent Management**: Each collection can be seeded, updated, or cleared independently
- **API Filtering**: All endpoints support collection-specific operations

### Collection Architecture Benefits

✅ **Single Table Design**: Simplified database schema with metadata-based separation
✅ **Strong Isolation**: Collection filtering enforced throughout the retrieval pipeline
✅ **Flexible Queries**: Support for single or multi-collection searches
✅ **Easy Management**: Collection-specific CLI commands and API endpoints
✅ **Scalable**: Easy to add new collections without schema changes

## 📚 Seeding Documentation

The seeding process downloads and indexes documentation into the vector database. The system supports multiple collections with independent seeding capabilities.

### 1. Available Seeding Commands

```bash
# Seed specific collections
npm run seed:collection-a    # Seed Collection A documentation
npm run seed:collection-b    # Seed Collection B documentation

# Utility commands
npm run seed:stats          # Show collection statistics
npm run seed:clear          # Clear all collections (with confirmation)

# Legacy command (defaults to collection-a)
npm run seed               # Equivalent to seed:collection-a
```

### 2. Collection-Specific Seeding

**Collection A Documentation:**
```bash
npm run seed:collection-a

# Output:
# 🚀 Seeding collection-a collection...
# 📋 Collection: collection-a
# 🌐 Base URL: https://docs.example.com/collection-a/latest/
# 📄 Max Pages: 1000
# ⏱️ Crawl Delay: 1000ms
# Crawling [1/1000]: https://docs.example.com/collection-a/latest/
# ...
# ✅ Seeded 506 documents into collection-a collection
```

**Collection B Documentation:**
```bash
npm run seed:collection-b

# Output:
# 🚀 Seeding collection-b collection...
# 📋 Collection: collection-b
# 🌐 Base URL: https://docs.example.com/collection-b/latest/
# 📄 Max Pages: 1000
# ⏱️ Crawl Delay: 1000ms
# Crawling [1/1000]: https://docs.example.com/collection-b/latest/
# ...
# ✅ Seeded 235 documents into collection-b collection
```

### 3. What the Seed Process Does

The collection-aware seed command:
1. **Configures** collection-specific settings (base URL, max pages, delay)
2. **Crawls** the documentation site for the specified collection
3. **Extracts** content from each page (HTML → Markdown)
4. **Chunks** large documents for optimal retrieval
5. **Generates** embeddings using your configured embedding model
6. **Stores** vectors in PostgreSQL with collection metadata
7. **Reports** statistics (pages crawled, documents created, embeddings generated)

### 4. Monitoring Progress & Statistics

**Real-time Progress:**
```bash
# During seeding, you'll see detailed progress:
Crawling [50/1000]: https://docs.example.com/collection-b/latest/courses-grades-students
🔍 Generated embedding with 1024 dimensions (expected: 1024)
📄 Document "Course Materials" chunked into 3 pieces
🔄 Processing batch 5/15 (10 documents)...
```

**Collection Statistics:**
```bash
npm run seed:stats

# Output:
# 📊 Collection Statistics:
#
# Collection: collection-a
# - Documents: 506
# - Total Chunks: 506
# - Vector Dimensions: 1024
# - Index Size: ~15MB
#
# Collection: collection-b
# - Documents: 235
# - Total Chunks: 235
# - Vector Dimensions: 1024
# - Index Size: ~7MB
#
# Total Database Size: ~22MB
# Total Documents: 741
```

### 5. Customizing Collection Settings

Edit your `.env` file to customize crawling per collection:
```env
# Collection A Configuration
COLLECTION_A_CRAWL_BASE_URL=https://docs.example.com/collection-a/latest/
COLLECTION_A_CRAWL_DELAY_MS=1000
COLLECTION_A_MAX_PAGES=500

# Collection B Configuration
COLLECTION_B_CRAWL_BASE_URL=https://docs.example.com/collection-b/latest/
COLLECTION_B_CRAWL_DELAY_MS=1500
COLLECTION_B_MAX_PAGES=200

# For faster testing
COLLECTION_A_MAX_PAGES=50
COLLECTION_B_MAX_PAGES=30
```

### 6. Database Migration & Collection Support

Before seeding, ensure your database supports the collection field:
```bash
# Run migration to add collection support (if needed)
npm run db:migrate

# The migration adds:
# - collection VARCHAR(50) DEFAULT 'collection-a'
# - Index on (collection, embedding) for optimized filtering
# - Updated queries to support collection-based filtering
```

## 🏃‍♂️ Running the Service

### 1. Development Mode (Recommended)

```bash
# Start with hot reload using tsx
npm run dev

# Or using yarn
yarn dev
```

This starts the server with:
- ✅ Hot reload on file changes
- ✅ Pretty console logging
- ✅ Debug information
- ✅ Source map support

### 2. Production Build

```bash
# Build TypeScript to JavaScript
npm run build

# Start the production server
npm start

# Or combine both
npm run build && npm start
```

### 3. Using Docker Compose (Recommended for full stack)

Create a `docker-compose.yml` file:

```yaml
version: '3.8'
services:
  postgres:
    image: pgvector/pgvector:pg15
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: password
      POSTGRES_DB: qlarity_rag
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data

  api:
    build: .
    ports:
      - "3000:3000"
    environment:
      DATABASE_URL: postgresql://postgres:password@postgres:5432/qlarity_rag
      OPENAI_API_KEY: ${OPENAI_API_KEY}
    depends_on:
      - postgres
    volumes:
      - .:/app
      - /app/node_modules

volumes:
  postgres_data:
```

Create a `Dockerfile`:

```dockerfile
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .
RUN npm run build

EXPOSE 3000

CMD ["npm", "start"]
```

```bash
# Start the full stack
docker-compose up --build

# Or run in background
docker-compose up -d --build
```

### 4. Verify Service Health

```bash
# Check health endpoint
curl http://localhost:3000/health

# Expected response:
{
  "status": "ok",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "version": "1.0.0",
  "checks": [
    {"name": "database", "status": "ok", "message": "Connected"},
    {"name": "openai", "status": "ok", "message": "API key configured"},
    {"name": "vector_store", "status": "ok", "message": "Database URL configured"}
  ]
}
```

## 🔧 API Usage

### Collection-Aware Endpoints

All API endpoints now support collection-specific operations to ensure proper knowledge base separation.

### 1. Ask Endpoint with Collection Support

**Endpoint:** `POST /api/v1/ask`

**Basic Usage:**
```bash
# Query specific collection
curl -X POST http://localhost:3000/api/v1/ask \
  -H "Content-Type: application/json" \
  -d '{
    "query": "How do I configure the system?",
    "collection": "collection-a"
  }'

# Query Collection B
curl -X POST http://localhost:3000/api/v1/ask \
  -H "Content-Type: application/json" \
  -d '{
    "query": "How do I create a new resource?",
    "collection": "collection-b"
  }'

# Default collection (if no collection specified)
curl -X POST http://localhost:3000/api/v1/ask \
  -H "Content-Type: application/json" \
  -d '{
    "query": "How do I add new users?"
  }'
```

**Request Parameters:**
```typescript
interface AskRequest {
  query: string;                    // Your question (required)
  collection?: string;              // Collection to search ('collection-a' | 'collection-b')
  prefer_steps?: boolean;           // Format as step-by-step guide
  max_tokens?: number;              // Maximum response tokens
  userId?: string;                  // User identifier for logging
}
```

**Response Format:**
```json
{
  "answer": "# Documentation Configuration\n\n## Summary\n...",
  "summary": "Brief summary of the answer",
  "steps": ["Step 1", "Step 2", "Step 3"],
  "citations": [
    {
      "title": "Documentation",
      "url": "https://docs.example.com/..."
    }
  ],
  "retrieved_docs": [
    {
      "id": "doc_123",
      "score": 0.95,
      "excerpt": "Relevant document excerpt...",
      "collection": "collection-a"
    }
  ]
}
```

### 2. Collection Validation

The API enforces collection validation:
```bash
# Valid collections
"collection": "collection-a"    ✅
"collection": "collection-b"    ✅

# Invalid collection (returns 400 error)
"collection": "invalid"        ❌
```

**Error Response:**
```json
{
  "error": "Validation failed",
  "details": {
    "collection": "must be one of [collection-a, collection-b]"
  }
}
```

### 3. Collection-Specific Examples

**Collection A Queries:**
```bash
# Administrative tasks
curl -X POST http://localhost:3000/api/v1/ask \
  -H "Content-Type: application/json" \
  -d '{
    "query": "How do I set up the system?",
    "collection": "collection-a",
    "prefer_steps": true
  }'

# Configuration questions
curl -X POST http://localhost:3000/api/v1/ask \
  -H "Content-Type: application/json" \
  -d '{
    "query": "What are the setup requirements?",
    "collection": "collection-a"
  }'
```

**Collection B Queries:**
```bash
# Resource management
curl -X POST http://localhost:3000/api/v1/ask \
  -H "Content-Type: application/json" \
  -d '{
    "query": "How do I create new items?",
    "collection": "collection-b",
    "prefer_steps": true
  }'

# User features
curl -X POST http://localhost:3000/api/v1/ask \
  -H "Content-Type: application/json" \
  -d '{
    "query": "How can users submit items?",
    "collection": "collection-b"
  }'
```

### 4. Collection Benefits in Practice

**Isolated Knowledge Bases:**
- Collection A queries only return relevant documentation
- Collection B queries only return related content
- No context bleed between different systems

**Improved Accuracy:**
- More relevant results within the specified domain
- Better similarity scores due to focused search space
- Contextually appropriate responses

**Better User Experience:**
- Users get domain-specific help
- Clear source attribution per collection
- Reduced confusion from mixed results

### 5. Admin Endpoints (Collection-Aware)

**Health Check with Collection Stats:**
```bash
curl http://localhost:3000/health

# Response includes collection information:
{
  "status": "ok",
  "collections": {
    "collection-a": { "documents": 506, "status": "ready" },
    "collection-b": { "documents": 235, "status": "ready" }
  }
}
```

**Collection-Specific Reindexing:**
```bash
# Reindex specific collection (requires admin key)
curl -X POST http://localhost:3000/api/v1/admin/reindex \
  -H "Content-Type: application/json" \
  -H "x-admin-key: your-admin-secret-key-here" \
  -d '{"collection": "collection-b"}'
```

## 🐛 Debugging Locally

### 1. VS Code Debugger Setup

Create `.vscode/launch.json`:

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Debug API Server",
      "type": "node",
      "request": "launch",
      "program": "${workspaceFolder}/src/index.ts",
      "outFiles": ["${workspaceFolder}/dist/**/*.js"],
      "runtimeArgs": [
        "--loader",
        "tsx/esm"
      ],
      "env": {
        "NODE_ENV": "development",
        "LOG_LEVEL": "debug"
      },
      "console": "integratedTerminal",
      "skipFiles": ["<node_internals>/**"]
    },
    {
      "name": "Debug Seed Script",
      "type": "node",
      "request": "launch",
      "program": "${workspaceFolder}/scripts/seed.ts",
      "runtimeArgs": [
        "--loader",
        "tsx/esm"
      ],
      "env": {
        "NODE_ENV": "development",
        "LOG_LEVEL": "debug"
      },
      "console": "integratedTerminal"
    }
  ]
}
```

### 2. Enable Debug Logging

```bash
# Run with debug logs
DEBUG=* npm run dev

# Or set in .env file
LOG_LEVEL=debug
```

### 3. Inspect Database Logs

```bash
# If using Docker Compose
docker-compose logs postgres

# If using local PostgreSQL, check logs at:
# macOS: /usr/local/var/log/postgresql@14.log
# Linux: /var/log/postgresql/postgresql-14-main.log
# Windows: Check PostgreSQL data directory
```

### 4. Test API Endpoints

```bash
# Test health endpoint
curl -X GET http://localhost:3000/health

# Test ask endpoint
curl -X POST http://localhost:3000/api/v1/ask \
  -H "Content-Type: application/json" \
  -d '{
    "query": "How do I configure the system?",
    "prefer_steps": true
  }'

# Expected JSON response:
{
  "answer": "# System Configuration\n\n## Steps\n1. Access the system\n2. Navigate to the settings section\n3. Configure the settings as needed",
  "summary": "Step-by-step instructions for configuration...",
  "steps": [
    "Access the system",
    "Navigate to the settings section", 
    "Configure the settings as needed"
  ],
  "citations": [
    {
      "title": "Documentation",
      "url": "https://docs.example.com/"
    }
  ],
  "retrieved_docs": [
    {
      "id": "mock-doc-1",
      "score": 0.95,
      "excerpt": "Mock document excerpt..."
    }
  ]
}
```

### 5. Admin Endpoints (Protected)

```bash
# Trigger reindexing (requires admin key)
curl -X POST http://localhost:3000/api/v1/admin/reindex \
  -H "Content-Type: application/json" \
  -H "x-admin-key: your-admin-secret-key-here"
```

## 🧪 RAG Pipeline Testing

The RAG (Retrieval-Augmented Generation) implementation provides intelligent question-answering using the documentation. This section covers comprehensive testing of the RAG pipeline.

### 1. Automated RAG Testing Script

The project includes a comprehensive test script that validates the entire RAG pipeline:

```bash
# Run the automated RAG test suite
node test-rag-implementation.js
```

**What the test script validates:**
- ✅ Server health and connectivity
- ✅ RAG pipeline initialization
- ✅ Query processing and response generation
- ✅ Response structure and format
- ✅ Markdown formatting compliance
- ✅ Citation and reference handling
- ✅ Retrieved document metadata

### 2. Test Query Examples

The test suite includes three different query types that demonstrate the RAG capabilities:

**Configuration Query (Step-by-step format):**
```bash
curl -X POST http://localhost:3000/api/v1/ask \
  -H "Content-Type: application/json" \
  -d '{
    "query": "How do I configure the system?",
    "prefer_steps": true,
    "max_tokens": 1500,
    "userId": "test-user-1"
  }'
```

**Administrative Query (Step-by-step format):**
```bash
curl -X POST http://localhost:3000/api/v1/ask \
  -H "Content-Type: application/json" \
  -d '{
    "query": "How do I add new users?",
    "prefer_steps": true,
    "max_tokens": 1500,
    "userId": "test-user-2"
  }'
```

**General Information Query (Overview format):**
```bash
curl -X POST http://localhost:3000/api/v1/ask \
  -H "Content-Type: application/json" \
  -d '{
    "query": "What is the system overview?",
    "prefer_steps": false,
    "max_tokens": 1500,
    "userId": "test-user-3"
  }'
```

### 3. Expected Response Structure

A successful RAG response follows this JSON structure:

```json
{
  "answer": "# System Configuration\n\n## Summary\nThis guide explains how to configure the system...\n\n## Steps\n1. Navigate to Settings\n2. Click on Configuration\n3. Update your settings\n\n## References\n- [Documentation](https://docs.example.com/)",
  
  "summary": "Configure the system by navigating to Settings and managing the configuration.",
  
  "steps": [
    "Navigate to Settings",
    "Click on Configuration",
    "Update your settings according to requirements"
  ],
  
  "citations": [
    {
      "title": "Documentation",
      "url": "https://docs.example.com/configuration"
    }
  ],
  
  "retrieved_docs": [
    {
      "id": "doc_12345",
      "score": 0.892,
      "excerpt": "Configuration settings are used to customize the system..."
    }
  ]
}
```

### 4. Response Quality Validation

The test script validates several quality metrics:

**Required Fields:**
- ✅ `answer` - Full markdown-formatted response
- ✅ `summary` - 1-2 sentence summary
- ✅ `citations` - Source references with URLs
- ✅ `retrieved_docs` - Vector search results

**Content Quality Checks:**
- ✅ Markdown headings present (`#`, `##`)
- ✅ Summary section included
- ✅ References section with valid URLs
- ✅ Step-by-step format when requested
- ✅ Minimum response length validation
- ✅ Proper citation structure

**Performance Metrics:**
- ✅ Response time tracking
- ✅ Retrieved document count
- ✅ Similarity scores
- ✅ Token usage monitoring

### 5. Manual Testing Workflow

For manual testing and development:

```bash
# 1. Start the development server
npm run dev

# 2. Test server health
curl http://localhost:3000/health

# 3. Test basic query
curl -X POST http://localhost:3000/api/v1/ask \
  -H "Content-Type: application/json" \
  -d '{"query":"test question"}'

# 4. Test with different parameters
curl -X POST http://localhost:3000/api/v1/ask \
  -H "Content-Type: application/json" \
  -d '{
    "query": "How do I perform an action?",
    "prefer_steps": true,
    "max_tokens": 2000
  }'

# 5. Check server logs for detailed pipeline execution
```

### 6. RAG Pipeline Components Testing

**Testing Individual Components:**

**Embedding Generation:**
```bash
# The RAG pipeline logs show embedding generation
# Look for: "RAG Pipeline: Starting document retrieval..."
```

**Vector Search:**
```bash
# Check retrieved documents in the response
# Higher scores (closer to 1.0) indicate better relevance
```

**LLM Response Generation:**
```bash
# Monitor: "RAG Pipeline: Generating LLM response..."
# Check response quality and format compliance
```

**Context Building:**
```bash
# Verify context assembly from retrieved documents
# Check token usage: "contextTokens" in logs
```

### 7. Performance Benchmarks

Expected performance metrics:

| Metric | Good | Acceptable | Needs Investigation |
|--------|------|------------|-------------------|
| Response Time | < 3 seconds | < 5 seconds | > 5 seconds |
| Retrieved Docs | 5-10 docs | 3-15 docs | < 3 or > 15 docs |
| Top Score | > 0.8 | > 0.6 | < 0.6 |
| Answer Length | 500-2000 chars | 200-3000 chars | < 200 or > 3000 |

### 8. Troubleshooting RAG Issues

**Common RAG Pipeline Errors:**

#### "Embedding generation failed"
```bash
# Cause: AI provider authentication issues
# Solutions:
1. Check API keys in .env file
2. Verify provider has sufficient credits
3. Check model availability in your region
4. Test with alternative provider (switch EMBEDDING_PROVIDER)
```

#### "No relevant documents found"
```bash
# Cause: Empty vector database or poor query matching
# Solutions:
1. Verify database was seeded: npm run seed
2. Check vector count: SELECT COUNT(*) FROM documents;
3. Lower similarity threshold in query
4. Try broader search terms
```

#### "Vector search failed"
```bash
# Cause: Database connectivity or pgvector issues
# Solutions:
1. Check PostgreSQL is running
2. Verify pgvector extension: SELECT * FROM pg_extension;
3. Test database connection: npm run db:migrate
4. Check DATABASE_URL in .env
```

#### "LLM generation timeout"
```bash
# Cause: AI provider latency or model overload
# Solutions:
1. Increase timeout in RAG configuration
2. Switch to faster model (e.g., claude-3-haiku)
3. Reduce max_tokens parameter
4. Check provider status pages
```

### 9. RAG Configuration Tuning

**Environment variables for RAG optimization:**

```env
# Embedding Configuration
EMBEDDING_MODEL=amazon.titan-embed-text-v2:0  # Fast, good quality
# EMBEDDING_MODEL=amazon.titan-embed-text-v1    # Alternative

# LLM Configuration
LLM_MODEL=anthropic.claude-3-haiku-20240307-v1:0  # Fast, cost-effective
# LLM_MODEL=anthropic.claude-3-sonnet-20240229-v1:0  # Balanced
# LLM_MODEL=anthropic.claude-3-opus-20240229-v1:0    # Highest quality

# Response Configuration
MAX_TOKENS=1500          # Balance between detail and speed
MAX_QUERY_LENGTH=1000    # Prevent overly long queries

# Vector Search Configuration
# These are set in the RAG pipeline code:
# TOP_K=10                # Number of documents to retrieve
# SIMILARITY_THRESHOLD=0.7 # Minimum relevance score
# CONTEXT_WINDOW_TOKENS=3000 # Context size for LLM
```

### 10. Quality Assurance Testing

**Pre-deployment Checklist:**

```bash
# 1. Run full test suite
node test-rag-implementation.js

# 2. Test with edge cases
curl -X POST http://localhost:3000/api/v1/ask \
  -d '{"query":""}' # Empty query
curl -X POST http://localhost:3000/api/v1/ask \
  -d '{"query":"very obscure technical question that probably has no answer"}' # No results

# 3. Test different response formats
curl -X POST http://localhost:3000/api/v1/ask \
  -d '{"query":"How to configure the system?","prefer_steps":true}' # Steps format
curl -X POST http://localhost:3000/api/v1/ask \
  -d '{"query":"What is the system?","prefer_steps":false}' # Overview format

# 4. Verify citation accuracy
# Check that URLs in citations are valid documentation links

# 5. Performance testing
# Run multiple concurrent requests to test under load
```

**Success Criteria:**
- ✅ All automated tests pass
- ✅ Response time < 5 seconds
- ✅ Proper markdown formatting
- ✅ Relevant document retrieval (score > 0.6)
- ✅ Valid citations with working URLs
- ✅ No error responses for valid queries

## 🔗 Slack App Integration

This API service includes comprehensive Slack integration capabilities for message handling, event subscriptions, and command interactions. Follow these steps to set up your Slack app and configure the integration.

### 1. Create and Configure Slack App

#### Step 1: Create New Slack App

1. Visit **[Slack API Apps](https://api.slack.com/apps)** in your browser
2. Click **"Create New App"**
3. Choose **"From scratch"**
4. Provide:
   - **App Name**: `AI Documentation Assistant` (or your preferred name)
   - **Workspace**: Select your development workspace
5. Click **"Create App"**

#### Step 2: Configure OAuth & Permissions

Navigate to **"OAuth & Permissions"** in the left sidebar and add the following **Bot Token Scopes**:

**Required Scopes:**
- `chat:write` - Send messages as the bot
- `app_mentions:read` - Listen for @mentions
- `im:history` - Read direct message history
- `commands` - Add slash commands

**Optional but Recommended:**
- `channels:history` - Read public channel messages (if needed)
- `groups:history` - Read private channel messages (if needed)
- `users:read` - Get user information for better responses

#### Step 3: Install App to Workspace

1. Scroll to **"OAuth Tokens for Your Workspace"**
2. Click **"Install to Workspace"**
3. Review permissions and click **"Allow"**
4. **Copy the Bot User OAuth Token** (starts with `xoxb-`) - you'll need this for your environment

### 2. Configure Event Subscriptions

#### Step 1: Enable Event Subscriptions

1. Navigate to **"Event Subscriptions"** in the left sidebar
2. **Toggle "Enable Events" to ON**
3. Set **Request URL** to: `https://your-domain.com/slack/events`
   - Replace `your-domain.com` with your actual domain/ngrok URL
   - The API will automatically handle URL verification challenges

#### Step 2: Subscribe to Bot Events

Add the following **Bot Events**:
- `app_mention` - When users @mention your bot
- `message.im` - Direct messages to your bot
- `message.channels` - Messages in channels (optional)

#### Step 3: Save Changes

Click **"Save Changes"** - Slack will verify your endpoint

### 3. Configure Slash Commands

#### Step 1: Create Slash Command

1. Navigate to **"Slash Commands"** in the left sidebar
2. Click **"Create New Command"**
3. Configure the command:
   - **Command**: `/ask` (or your preferred name)
   - **Request URL**: `https://your-domain.com/slack/command`
   - **Short Description**: `Ask documentation questions`
   - **Usage Hint**: `[your question]`

#### Step 2: Save Command

Click **"Save"** to create the slash command.

### 4. Enable Interactive Components

#### Step 1: Enable Interactivity

1. Navigate to **"Interactivity & Shortcuts"** in the left sidebar
2. **Toggle "Interactivity" to ON**
3. Set **Request URL** to: `https://your-domain.com/slack/actions`

This enables interactive buttons like "Show Sources" and "Ask Follow-up" in bot responses.

### 5. Environment Configuration

Add the following environment variables to your `.env` file:

```env
# Slack Configuration
SLACK_BOT_TOKEN=xoxb-your-bot-token-here
SLACK_SIGNING_SECRET=your-signing-secret-here
SLACK_APP_TOKEN=xapp-your-app-token-here

# Optional: Restrict to specific workspaces
SLACK_VERIFIED_WORKSPACES=T1234567890,T0987654321
```

#### Where to Find These Values:

**SLACK_BOT_TOKEN:**
- Go to **"OAuth & Permissions"** → Copy **"Bot User OAuth Token"**

**SLACK_SIGNING_SECRET:**
- Go to **"Basic Information"** → **"App Credentials"** → Copy **"Signing Secret"**

**SLACK_APP_TOKEN:** (Optional, for Socket Mode)
- Go to **"Basic Information"** → **"App-Level Tokens"** → Generate token with `connections:write` scope

### 6. API Endpoints Overview

The service provides the following Slack endpoints:

| Endpoint | Method | Purpose | Slack Configuration |
|----------|--------|---------|-------------------|
| `/slack/events` | POST | Event subscriptions | Event Subscriptions → Request URL |
| `/slack/command` | POST | Slash commands | Slash Commands → Request URL |
| `/slack/actions` | POST | Interactive components | Interactivity → Request URL |
| `/slack/health` | GET | Health check | Internal monitoring |

### 7. Testing Your Integration

#### Test Event Subscriptions

1. **Invite your bot to a channel:**
   ```
   /invite @your-bot-name
   ```

2. **Mention your bot:**
   ```
   @your-bot-name How do I configure the system?
   ```

3. **Send a direct message:**
   - Open DM with your bot
   - Send: `What is the system overview?`

#### Test Slash Commands

```
/ask How do I add new users?
```

#### Test Interactive Components

- Click **"📋 Show Sources"** button on any bot response
- Click **"🔄 Ask Follow-up"** button to continue the conversation

### 8. Advanced Configuration

#### Collection-Specific Queries

The bot supports collection-specific queries:

```
# Query specific collections
collection-a: How do I configure settings?
collection-b: How do I create items?
both: How do I sync data between systems?
```

#### Channel-Based Collection Hints

Name your channels to get automatic collection routing:
- `#collection-a-help` → Automatically searches Collection A docs
- `#collection-b-support` → Automatically searches Collection B docs

#### Rate Limiting

The service includes built-in rate limiting:
- **10 requests per minute per user** (configurable)
- **5-minute request timestamp validation** (prevents replay attacks)
- **Workspace verification** (optional, configured via `SLACK_VERIFIED_WORKSPACES`)

### 9. Troubleshooting

#### Common Issues:

**"URL verification failed"**
- Ensure your server is accessible via HTTPS
- Check that `/slack/events` endpoint returns the challenge correctly
- Verify `SLACK_SIGNING_SECRET` is correct

**"Bot doesn't respond to mentions"**
- Verify bot is invited to the channel
- Check bot has `app_mentions:read` scope
- Ensure `SLACK_BOT_TOKEN` is valid

**"Slash command doesn't work"**
- Verify `/slack/command` endpoint is accessible
- Check command configuration in Slack app settings
- Ensure request signature validation is working

#### Debug Endpoints:

```bash
# Check Slack integration health
curl https://your-domain.com/slack/health

# Expected healthy response:
{
  "status": "healthy",
  "components": {
    "slack": true,
    "ragPipeline": true
  }
}
```

### 10. Production Deployment

#### Security Checklist:

- ✅ Use HTTPS for all endpoints
- ✅ Validate Slack request signatures
- ✅ Implement rate limiting
- ✅ Restrict to verified workspaces (if needed)
- ✅ Store tokens securely (environment variables)
- ✅ Monitor error logs and API usage

#### Performance Tips:

- The service processes Slack events **asynchronously** (responds within 3 seconds)
- RAG pipeline responses are cached for better performance
- Database queries are optimized with proper indexing
- Consider horizontal scaling for high-volume workspaces

### 11. Integration Examples

#### Slack Workflow for Support Teams:

```
User Query → Slack Bot → RAG Pipeline → Documentation → Formatted Response
                ↓
          Log to Support System (optional)
```

#### Multi-Channel Setup:

- **#collection-a-help**: Collection A questions and support
- **#collection-b-support**: Collection B questions
- **#general-help**: Mixed questions, bot determines appropriate collection

---

### 12. Interactive Features

The AI Assistant now includes interactive features that enhance user experience with every bot response.

#### Interactive Buttons

Every bot response includes two interactive buttons:

**📋 Show Sources Button:**
- Displays a modal with all source documents used for the response
- Shows document titles, relevance scores, and clickable URLs
- Includes truncated excerpts for quick scanning
- Provides "Copy all links" functionality for easy reference

**🔄 Ask Follow-up Button:**
- Opens a modal for users to ask follow-up questions
- Maintains context from the original response
- Posts threaded replies to keep conversations organized
- Includes interactive buttons on follow-up responses for continued conversation

#### How Interactive Features Work

```
User Query → Bot Response with Sources → User Clicks "Show Sources"
     ↓                                           ↓
Auto-cached for                           Modal displays:
1 hour with TTL                          • Source documents
                                        • Relevance scores
                                        • Clickable URLs
                                        
User Query → Bot Response → User Clicks "Ask Follow-up"
     ↓                              ↓
Context preserved            Modal for follow-up question
     ↓                              ↓
Original sources            Enhanced context sent to RAG
included in                 pipeline with original response
follow-up context           and sources
```

#### Example Interactive Workflow

1. **Initial Query:**
   ```
   @AI-Bot How do I configure the system?
   ```

2. **Bot Response with Buttons:**
   - Detailed answer with step-by-step instructions
   - **📋 Show Sources** button - click to see source documents
   - **🔄 Ask Follow-up** button - click to continue conversation

3. **Show Sources Modal:**
   - Lists all documentation used
   - Shows relevance scores (e.g., "95% match")
   - Provides direct links to documentation pages
   - Option to copy all URLs for reference

4. **Follow-up Conversation:**
   - User clicks "Ask Follow-up" → Modal opens
   - User types: "What about advanced settings?"
   - Bot provides contextual response in thread
   - Follow-up response also includes interactive buttons

#### Source Caching and Performance

- **Automatic Caching:** Sources are cached for 1 hour after each response
- **Efficient Storage:** In-memory cache with TTL (Time To Live) expiration
- **Future-Ready:** TODO added for Redis/DB migration for production scale
- **Memory Management:** Automatic cleanup of expired entries every 5 minutes

#### Technical Implementation

The interactive features utilize:
- **Slack Block Kit** for rich UI components
- **Modal Views** for source display and follow-up input
- **Threaded Messaging** for organized conversations
- **Source Caching** for quick modal loading
- **Enhanced Context Building** for intelligent follow-ups

#### User Experience Benefits

✅ **Immediate Source Access** - Users can verify information instantly
✅ **Seamless Follow-ups** - Continue conversations without losing context
✅ **Organized Threads** - Follow-up responses appear in organized threads
✅ **Reference Documentation** - Easy access to original documentation
✅ **Improved Trust** - Transparent source attribution builds confidence

**🎉 Your AI Assistant is now ready with Interactive Features!**

Users can now get instant, accurate answers to documentation questions directly in Slack through @mentions, DMs, or slash commands, with enhanced interactivity for source verification and follow-up conversations.

## 🧪 Slack Integration Testing

The service includes a comprehensive end-to-end test suite that validates the complete Slack integration workflow from HTTP requests to Slack API responses.

### 1. Running Slack E2E Tests

```bash
# Run the complete Slack e2e test suite
npm run test:e2e

# Run with verbose output
npm run test:e2e -- --verbose

# Run with watch mode during development
npm run test:e2e:watch
```

### 2. Test Coverage and Results

The Slack e2e test suite validates **17 comprehensive test scenarios** covering all major integration points:

**✅ All 17 Tests Passing (100% Success Rate)**

#### Event Processing Tests (7 tests)
- **URL Verification** - Slack app installation and webhook validation
- **App Mention Events** - @bot mentions in channels with RAG responses
- **Invalid Signature Handling** - Security validation and request authentication
- **Replay Attack Prevention** - Timestamp validation for security
- **Direct Message Events** - Private message handling
- **Unsupported Event Types** - Graceful handling of unrecognized events
- **Invalid Event Rejection** - Proper error responses for malformed events

#### Command Processing Tests (2 tests)
- **Slash Command Processing** - `/ask` command with queries
- **Empty Command Handling** - Graceful handling of commands without text

#### Interactive Components Tests (2 tests)
- **Button Click Actions** - "Show Sources" and "Ask Follow-up" buttons
- **Malformed Payload Handling** - Error handling for invalid action data

#### Error Handling Tests (2 tests)
- **Unsupported Command Graceful Handling** - Non-specific queries
- **Missing Configuration Recovery** - Service resilience testing

#### Health Monitoring Tests (2 tests)
- **Healthy Status Reporting** - Component health when properly configured
- **Unhealthy Status Detection** - Configuration validation and error reporting

#### Integration Workflow Tests (2 tests)
- **Complete RAG Pipeline** - Full workflow from query to formatted response
- **Rate Limiting Scenarios** - User-based request throttling validation

### 3. Test Architecture and Components

#### Security Validation
```typescript
// Signature validation for all request types
- JSON Events: Validates Slack request signatures for event payloads
- Form Commands: Validates URL-encoded slash command signatures
- Interactive Actions: Validates button click and form submission signatures
- Timestamp Validation: Prevents replay attacks (5-minute window)
```

#### RAG Pipeline Integration
```typescript
// Complete workflow testing
Event Receipt → Signature Validation → RAG Processing → Response Formatting → Slack API Call
     ↓              ↓                    ↓                ↓                   ↓
   ✅ 3sec       ✅ Security        ✅ Vector Search   ✅ Markdown       ✅ Interactive
   Response      Validated          Document Retrieval  Formatting        Buttons
```

#### Mock and Isolation Testing
```typescript
// Isolated component testing with mocks
- Slack Web API: Mocked for response validation
- RAG Pipeline: Mocked with realistic responses
- Vector Store: Mocked for consistent test results
- External APIs: Mocked to prevent external dependencies
```

### 4. Test Configuration

The test suite uses isolated configuration to prevent interference:

```typescript
// Test environment configuration
const TEST_CONFIG = {
  SLACK_BOT_TOKEN: 'xoxb-test-token-123456789',
  SLACK_SIGNING_SECRET: 'test_signing_secret_abcdef123456',
  SLACK_APP_TOKEN: 'xapp-test-token-123456789',
  DATABASE_URL: 'postgresql://test:test@localhost:5432/test_db',
  LLM_PROVIDER: 'bedrock',
  EMBEDDING_PROVIDER: 'bedrock',
  LOG_LEVEL: 'error', // Minimized test noise
  ADMIN_API_KEY: 'test-admin-key-123456789'
};
```

### 5. Test Validation Points

Each test validates multiple aspects of the integration:

#### Request/Response Validation
- ✅ **HTTP Status Codes** - Correct response codes for various scenarios
- ✅ **Response Structure** - Proper JSON format and required fields
- ✅ **Slack API Calls** - Verification of outbound Slack Web API usage
- ✅ **Interactive Components** - Button rendering and webhook responses

#### Security and Error Handling
- ✅ **Signature Validation** - Cryptographic request verification
- ✅ **Rate Limiting** - User-based request throttling
- ✅ **Input Sanitization** - Safe handling of user input
- ✅ **Error Recovery** - Graceful degradation for various failure modes

#### Business Logic Validation
- ✅ **RAG Pipeline Execution** - End-to-end query processing
- ✅ **Collection Routing** - Proper knowledge base selection
- ✅ **Response Formatting** - Markdown and step-by-step formatting
- ✅ **Citation Generation** - Proper source attribution

### 6. Performance and Quality Metrics

The test suite validates performance characteristics:

| Metric | Target | Test Validation |
|--------|--------|----------------|
| **Response Time** | < 3 sec | Event acknowledgment within Slack requirements |
| **Async Processing** | < 5 sec | Background RAG pipeline completion |
| **Signature Validation** | < 100ms | Security validation performance |
| **Memory Usage** | Stable | No memory leaks during test execution |
| **Error Rate** | 0% | All error scenarios handled gracefully |

### 7. Debugging Test Failures

#### Enable Debug Output
```bash
# Run tests with detailed logging
DEBUG_SLACK_TESTS=true npm run test:e2e -- --verbose

# Enable detection of async operations
npm run test:e2e -- --detectOpenHandles
```

#### Common Test Issues

**Signature Validation Failures:**
```bash
# Issue: Different encoding between test and production
# Solution: Test uses exact encoding reconstruction for form data
# Files: src/api/routes/slack.ts (validateSlackSignature middleware)
```

**Timeout Issues:**
```bash
# Issue: Async processing not completing within test timeouts
# Solution: Tests wait for async completion with proper timing
# Configuration: testTimeout: 30000 in jest.e2e.config.js
```

**Environment Conflicts:**
```bash
# Issue: Test environment interfering with development environment
# Solution: Isolated test configuration set before module imports
# Files: tests/slack-e2e.test.ts (TEST_CONFIG setup)
```

### 8. Continuous Integration

The test suite is designed for CI/CD environments:

```bash
# CI-friendly test execution
npm run test:e2e -- --ci --forceExit --detectOpenHandles

# Coverage reporting
npm run test:e2e -- --coverage --coverageDirectory=coverage-e2e

# JUnit XML output for CI systems
npm run test:e2e -- --reporters=jest-junit
```

### 9. Test Maintenance

#### Adding New Test Scenarios
```typescript
// Location: tests/slack-e2e.test.ts
// Pattern: Follow existing test structure with proper mocking
// Requirements: Use SlackTestUtils for signature generation
// Validation: Ensure proper async/await handling
```

#### Updating Test Payloads
```json
// Location: tests/slack-test-payloads.json
// Purpose: Realistic Slack event payloads for testing
// Maintenance: Update when Slack API evolves
```

### 10. Quality Assurance Results

**Final Test Results Summary:**
- ✅ **17/17 Tests Passing** (100% success rate)
- ✅ **All Security Tests Pass** - Signature validation, replay protection
- ✅ **All Integration Tests Pass** - Complete RAG workflow validation
- ✅ **All Error Handling Tests Pass** - Graceful failure recovery
- ✅ **Performance Within Targets** - Response times under 5 seconds
- ✅ **Zero Test Flakiness** - Consistent results across runs

**Coverage Areas Validated:**
- 🔒 **Security**: Request signature validation, timestamp verification
- 🤖 **AI Integration**: RAG pipeline execution, response formatting
- 💬 **Slack Features**: Events, commands, interactive components
- 🚨 **Error Handling**: Invalid inputs, missing configuration, rate limits
- 📊 **Monitoring**: Health checks, component status reporting
- ⚡ **Performance**: Async processing, response timing

The comprehensive test suite ensures the Slack integration is production-ready with full confidence in security, reliability, and user experience.

## 🤖 Microsoft Teams Integration

The AI Assistant provides native Microsoft Teams integration through the Bot Framework, offering the same intelligent question-answering capabilities with Teams-specific interactive components.

### 1. Prerequisites for Teams Integration

#### Microsoft Azure Account
- Access to [Azure Portal](https://portal.azure.com/)
- Permissions to create App Registrations
- Access to Microsoft Teams (for testing)

#### Bot Framework Setup
- Understanding of Microsoft Bot Framework concepts
- Familiarity with Azure AD app registration process

### 2. Create and Configure Azure AD App Registration

#### Step 1: Create New App Registration

1. Navigate to **[Azure Portal](https://portal.azure.com/)**
2. Go to **Azure Active Directory** → **App registrations**
3. Click **"New registration"**
4. Configure:
   - **Name**: `AI Assistant Bot`
   - **Supported account types**: Select based on your organization needs
   - **Redirect URI**: Leave blank for now
5. Click **"Register"**

#### Step 2: Generate Client Secret

1. In your new app registration, go to **"Certificates & secrets"**
2. Click **"New client secret"**
3. Configure:
   - **Description**: `AI Bot Secret`
   - **Expires**: Choose appropriate duration (12-24 months recommended)
4. Click **"Add"**
5. **Copy the secret value immediately** - you won't be able to see it again

#### Step 3: Configure API Permissions

1. Go to **"API permissions"**
2. Click **"Add a permission"**
3. No additional permissions are typically required for basic bot functionality
4. Default permissions are sufficient for Teams messaging

### 3. Create Microsoft Teams Bot

#### Step 1: Register Bot with Bot Framework

1. Visit **[Bot Framework Portal](https://dev.botframework.com/)**
2. Click **"Create a Bot"** → **"Register an existing bot built using Bot Framework SDK"**
3. Configure:
   - **Bot handle**: `ai-assistant` (must be unique)
   - **Display name**: `AI Assistant`
   - **Description**: `AI-powered assistant for documentation`
   - **Icon**: Upload your bot icon (optional)
   - **Messaging endpoint**: `https://your-domain.com/teams/messages`
   - **Microsoft App ID**: Use the Application ID from your Azure AD app registration

#### Step 2: Configure Teams Channel

1. In the Bot Framework portal, go to your bot's **"Channels"** section
2. Click **"Microsoft Teams"** channel
3. Click **"Save"** to enable Teams integration
4. The Teams channel should show as "Running"

### 4. Environment Configuration for Teams

Add the following environment variables to your `.env` file:

```env
# Microsoft Teams Configuration
TEAMS_APP_ID=12345678-1234-1234-1234-123456789012  # From Azure AD App Registration
TEAMS_APP_PASSWORD=your-client-secret-value-here    # From Azure AD Client Secret
TEAMS_VERIFIED_TENANTS=tenant-id-1,tenant-id-2     # Optional: Restrict to specific tenants
```

#### Where to Find These Values:

**TEAMS_APP_ID:**
- Azure Portal → Azure AD → App registrations → Your app → **"Application (client) ID"**

**TEAMS_APP_PASSWORD:**
- Azure Portal → Azure AD → App registrations → Your app → Certificates & secrets → **Client secret value**

**TEAMS_VERIFIED_TENANTS** (Optional):
- Azure Portal → Azure AD → **"Tenant ID"** (if you want to restrict access)

### 5. Install Bot in Microsoft Teams

#### Step 1: Create App Manifest

Create a `manifest.json` file for your Teams app:

```json
{
  "$schema": "https://developer.microsoft.com/en-us/json-schemas/teams/v1.16/MicrosoftTeams.schema.json",
  "manifestVersion": "1.16",
  "version": "1.0.0",
  "id": "12345678-1234-1234-1234-123456789012",
  "packageName": "com.example.ai.assistant",
  "developer": {
    "name": "Your Organization",
    "websiteUrl": "https://your-website.com",
    "privacyUrl": "https://your-website.com/privacy",
    "termsOfUseUrl": "https://your-website.com/terms"
  },
  "icons": {
    "color": "color.png",
    "outline": "outline.png"
  },
  "name": {
    "short": "AI Assistant",
    "full": "AI Documentation Assistant"
  },
  "description": {
    "short": "AI assistant for documentation",
    "full": "Get instant answers to documentation questions with AI-powered search"
  },
  "accentColor": "#0078D4",
  "bots": [
    {
      "botId": "12345678-1234-1234-1234-123456789012",
      "scopes": [
        "personal",
        "team",
        "groupchat"
      ],
      "supportsFiles": false,
      "isNotificationOnly": false
    }
  ],
  "permissions": [
    "identity",
    "messageTeamMembers"
  ],
  "validDomains": [
    "your-domain.com"
  ]
}
```

#### Step 2: Package and Install

1. Create a ZIP file with:
   - `manifest.json`
   - `color.png` (192x192 pixels)
   - `outline.png` (32x32 pixels, transparent background)

2. Install in Teams:
   - **Teams Admin Center**: Upload to your organization's app catalog
   - **Developer Portal**: Use Teams Developer Portal for testing
   - **Sideload**: For development (requires developer preview)

### 6. Teams API Endpoints

The service provides the following Teams endpoints:

| Endpoint | Method | Purpose | Teams Configuration |
|----------|--------|---------|-------------------|
| `/teams/messages` | POST | Bot Framework activities | Bot Registration → Messaging endpoint |
| `/teams/health` | GET | Health check | Internal monitoring |

### 7. Testing Your Teams Integration

#### Test Basic Messaging

1. **Start a chat with your bot:**
   ```
   Find your bot in Teams and start a 1:1 chat
   ```

2. **Send a message:**
   ```
   How do I configure the system?
   ```

3. **Test in a team channel:**
   ```
   @AI Assistant What is the system overview?
   ```

#### Test Interactive Components

- Click **"🔍 Show Sources"** button on any bot response
- Click **"💬 Ask Follow-up"** button to continue the conversation
- Fill out and submit the follow-up form

### 8. Teams-Specific Features

#### Adaptive Cards
- Rich interactive components native to Teams
- Action buttons with contextual data
- Form inputs for follow-up questions
- Dynamic content with confidence indicators

#### Bot Framework Actions
- **Invoke Activities**: Synchronous responses to button clicks
- **Form Submissions**: Structured data collection
- **Typing Indicators**: Enhanced user experience during processing

#### Multi-Conversation Support
- **Personal Chats**: 1:1 conversations with the bot
- **Team Channels**: @mentions in team channels
- **Group Chats**: Multi-person conversations

### 9. Advanced Configuration

#### Collection-Specific Queries

Same as Slack, Teams supports collection-specific queries:

```
collection-a: How do I configure settings?
collection-b: How do I create items?
both: How do I sync data between systems?
```

#### Tenant-Based Security

Configure tenant restrictions for enterprise security:

```env
# Restrict to specific tenants (optional)
TEAMS_VERIFIED_TENANTS=72f988bf-86f1-41af-91ab-2d7cd011db47,contoso-tenant-id
```

#### Rate Limiting

Teams integration includes the same rate limiting as Slack:
- **10 requests per minute per user** (configurable)
- **Bot Framework authentication** validation
- **Tenant verification** (if configured)

### 10. Troubleshooting Teams Integration

#### Common Issues:

**"Bot doesn't respond in Teams"**
- Verify bot is properly installed in the team/chat
- Check `TEAMS_APP_ID` and `TEAMS_APP_PASSWORD` are correct
- Ensure messaging endpoint URL is accessible via HTTPS
- Verify Bot Framework registration is active

**"Authentication failed"**
- Check Azure AD app registration settings
- Verify client secret hasn't expired
- Ensure Bot Framework registration uses correct App ID
- Test authentication with Teams health endpoint

**"Adaptive Cards not displaying"**
- Verify card JSON structure follows Adaptive Cards schema
- Check for unsupported elements in your Teams version
- Test cards in [Adaptive Cards Designer](https://adaptivecards.io/designer/)

#### Debug Endpoints:

```bash
# Check Teams integration health
curl https://your-domain.com/teams/health

# Expected healthy response:
{
  "status": "healthy",
  "components": {
    "orchestrator": true,
    "delivery": true,
    "ragPipeline": true
  }
}
```

### 11. Production Deployment

#### Security Checklist:

- ✅ Use HTTPS for all endpoints
- ✅ Validate Bot Framework JWT tokens
- ✅ Implement tenant restrictions (if needed)
- ✅ Store credentials securely (Azure Key Vault recommended)
- ✅ Monitor error logs and Bot Framework analytics
- ✅ Regular credential rotation

#### Performance Tips:

- Activities are processed **asynchronously** for quick acknowledgment
- Adaptive Cards are cached for better performance
- Database queries optimized with proper indexing
- Consider Azure Bot Service for production scaling

### 12. Architecture Benefits

#### Multi-Platform Unified Processing

Both Slack and Teams integrate through the same unified orchestrator:

```
Teams Activity → Teams Adapter → Unified Orchestrator → RAG Pipeline
      ↓              ↓                    ↓                 ↓
Slack Event → Slack Adapter → Unified Orchestrator → RAG Pipeline
```

This architecture ensures:
- ✅ **Consistent Responses**: Same AI processing for both platforms
- ✅ **Shared Knowledge Base**: Single source of truth for documentation
- ✅ **Unified Monitoring**: Centralized metrics and logging
- ✅ **Easy Maintenance**: Single codebase for core functionality

---

**🎉 Your AI Assistant is now ready for Microsoft Teams!**

Users can get instant, accurate answers to documentation questions directly in Teams through @mentions, private chats, or team conversations, with rich interactive components powered by Adaptive Cards.

## 🚨 Troubleshooting

### Common Errors

#### "pgvector not installed"
```bash
# Error: extension "vector" is not available
# Solution varies by OS:

# macOS
brew install pgvector

# Ubuntu/Debian
sudo apt install postgresql-14-pgvector

# Or compile from source
git clone https://github.com/pgvector/pgvector.git
cd pgvector
make && sudo make install
```

#### "API key missing"
```bash
# Error: API key is required
# Solutions:
1. Check .env file exists: ls -la .env
2. Verify API key format
3. Restart server after env changes
4. Check for extra spaces/quotes in .env
```

#### "Rate limit exceeded"
```bash
# Error: 429 Too Many Requests
# Solutions:
1. Wait for rate limit reset
2. Upgrade API provider plan
3. Reduce MAX_PAGES in .env
4. Increase CRAWL_DELAY_MS
5. Use alternative provider
```

#### "Database connection failed"
```bash
# Error: connect ECONNREFUSED 127.0.0.1:5432
# Solutions:
1. Start PostgreSQL service
2. Check DATABASE_URL in .env
3. Verify PostgreSQL is running on correct port
4. Check firewall settings
```

### Platform-Specific Fixes

#### macOS Issues
```bash
# Install missing dependencies
brew install postgresql pgvector node

# Fix permission issues
sudo chown -R $(whoami) /usr/local/var/postgres

# Restart PostgreSQL
brew services restart postgresql
```

#### Linux Issues
```bash
# Install dependencies
sudo apt update
sudo apt install postgresql postgresql-contrib postgresql-14-pgvector nodejs npm

# Fix service issues
sudo systemctl start postgresql
sudo systemctl enable postgresql
```

#### Windows Issues
```powershell
# Using Chocolatey
choco install postgresql nodejs

# Using winget
winget install PostgreSQL.PostgreSQL
winget install OpenJS.NodeJS

# Restart PostgreSQL service
net stop postgresql-x64-14
net start postgresql-x64-14
```

### Reset Database and Reseed

```bash
# Option 1: Drop and recreate database
psql -U postgres -c "DROP DATABASE IF EXISTS qlarity_rag;"
psql -U postgres -c "CREATE DATABASE qlarity_rag;"

# Run migrations and seed
npm run db:migrate
npm run seed

# Option 2: Use rollback script
npm run db:migrate rollback
npm run db:migrate
npm run seed

# Option 3: Clear documents table only
psql -U postgres -d qlarity_rag -c "TRUNCATE documents CASCADE;"
npm run seed
```

### Debug Environment Issues

```bash
# Check Node.js version
node --version  # Should be >= 18.0.0

# Check npm version
npm --version   # Should be >= 9.0.0

# Verify TypeScript compilation
npm run type-check

# Test database connection
psql -U postgres -d qlarity_rag -c "SELECT version();"

# Check pgvector installation
psql -U postgres -d qlarity_rag -c "SELECT * FROM pg_extension WHERE extname = 'vector';"

# Verify environment variables
npm run dev 2>&1 | grep -i "api key\|database"
```

## 📝 Final Notes

### Multi-Platform Development Best Practices

1. **Always run locally first** before deploying to production
2. **Start with a small dataset** (`MAX_PAGES=50`) for initial testing
3. **Enable debug logging** during development (`LOG_LEVEL=debug`)
4. **Test each component separately**:
   - Database connectivity (`/health`)
   - Document seeding (`npm run seed`)
   - API functionality (`/api/v1/ask`)
   - Platform integrations (`/slack/health`, `/teams/health`)

### Testing Workflow

```bash
# 1. Verify prerequisites
node --version && npm --version && psql --version

# 2. Setup environment
cp .env.example .env && nano .env

# 3. Setup database
npm run db:migrate

# 4. Seed with sample data
MAX_PAGES=10 npm run seed

# 5. Start development server
npm run dev

# 6. Test API
curl -X POST http://localhost:3000/api/v1/ask \
  -H "Content-Type: application/json" \
  -d '{"query":"test query"}'
```

### Monitoring and Logging

The service provides comprehensive multi-platform logging:

- **Request/Response logging**: All API calls with timing and platform context
- **Database query logging**: Vector search performance with collection filtering
- **Platform-specific logging**: Slack/Teams activity processing and delivery
- **Error tracking**: Detailed error messages with context and platform information
- **Health monitoring**: Real-time service status for all components
- **Unified orchestrator metrics**: Cross-platform processing statistics

### Performance Optimization

- **Vector similarity search** is optimized with IVFFlat indexes
- **Unified orchestrator** processes queries efficiently across platforms
- **Rate limiting** prevents API abuse across all endpoints
- **Response compression** reduces bandwidth for all platforms
- **Connection pooling** optimizes database performance
- **Platform-specific caching** enhances interactive component performance
- **Async processing** ensures fast response times for webhook endpoints

### Security Considerations

- **API key authentication** for admin endpoints
- **Multi-platform rate limiting** on all public endpoints
- **Platform-specific signature validation** (Slack HMAC, Teams JWT)
- **Input validation and sanitization** across all platforms
- **CORS configuration** for web integration
- **Helmet.js** for security headers
- **Tenant/workspace verification** for enterprise security

### Multi-Platform Architecture Benefits

✅ **Unified Processing**: Single RAG pipeline serves both Slack and Teams
✅ **Consistent Responses**: Same AI logic across platforms
✅ **Shared Knowledge Base**: Single source of truth for all platforms
✅ **Centralized Security**: Unified authentication and rate limiting
✅ **Scalable Design**: Easy to add new platforms (Discord, etc.)
✅ **Maintainable Codebase**: Platform adapters isolate platform-specific logic

---

**Need help?** Check the logs first, then review this troubleshooting guide. The service is designed to provide detailed error messages to help you debug issues quickly across all platforms.

**Ready for production?** Set `NODE_ENV=production`, configure proper DATABASE_URL and platform credentials, and deploy with a process manager like PM2 or Docker.

**Multi-Platform Deployment?** The unified architecture allows you to deploy once and serve multiple collaboration platforms simultaneously with consistent functionality and user experience.