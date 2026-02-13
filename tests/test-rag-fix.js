/**
 * Test script to verify RAG API fixes
 */

const axios = require('axios');

async function testRAGFix() {
  console.log('🧪 Testing RAG API Fixes');
  console.log('========================');
  console.log('');

  const baseURL = 'http://localhost:3000/api/v1';
  const testQuery = {
    query: "give me steps to Enroll a New Student?",
    userId: "test-user-fix",
    prefer_steps: true,
    max_tokens: 1000
  };

  try {
    console.log('🔄 Testing the original failing query...');
    console.log(`Query: "${testQuery.query}"`);
    console.log('');

    const response = await axios.post(`${baseURL}/ask`, testQuery, {
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: 30000
    });

    const result = response.data;
    
    console.log('📊 RESPONSE ANALYSIS');
    console.log('==================');
    console.log(`Status Code: ${response.status}`);
    console.log(`Is Fallback: ${result.debug_info?.is_fallback || 'N/A'}`);
    console.log(`Fallback Reason: ${result.debug_info?.fallback_reason || 'N/A'}`);
    console.log(`Pipeline Stage: ${result.debug_info?.pipeline_stage || 'N/A'}`);
    console.log(`Documents Found: ${result.debug_info?.documents_found || 0}`);
    console.log(`Processing Time: ${result.debug_info?.processing_time_ms || 'N/A'}ms`);
    console.log(`Retrieved Docs: ${result.retrieved_docs?.length || 0}`);
    console.log('');

    if (result.debug_info?.is_fallback) {
      console.log('❌ STILL RETURNING FALLBACK');
      console.log('Fallback Answer Preview:', result.answer.substring(0, 200) + '...');
      
      if (result.debug_info.fallback_reason === 'EMPTY_RETRIEVAL_RESULTS') {
        console.log('');
        console.log('🔍 DIAGNOSIS: Vector search is still returning empty results');
        console.log('Next steps to try:');
        console.log('1. Check if embedding service is working correctly');
        console.log('2. Verify similarity threshold is low enough');
        console.log('3. Test with hybrid search enabled');
        console.log('4. Check embedding dimensions match database');
      }
    } else {
      console.log('✅ SUCCESS - RAG pipeline working!');
      console.log('');
      console.log('📝 ANSWER PREVIEW:');
      console.log(result.answer.substring(0, 500) + '...');
      console.log('');
      console.log('📚 RETRIEVED DOCUMENTS:');
      result.retrieved_docs?.forEach((doc, i) => {
        console.log(`${i + 1}. ${doc.excerpt.substring(0, 100)}... (Score: ${doc.score})`);
      });
      console.log('');
      console.log('🔗 CITATIONS:');
      result.citations?.forEach((citation, i) => {
        console.log(`${i + 1}. ${citation.title}: ${citation.url}`);
      });
    }

    // Test with different queries to verify the fix
    const additionalTests = [
      "how to create a student schedule?",
      "student enrollment process",
      "mass register students"
    ];

    console.log('');
    console.log('🔄 Testing additional queries...');
    
    for (const query of additionalTests) {
      try {
        console.log(`\nTesting: "${query}"`);
        const testResponse = await axios.post(`${baseURL}/ask`, {
          query,
          userId: "test-user-additional",
          prefer_steps: false,
          max_tokens: 500
        }, {
          headers: { 'Content-Type': 'application/json' },
          timeout: 15000
        });

        const testResult = testResponse.data;
        console.log(`  Result: ${testResult.debug_info?.is_fallback ? '❌ Fallback' : '✅ Success'} (${testResult.debug_info?.documents_found || 0} docs)`);
        
      } catch (error) {
        console.log(`  Error: ${error.message}`);
      }
    }

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    
    if (error.code === 'ECONNREFUSED') {
      console.log('');
      console.log('🚀 Server not running. Start it with:');
      console.log('   npm run dev');
    } else if (error.response) {
      console.log('');
      console.log('📊 Error Response:');
      console.log(`Status: ${error.response.status}`);
      console.log(`Data:`, error.response.data);
    }
  }
}

// Additional diagnostic function
async function runVectorDiagnostics() {
  console.log('\n🔬 Vector Search Diagnostics');
  console.log('============================');
  
  try {
    // Test health endpoint
    const healthResponse = await axios.get('http://localhost:3000/health', { timeout: 5000 });
    console.log('✅ API Health:', healthResponse.data);
    
    // Check if we can access any endpoint
    console.log('✅ API is accessible');
    
  } catch (error) {
    console.log('❌ API Health Check Failed:', error.message);
  }
}

// Run tests
async function runAllTests() {
  await runVectorDiagnostics();
  await testRAGFix();
}

runAllTests()
  .then(() => {
    console.log('\n✅ Testing completed');
  })
  .catch(error => {
    console.error('\n💥 Testing failed:', error);
  });