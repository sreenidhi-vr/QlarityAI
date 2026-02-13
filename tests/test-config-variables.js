/**
 * Simple test to verify environment variables are being loaded correctly
 */

// Import the config using TypeScript paths
import config from '@/utils/config';

console.log('🔧 Testing Collection Configuration Variables:');
console.log('');

console.log('📚 Collection Settings:');
console.log(`  DEFAULT_COLLECTION: ${config.DEFAULT_COLLECTION}`);
console.log('');

console.log('🏛️ PSSIS-Admin Configuration:');
console.log(`  PSSIS_CRAWL_BASE_URL: ${config.PSSIS_CRAWL_BASE_URL}`);
console.log(`  PSSIS_CRAWL_DELAY_MS: ${config.PSSIS_CRAWL_DELAY_MS}`);
console.log(`  PSSIS_MAX_PAGES: ${config.PSSIS_MAX_PAGES}`);
console.log('');

console.log('🎓 Schoology Configuration:');
console.log(`  SCHOOLOGY_CRAWL_BASE_URL: ${config.SCHOOLOGY_CRAWL_BASE_URL}`);
console.log(`  SCHOOLOGY_CRAWL_DELAY_MS: ${config.SCHOOLOGY_CRAWL_DELAY_MS}`);
console.log(`  SCHOOLOGY_MAX_PAGES: ${config.SCHOOLOGY_MAX_PAGES}`);
console.log('');

console.log('📜 Legacy Configuration:');
console.log(`  CRAWL_BASE_URL: ${config.CRAWL_BASE_URL}`);
console.log(`  CRAWL_DELAY_MS: ${config.CRAWL_DELAY_MS}`);
console.log(`  MAX_PAGES: ${config.MAX_PAGES}`);
console.log('');

console.log('✅ Environment variables loaded successfully!');