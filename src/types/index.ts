/**
 * Core type definitions for the PowerSchool RAG API
 */

// Environment Configuration Types
export interface Environment {
  PORT: number;
  NODE_ENV: 'development' | 'production' | 'test';
  LOG_LEVEL: 'debug' | 'info' | 'warn' | 'error';
  DATABASE_URL: string;
  VECTOR_TABLE_NAME: string;
  OPENAI_API_KEY?: string | undefined;
  EMBEDDING_MODEL: string;
  LLM_MODEL: string;
  MAX_TOKENS: number;
  RATE_LIMIT_PER_MIN: number;
  MAX_QUERY_LENGTH: number;
  ADMIN_API_KEY: string;
  
  // Slack Configuration
  SLACK_SIGNING_SECRET?: string | undefined;
  SLACK_BOT_TOKEN?: string | undefined;
  SLACK_APP_TOKEN?: string | undefined;
  SLACK_VERIFIED_WORKSPACES?: string | undefined;
  
  // Microsoft Teams Configuration
  TEAMS_APP_ID?: string | undefined;
  TEAMS_APP_PASSWORD?: string | undefined;
  
  // n8n Webhook Configuration
  N8N_WEBHOOK_URL?: string | undefined;
  
  // Collection Configuration
  DEFAULT_COLLECTION: 'pssis-admin' | 'schoology';
  
  // PSSIS-Admin Configuration
  PSSIS_CRAWL_BASE_URL: string;
  PSSIS_CRAWL_DELAY_MS: number;
  PSSIS_MAX_PAGES: number;
  
  // Schoology Configuration
  SCHOOLOGY_CRAWL_BASE_URL: string;
  SCHOOLOGY_CRAWL_DELAY_MS: number;
  SCHOOLOGY_MAX_PAGES: number;
  
  // Legacy Configuration (for backward compatibility)
  CRAWL_BASE_URL: string;
  CRAWL_DELAY_MS: number;
  MAX_PAGES: number;
  
  OPENROUTER_API_KEY?: string | undefined;
  ANTHROPIC_API_KEY?: string | undefined;
  AWS_ACCESS_KEY_ID?: string | undefined;
  AWS_SECRET_ACCESS_KEY?: string | undefined;
  AWS_SESSION_TOKEN?: string | undefined;
  AWS_REGION: string;
  EMBEDDING_PROVIDER: 'openai' | 'openrouter' | 'bedrock' | 'local';
  LLM_PROVIDER: 'openai' | 'openrouter' | 'anthropic' | 'bedrock' | 'local';
}

// API Request/Response Types
export interface AskRequest {
  query: string;
  userId?: string;
  prefer_steps?: boolean;
  max_tokens?: number;
  collection?: string;
}

export interface DebugInfo {
  is_fallback: boolean;
  fallback_reason?: string;
  pipeline_stage: string;
  processing_time_ms: number;
  documents_found: number;
  used_mock_embedding?: boolean;
}

export interface AskResponse {
  answer: string;
  summary: string;
  steps?: string[];
  citations: Citation[];
  retrieved_docs: RetrievedDoc[];
  debug_info?: DebugInfo;
}

export interface Citation {
  title: string;
  url: string;
}

export interface RetrievedDoc {
  id: string;
  score: number;
  excerpt: string;
}

export interface HealthResponse {
  status: 'ok' | 'error';
  timestamp: string;
  version: string;
  checks: HealthCheck[];
}

export interface HealthCheck {
  name: string;
  status: 'ok' | 'error';
  message?: string;
  duration_ms?: number;
}

// Vector Store Types
export interface VectorDocument {
  id: string;
  content: string;
  embedding: number[];
  metadata: DocumentMetadata;
}

export interface DocumentMetadata {
  url: string;
  title: string;
  raw_html?: string;
  section?: string;
  subsection?: string;
  collection?: string;
  content_type: 'text' | 'code' | 'heading' | 'list' | 'table';
  chunk_index: number;
  total_chunks: number;
  created_at: Date;
  updated_at: Date;
}

export interface SearchResult {
  id: string;
  content: string;
  metadata: DocumentMetadata;
  score: number;
}

// Adapter Types
export interface EmbeddingAdapter {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
  getDimensions(): number;
  getModel(): string;
}

export interface LLMAdapter {
  generate(messages: ChatMessage[], options?: GenerateOptions): Promise<string>;
  getMaxTokens(): number;
  getModel(): string;
}

export interface VectorStoreAdapter {
  upsert(docs: VectorDocument[]): Promise<void>;
  search(query: number[], topK: number): Promise<SearchResult[]>;
  delete(ids: string[]): Promise<void>;
  count(): Promise<number>;
  health(): Promise<boolean>;
}

// LLM Types
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface GenerateOptions {
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  stop?: string[];
  stream?: boolean;
}

// RAG Pipeline Types
export interface RAGOptions {
  prefer_steps: boolean;
  max_tokens: number;
  top_k: number;
  context_window_tokens: number;
  collection?: string;
}

export interface RAGResult {
  answer: string;
  summary: string;
  steps?: string[];
  citations: Citation[];
  retrieved_docs: RetrievedDoc[];
  metadata: RAGMetadata;
}

export interface RAGMetadata {
  query_embedding_time_ms: number;
  search_time_ms: number;
  llm_generation_time_ms: number;
  total_time_ms: number;
  context_tokens_used: number;
  response_tokens: number;
}

// Crawler Types
export interface CrawledDocument {
  url: string;
  title: string;
  content: string;
  raw_html: string;
  metadata: Partial<DocumentMetadata>;
}

export interface CrawlResult {
  documents: CrawledDocument[];
  errors: CrawlError[];
  stats: CrawlStats;
}

export interface CrawlError {
  url: string;
  error: string;
  status_code?: number;
}

export interface CrawlStats {
  total_pages: number;
  successful_pages: number;
  failed_pages: number;
  total_chunks: number;
  start_time: Date;
  end_time: Date;
  duration_ms: number;
}

// Error Types
export interface APIError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
  status_code: number;
}

export class RAGError extends Error {
  public readonly code: string;
  public readonly details: Record<string, unknown> | undefined;

  constructor(message: string, code: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'RAGError';
    this.code = code;
    this.details = details;
  }
}

// Utility Types
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type Provider = 'openai' | 'openrouter' | 'anthropic' | 'bedrock' | 'local';

// Database Types
export interface DatabaseConfig {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  ssl?: boolean;
}

export interface QueryResult<T = unknown> {
  rows: T[];
  rowCount: number;
}

// Slack Integration Types
export interface SlackEventPayload {
  token: string;
  team_id: string;
  api_app_id: string;
  event: SlackEvent;
  type: 'event_callback' | 'url_verification';
  event_id?: string;
  event_time?: number;
  challenge?: string;
}

export interface SlackEvent {
  type: 'app_mention' | 'message' | 'message.im';
  user: string;
  text: string;
  ts: string;
  channel: string;
  thread_ts?: string;
  channel_type?: 'channel' | 'group' | 'im';
}

export interface SlackCommandPayload {
  token: string;
  team_id: string;
  team_domain: string;
  channel_id: string;
  channel_name: string;
  user_id: string;
  user_name: string;
  command: string;
  text: string;
  response_url: string;
  trigger_id: string;
}

export interface SlackActionPayload {
  type: 'interactive_message' | 'block_actions' | 'view_submission';
  actions: SlackAction[];
  callback_id?: string;
  team: { id: string; domain: string };
  channel: { id: string; name: string };
  user: { id: string; name: string };
  action_ts: string;
  message_ts: string;
  response_url: string;
  trigger_id?: string;
  view?: SlackModalView;
}

export interface SlackAction {
  name?: string;
  text?: string;
  value?: string;
  type: 'button' | 'select' | 'overflow';
  action_id?: string;
  block_id?: string;
}

export interface SlackResponse {
  text?: string;
  blocks?: SlackBlock[];
  response_type?: 'in_channel' | 'ephemeral';
  replace_original?: boolean;
  delete_original?: boolean;
}

export interface SlackBlock {
  type: 'section' | 'divider' | 'actions' | 'context';
  block_id?: string;
  text?: {
    type: 'mrkdwn' | 'plain_text';
    text: string;
  };
  accessory?: SlackElement;
  elements?: (SlackElement | SlackContextElement)[];
}

export interface SlackElement {
  type: 'button' | 'overflow' | 'datepicker' | 'image';
  text?: {
    type: 'plain_text';
    text: string;
  };
  value?: string;
  action_id?: string;
  url?: string;
  style?: 'primary' | 'danger';
}

export interface SlackContextElement {
  type: 'mrkdwn' | 'plain_text' | 'image';
  text?: string;
  alt_text?: string;
  image_url?: string;
}

export interface SlackQueryContext {
  user_id: string;
  channel_id: string;
  team_id: string;
  query: string;
  thread_ts?: string;
  response_url?: string;
  collection_hint?: 'pssis' | 'schoology' | 'both';
  channel_hint?: string;
}

export interface SlackRAGResponse {
  text: string;
  blocks: SlackBlock[];
  confidence: number;
  intent: 'details' | 'instructions' | 'other';
  sources?: {
    id: string;
    url: string;
    title: string;
    snippet: string;
    retrieval_score: number;
  }[];
}

export interface IntentClassificationResult {
  intent: 'details' | 'instructions' | 'other';
  confidence: number;
  reasoning?: string;
}

export interface CollectionClassificationResult {
  collection: 'pssis' | 'schoology' | 'both';
  confidence: number;
  reasoning?: string;
}

// Interactive Features Types
export interface SlackModalView {
  id: string;
  team_id: string;
  type: 'modal';
  blocks: SlackBlock[];
  private_metadata?: string;
  callback_id?: string;
  state?: {
    values: Record<string, Record<string, SlackInputValue>>;
  };
  hash?: string;
  title: {
    type: 'plain_text';
    text: string;
  };
  submit?: {
    type: 'plain_text';
    text: string;
  };
  close?: {
    type: 'plain_text';
    text: string;
  };
}

export interface SlackInputValue {
  type: 'plain_text_input' | 'static_select' | 'checkboxes';
  value?: string;
  selected_option?: {
    text: { type: 'plain_text'; text: string };
    value: string;
  };
  selected_options?: Array<{
    text: { type: 'plain_text'; text: string };
    value: string;
  }>;
}

export interface SlackViewSubmissionPayload {
  type: 'view_submission';
  team: { id: string; domain: string };
  user: { id: string; name: string };
  api_app_id: string;
  token: string;
  trigger_id: string;
  view: SlackModalView;
  response_urls: Array<{
    response_url: string;
    channel_id: string;
  }>;
}

export interface InteractiveButtonData {
  responseId: string;
  originalMessageTs?: string;
  channelId?: string;
  userId?: string;
}

export interface SourcesModalData {
  sources: Array<{
    id: string;
    title: string;
    url: string;
    snippet: string;
    score: number;
  }>;
}

export interface FollowupModalData {
  originalResponseId: string;
  originalText: string;
  originalSources: Array<{
    id: string;
    title: string;
    url: string;
    snippet: string;
    score: number;
  }>;
}