/**
 * E2E Test Setup
 * Global setup for end-to-end tests
 */

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error';
process.env.SLACK_BOT_TOKEN = 'xoxb-test-token-123456789';
process.env.SLACK_SIGNING_SECRET = 'test_signing_secret_abcdef123456';
process.env.SLACK_APP_TOKEN = 'xapp-test-token-123456789';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test_db';
process.env.LLM_PROVIDER = 'bedrock';
process.env.EMBEDDING_PROVIDER = 'bedrock';

// Mock console in test environment
if (process.env.NODE_ENV === 'test') {
  global.console = {
    ...console,
    log: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
}

// Increase Jest timeout for async operations
jest.setTimeout(30000);

// Global test utilities
(global as any).waitForAsync = (ms: number = 100) => new Promise(resolve => setTimeout(resolve, ms));

// Mock fetch globally if not available in test environment
if (!global.fetch) {
  global.fetch = jest.fn() as jest.MockedFunction<typeof fetch>;
}