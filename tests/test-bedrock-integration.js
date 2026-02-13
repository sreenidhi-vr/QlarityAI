/**
 * Simple test script to verify AWS Bedrock integration
 */

const { BedrockEmbeddingAdapter } = require('./src/adapters/embedding/bedrock.ts');
const { BedrockLLMAdapter } = require('./src/adapters/llm/bedrock.ts');

async function testBedrockIntegration() {
  console.log('🚀 Testing AWS Bedrock Integration...\n');

  try {
    // Test embedding adapter
    console.log('📊 Testing Bedrock Embedding Adapter...');
    const embeddingAdapter = new BedrockEmbeddingAdapter({
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      sessionToken: process.env.AWS_SESSION_TOKEN,
      region: process.env.AWS_REGION || 'us-east-1',
      model: 'amazon.titan-embed-text-v1',
    });

    console.log('  Model info:', embeddingAdapter.getModelInfo());
    
    const testText = 'This is a test text for embedding generation.';
    console.log(`  Testing embedding generation for: "${testText}"`);
    
    const embedding = await embeddingAdapter.embed(testText);
    console.log(`  ✅ Embedding generated successfully! Dimensions: ${embedding.length}`);
    console.log(`  First 5 values: [${embedding.slice(0, 5).map(v => v.toFixed(4)).join(', ')}...]`);

    // Test batch embedding
    const batchTexts = ['First test text', 'Second test text'];
    console.log(`  Testing batch embedding for ${batchTexts.length} texts...`);
    const batchEmbeddings = await embeddingAdapter.embedBatch(batchTexts);
    console.log(`  ✅ Batch embeddings generated! Count: ${batchEmbeddings.length}\n`);

    // Test LLM adapter
    console.log('🤖 Testing Bedrock LLM Adapter...');
    const llmAdapter = new BedrockLLMAdapter({
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      sessionToken: process.env.AWS_SESSION_TOKEN,
      region: process.env.AWS_REGION || 'us-east-1',
      model: 'anthropic.claude-3-haiku-20240307-v1:0',
    });

    console.log('  Model info:', llmAdapter.getModelInfo());

    const testMessages = [
      { role: 'system', content: 'You are a helpful assistant. Respond concisely.' },
      { role: 'user', content: 'What is 2+2? Just give the number.' },
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
    console.error('\n❌ Test failed:', error.message);
    if (error.name) {
      console.error('Error type:', error.name);
    }
    if (error.originalError) {
      console.error('Original error:', error.originalError);
    }
    return false;
  }
}

// Test connection only
async function testConnection() {
  console.log('🔗 Testing AWS Bedrock Connection...\n');

  try {
    const embeddingAdapter = new BedrockEmbeddingAdapter({
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      sessionToken: process.env.AWS_SESSION_TOKEN,
      region: process.env.AWS_REGION || 'us-east-1',
    });

    const llmAdapter = new BedrockLLMAdapter({
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      sessionToken: process.env.AWS_SESSION_TOKEN,
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
    console.error('Connection test failed:', error.message);
    return false;
  }
}

// Run tests
if (require.main === module) {
  require('dotenv').config();
  
  const testType = process.argv[2] || 'full';
  
  if (testType === 'connection') {
    testConnection()
      .then(success => process.exit(success ? 0 : 1))
      .catch(error => {
        console.error('Unexpected error:', error);
        process.exit(1);
      });
  } else {
    testBedrockIntegration()
      .then(success => process.exit(success ? 0 : 1))
      .catch(error => {
        console.error('Unexpected error:', error);
        process.exit(1);
      });
  }
}

module.exports = { testBedrockIntegration, testConnection };