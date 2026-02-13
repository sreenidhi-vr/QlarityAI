/**
 * Test script to validate enhanced RAG debugging capabilities
 * Tests various failure scenarios to identify the source of "Create a fallback response"
 */

const axios = require('axios');

const API_BASE_URL = 'http://localhost:3000';

async function testRAGDebug() {
  console.log('🔍 Testing Enhanced RAG Debug Capabilities...\n');

  const testCases = [
    {
      name: 'Empty Vector DB Test',
      description: 'Test with a query that should return no documents',
      query: 'xyz_nonexistent_feature_xyz_12345',
      expectedFallback: true,
      expectedReason: 'EMPTY_RETRIEVAL_RESULTS'
    },
    {
      name: 'Normal Query Test',
      description: 'Test with a normal PowerSchool query',
      query: 'How do I add a new student?',
      expectedFallback: false
    },
    {
      name: 'Complex Query Test',
      description: 'Test with a complex administrative query',
      query: 'What are the steps to configure grade reporting for multiple terms?',
      expectedFallback: false
    },
    {
      name: 'Edge Case Query',
      description: 'Test with a very specific technical query',
      query: 'PowerSchool PSSIS-Admin database connection pool configuration',
      expectedFallback: true,
      expectedReason: 'EMPTY_RETRIEVAL_RESULTS'
    }
  ];

  for (const testCase of testCases) {
    console.log(`\n📋 ${testCase.name}`);
    console.log(`   ${testCase.description}`);
    console.log(`   Query: "${testCase.query}"`);
    
    try {
      const startTime = Date.now();
      const response = await axios.post(`${API_BASE_URL}/api/v1/ask`, {
        query: testCase.query
      });

      const responseTime = Date.now() - startTime;
      const data = response.data;

      console.log(`\n✅ Response received in ${responseTime}ms`);
      
      // Analyze debug information
      if (data.debug_info) {
        console.log(`🔍 Debug Info:`);
        console.log(`   - Is Fallback: ${data.debug_info.is_fallback}`);
        console.log(`   - Pipeline Stage: ${data.debug_info.pipeline_stage}`);
        console.log(`   - Processing Time: ${data.debug_info.processing_time_ms}ms`);
        console.log(`   - Documents Found: ${data.debug_info.documents_found}`);
        console.log(`   - Used Mock Embedding: ${data.debug_info.used_mock_embedding || false}`);
        
        if (data.debug_info.fallback_reason) {
          console.log(`   - Fallback Reason: ${data.debug_info.fallback_reason}`);
        }

        // Validate expectations
        if (testCase.expectedFallback !== undefined) {
          const actualFallback = data.debug_info.is_fallback;
          if (actualFallback === testCase.expectedFallback) {
            console.log(`✅ Expected fallback behavior: ${actualFallback}`);
          } else {
            console.log(`❌ Unexpected fallback behavior. Expected: ${testCase.expectedFallback}, Actual: ${actualFallback}`);
          }
        }

        if (testCase.expectedReason && data.debug_info.fallback_reason) {
          if (data.debug_info.fallback_reason === testCase.expectedReason) {
            console.log(`✅ Expected fallback reason: ${data.debug_info.fallback_reason}`);
          } else {
            console.log(`❌ Unexpected fallback reason. Expected: ${testCase.expectedReason}, Actual: ${data.debug_info.fallback_reason}`);
          }
        }
      } else {
        console.log(`⚠️  No debug info in response`);
      }

      // Check for suspicious response content
      if (data.answer) {
        const suspiciousPatterns = [
          'Create a fallback response',
          'I cannot',
          'I don\'t have',
          'No information available'
        ];

        for (const pattern of suspiciousPatterns) {
          if (data.answer.toLowerCase().includes(pattern.toLowerCase())) {
            console.log(`🚨 SUSPICIOUS PATTERN DETECTED: "${pattern}"`);
            console.log(`   Answer preview: ${data.answer.substring(0, 200)}...`);
          }
        }
      }

      console.log(`📄 Response Summary: ${data.summary}`);
      console.log(`🔗 Citations: ${data.citations.length}`);
      console.log(`📚 Retrieved Docs: ${data.retrieved_docs.length}`);

    } catch (error) {
      console.log(`❌ Test failed:`);
      
      if (error.response) {
        console.log(`   Status: ${error.response.status}`);
        console.log(`   Status Text: ${error.response.statusText}`);
        console.log(`   Headers: ${JSON.stringify(error.response.headers, null, 2)}`);
        console.log(`   Error: ${JSON.stringify(error.response.data, null, 2)}`);
      } else if (error.request) {
        console.log(`   Network Error - No response received`);
        console.log(`   Request details: ${error.request.method} ${error.request.path}`);
        console.log(`   Error Code: ${error.code}`);
        console.log(`   Error Message: ${error.message}`);
      } else {
        console.log(`   Unexpected Error: ${error.message}`);
        console.log(`   Error Type: ${error.constructor.name}`);
        console.log(`   Stack: ${error.stack}`);
      }
    }

    console.log(`${'='.repeat(80)}`);
  }
}

async function testHealthCheck() {
  console.log('\n🏥 Testing Health Check...');
  
  try {
    const response = await axios.get(`${API_BASE_URL}/health`);
    console.log('✅ Health check passed');
    console.log(`📊 Status: ${JSON.stringify(response.data, null, 2)}`);
  } catch (error) {
    console.log('❌ Health check failed');
    console.log(`   Error: ${error.message}`);
  }
}

async function runDiagnostics() {
  console.log('🚀 Starting RAG Diagnostics...\n');
  
  // First, check if the server is running
  try {
    await testHealthCheck();
  } catch (error) {
    console.log('❌ Server is not running. Please start it with: npm run dev');
    return;
  }

  // Run the debug tests
  await testRAGDebug();

  console.log('\n🎯 Diagnosis Summary:');
  console.log('1. Check the console logs above for detailed debug information');
  console.log('2. Look for any "SUSPICIOUS PATTERN DETECTED" alerts');
  console.log('3. Verify fallback reasons match expected scenarios');
  console.log('4. If "Create a fallback response" appears, check the LLM generation logs');
  console.log('5. Monitor for embedding failures or empty retrieval results');
}

// Run diagnostics if this file is executed directly
if (require.main === module) {
  runDiagnostics().catch(console.error);
}

module.exports = { runDiagnostics, testRAGDebug, testHealthCheck };