import dotenv from 'dotenv';
import { z } from 'zod';
import type { Environment } from '@/types';

// Load environment variables
dotenv.config();

// Environment validation schema
const envSchema = z.object({
  // Server Configuration
  PORT: z.coerce.number().min(1).max(65535).default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  // Database Configuration
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  VECTOR_TABLE_NAME: z.string().default('documents'),

  // OpenAI Configuration (optional when using other providers)
  OPENAI_API_KEY: z.string().optional(),
  EMBEDDING_MODEL: z.string().default('amazon.titan-embed-text-v2:0'),
  LLM_MODEL: z.string().default('gpt-4'),
  MAX_TOKENS: z.coerce.number().min(100).max(4000).default(1500),

  // Security Configuration
  RATE_LIMIT_PER_MIN: z.coerce.number().min(1).max(1000).default(60),
  MAX_QUERY_LENGTH: z.coerce.number().min(10).max(5000).default(1000),
  ADMIN_API_KEY: z.string().min(8, 'ADMIN_API_KEY must be at least 8 characters'),

  // Slack Configuration
  SLACK_SIGNING_SECRET: z.string().optional(),
  SLACK_BOT_TOKEN: z.string().optional(),
  SLACK_APP_TOKEN: z.string().optional(),
  SLACK_VERIFIED_WORKSPACES: z.string().optional(),
  
  // Microsoft Teams Configuration
  TEAMS_APP_ID: z.string().optional(),
  TEAMS_APP_PASSWORD: z.string().optional(),

  // n8n Webhook Configuration
  N8N_WEBHOOK_URL: z.string().url().optional(),

  // Collection Configuration
  DEFAULT_COLLECTION: z.enum(['pssis-admin', 'schoology']).default('pssis-admin'),

  // PSSIS-Admin Crawling Configuration
  PSSIS_CRAWL_BASE_URL: z
    .string()
    .url()
    .default('https://ps.powerschool-docs.com/pssis-admin/latest/'),
  PSSIS_CRAWL_DELAY_MS: z.coerce.number().min(100).max(10000).default(1000),
  PSSIS_MAX_PAGES: z.coerce.number().min(1).max(10000).default(1000),

  // Schoology Crawling Configuration
  SCHOOLOGY_CRAWL_BASE_URL: z
    .string()
    .url()
    .default('https://uc.powerschool-docs.com/en/schoology/latest/'),
  SCHOOLOGY_CRAWL_DELAY_MS: z.coerce.number().min(100).max(10000).default(1000),
  SCHOOLOGY_MAX_PAGES: z.coerce.number().min(1).max(10000).default(1000),

  // Legacy Crawling Configuration (for backward compatibility)
  CRAWL_BASE_URL: z
    .string()
    .url()
    .default('https://ps.powerschool-docs.com/pssis-admin/latest/'),
  CRAWL_DELAY_MS: z.coerce.number().min(100).max(10000).default(1000),
  MAX_PAGES: z.coerce.number().min(1).max(10000).default(1000),

  // Optional Provider Configuration
  OPENROUTER_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  
  // AWS Configuration
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  AWS_SESSION_TOKEN: z.string().optional(),
  AWS_REGION: z.string().default('us-east-1'),
  
  // Provider Selection
  EMBEDDING_PROVIDER: z.enum(['openai', 'openrouter', 'bedrock', 'local']).default('bedrock'),
  LLM_PROVIDER: z.enum(['openai', 'openrouter', 'anthropic', 'bedrock', 'local']).default('bedrock'),
});

/**
 * Validates and returns the application configuration
 * @throws {Error} If environment validation fails
 */
export function getConfig(): Environment {
  try {
    const config = envSchema.parse(process.env);
    return config;
  } catch (error) {
    if (error instanceof z.ZodError) {
      const issues = error.issues
        .map(issue => `${issue.path.join('.')}: ${issue.message}`)
        .join('\n  ');
      
      throw new Error(`Environment validation failed:\n  ${issues}`);
    }
    throw error;
  }
}

/**
 * Validates configuration without throwing errors
 * @returns Validation result with success flag and errors
 */
export function validateConfig(): { success: boolean; errors?: string[] } {
  try {
    envSchema.parse(process.env);
    return { success: true };
  } catch (error) {
    if (error instanceof z.ZodError) {
      const errors = error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`);
      return { success: false, errors };
    }
    return { success: false, errors: ['Unknown validation error'] };
  }
}

/**
 * Gets database configuration from DATABASE_URL
 */
export function getDatabaseConfig(databaseUrl: string): {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  ssl?: boolean;
} {
  try {
    const url = new globalThis.URL(databaseUrl);
    
    return {
      host: url.hostname,
      port: parseInt(url.port || '5432', 10),
      database: url.pathname.slice(1), // Remove leading slash
      username: url.username,
      password: url.password,
      ssl: url.searchParams.get('sslmode') === 'require',
    };
  } catch (error) {
    throw new Error(`Invalid DATABASE_URL format: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Checks if we're in development mode
 */
export function isDevelopment(): boolean {
  return process.env.NODE_ENV === 'development';
}

/**
 * Checks if we're in production mode
 */
export function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

/**
 * Checks if we're in test mode
 */
export function isTest(): boolean {
  return process.env.NODE_ENV === 'test';
}

// Export the validated configuration as default
export default getConfig();