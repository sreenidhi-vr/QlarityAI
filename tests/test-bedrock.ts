/**
 * TypeScript test script to verify AWS Bedrock integration
 */

import { BedrockEmbeddingAdapter } from '../src/adapters/embedding/bedrock';
import { BedrockLLMAdapter } from '../src/adapters/llm/bedrock';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function testBedrockIntegration() {
  console.log('🚀 Testing AWS Bedrock Integration...\n');

  try {
    // Check required environment variables
    if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
      throw new Error('Missing required AWS credentials: AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY');
    }

    // Test embedding adapter
    console.log('📊 Testing Bedrock Embedding Adapter...');
    const embeddingAdapter = new BedrockEmbeddingAdapter({
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      ...(process.env.AWS_SESSION_TOKEN && { sessionToken: process.env.AWS_SESSION_TOKEN }),
      region: process.env.AWS_REGION || 'us-east-1',
      model: 'amazon.titan-embed-text-v1',
    });

    console.log('  Model info:', embeddingAdapter.getModelInfo());
    
    const testText = 'This is a test text for embedding generation.';
    console.log(`  Testing embedding generation for: "${testText}"`);
    
    const embedding = await embeddingAdapter.embed(testText);
    console.log(`  ✅ Embedding generated successfully! Dimensions: ${embedding.length}`);
    console.log(`  First 5 values: [${embedding.slice(0, 5).map((v: number) => v.toFixed(4)).join(', ')}...]`);

    // Test batch embedding (just 2 texts for quick test)
    const batchTexts = ['First test text', 'Second test text'];
    console.log(`  Testing batch embedding for ${batchTexts.length} texts...`);
    const batchEmbeddings = await embeddingAdapter.embedBatch(batchTexts);
    console.log(`  ✅ Batch embeddings generated! Count: ${batchEmbeddings.length}\n`);

    // Test LLM adapter
    console.log('🤖 Testing Bedrock LLM Adapter...');
    const llmAdapter = new BedrockLLMAdapter({
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      ...(process.env.AWS_SESSION_TOKEN && { sessionToken: process.env.AWS_SESSION_TOKEN }),
      region: process.env.AWS_REGION || 'us-east-1',
      model: 'anthropic.claude-3-haiku-20240307-v1:0',
    });

    console.log('  Model info:', llmAdapter.getModelInfo());

    const testMessages = [
      { role: 'system' as const, content: 'You are a helpful assistant. Respond concisely.' },
      { role: 'user' as const, content: 'What is 2+2? Just give the number.' },
    ];

    console.log('  Testing LLM generation...');
    const response = await llmAdapter.generate(testMessages, { max_tokens: 10 });
    console.log(`  ✅ LLM response generated: "${response.trim()}"`);

    // Test cost estimation
    const costEstimate = llmAdapter.estimateRequestCost(testMessages, { max_tokens: 1500 });
    console.log('  Cost estimate:', costEstimate);

    console.log('\n🎉 All tests passed! AWS Bedrock integration is working correctly.');
    return true;

  } catch (error) {
    console.error('\n❌ Test failed:', error instanceof Error ? error.message : 'Unknown error');
    if (error && typeof error === 'object' && 'name' in error) {
      console.error('Error type:', (error as any).name);
    }
    if (error && typeof error === 'object' && 'originalError' in error) {
      console.error('Original error:', (error as any).originalError);
    }
    return false;
  }
}

// Test connection only
async function testConnection() {
  console.log('🔗 Testing AWS Bedrock Connection...\n');

  try {
    // Check required environment variables
    if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
      throw new Error('Missing required AWS credentials: AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY');
    }

    const embeddingAdapter = new BedrockEmbeddingAdapter({
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      ...(process.env.AWS_SESSION_TOKEN && { sessionToken: process.env.AWS_SESSION_TOKEN }),
      region: process.env.AWS_REGION || 'us-east-1',
    });

    const llmAdapter = new BedrockLLMAdapter({
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      ...(process.env.AWS_SESSION_TOKEN && { sessionToken: process.env.AWS_SESSION_TOKEN }),
      region: process.env.AWS_REGION || 'us-east-1',
    });

    console.log('Testing embedding connection...');
    const embeddingConnected = await embeddingAdapter.testConnection();
    console.log(`Embedding adapter connection: ${embeddingConnected ? '✅ Connected' : '❌ Failed'}`);

    console.log('Testing LLM connection...');
    const llmConnected = await llmAdapter.testConnection();
    console.log(`LLM adapter connection: ${llmConnected ? '✅ Connected' : '❌ Failed'}`);

    return embeddingConnected && llmConnected;

  } catch (error) {
    console.error('Connection test failed:', error instanceof Error ? error.message : 'Unknown error');
    return false;
  }
}

// Run tests
async function main() {
  const testType = process.argv[2] || 'full';
  
  try {
    let success: boolean;
    
    if (testType === 'connection') {
      success = await testConnection();
    } else {
      success = await testBedrockIntegration();
    }
    
    process.exit(success ? 0 : 1);
  } catch (error) {
    console.error('Unexpected error:', error);
    process.exit(1);
  }
}

// Only run if this file is executed directly
if (require.main === module) {
  main();
}

export { testBedrockIntegration, testConnection };