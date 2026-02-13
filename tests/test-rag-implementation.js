/**
 * Test script for RAG implementation
 * Tests the complete RAG pipeline with example queries
 */

const axios = require('axios');
require('dotenv').config();

const BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000';

async function testRAGEndpoint() {
  console.log('🚀 Testing RAG Implementation');
  console.log('=' .repeat(50));

  // Test queries as specified in requirements
  const testQueries = [
    {
      name: 'Attendance Codes Configuration',
      query: 'How do I configure Attendance Codes in PowerSchool?',
      prefer_steps: true,
      expected_sections: ['Summary', 'Steps', 'References']
    },
    {
      name: 'User Management',
      query: 'How do I add new users in PowerSchool PSSIS-Admin?',
      prefer_steps: true,
      expected_sections: ['Summary', 'Steps', 'References']
    },
    {
      name: 'General Information Query',
      query: 'What is the PowerSchool Student Information System?',
      prefer_steps: false,
      expected_sections: ['Summary', 'Overview', 'References']
    }
  ];

  let successCount = 0;
  let totalTests = testQueries.length;

  for (const [index, testCase] of testQueries.entries()) {
    console.log(`\n📝 Test ${index + 1}: ${testCase.name}`);
    console.log('-'.repeat(40));
    
    try {
      const startTime = Date.now();
      
      const response = await axios.post(`${BASE_URL}/api/v1/ask`, {
        query: testCase.query,
        prefer_steps: testCase.prefer_steps,
        max_tokens: 1500,
        userId: `test-user-${Date.now()}`
      }, {
        timeout: 60000, // 60 second timeout
        headers: {
          'Content-Type': 'application/json'
        }
      });

      const responseTime = Date.now() - startTime;
      
      console.log(`✅ Status: ${response.status} (${responseTime}ms)`);
      
      // Validate response structure
      const result = response.data;
      const validation = validateResponse(result, testCase);
      
      if (validation.isValid) {
        successCount++;
        console.log('✅ Response validation: PASSED');
        
        // Log key metrics
        console.log(`📊 Metrics:`);
        console.log(`   - Retrieved docs: ${result.retrieved_docs.length}`);
        console.log(`   - Citations: ${result.citations.length}`);
        console.log(`   - Has steps: ${Boolean(result.steps)}`);
        console.log(`   - Answer length: ${result.answer.length} chars`);
        
        // Show first 200 chars of answer
        console.log(`📄 Answer preview:`);
        console.log(`   "${result.answer.substring(0, 200)}..."`);
        
        // Show summary
        console.log(`📝 Summary: "${result.summary}"`);
        
        // Show retrieved documents scores
        if (result.retrieved_docs.length > 0) {
          console.log(`🎯 Top retrieved docs:`);
          result.retrieved_docs.slice(0, 3).forEach((doc, i) => {
            console.log(`   ${i + 1}. Score: ${doc.score.toFixed(3)} - "${doc.excerpt.substring(0, 80)}..."`);
          });
        }
        
      } else {
        console.log('❌ Response validation: FAILED');
        validation.issues.forEach(issue => {
          console.log(`   - ${issue}`);
        });
      }
      
    } catch (error) {
      console.log('❌ Request failed:');
      
      if (error.response) {
        console.log(`   Status: ${error.response.status}`);
        console.log(`   Error: ${JSON.stringify(error.response.data, null, 2)}`);
      } else if (error.request) {
        console.log('   No response received (server may be down)');
        console.log(`   ${error.message}`);
      } else {
        console.log(`   ${error.message}`);
      }
    }
  }

  console.log('\n' + '='.repeat(50));
  console.log(`📈 Test Results: ${successCount}/${totalTests} passed`);
  
  if (successCount === totalTests) {
    console.log('🎉 All tests passed! RAG implementation is working correctly.');
    return true;
  } else {
    console.log('⚠️  Some tests failed. Check the implementation.');
    return false;
  }
}

function validateResponse(response, testCase) {
  const issues = [];
  
  // Check required fields
  const requiredFields = ['answer', 'summary', 'citations', 'retrieved_docs'];
  for (const field of requiredFields) {
    if (!(field in response)) {
      issues.push(`Missing required field: ${field}`);
    }
  }
  
  // Validate answer structure
  if (response.answer) {
    // Check for markdown formatting
    if (!response.answer.includes('#')) {
      issues.push('Answer lacks markdown headings');
    }
    
    // Check for required sections based on test case
    const answer = response.answer.toLowerCase();
    
    if (!answer.includes('summary')) {
      issues.push('Answer missing Summary section');
    }
    
    if (testCase.prefer_steps) {
      const hasSteps = /\d+\./.test(response.answer) || response.steps;
      if (!hasSteps) {
        issues.push('Step-by-step format requested but not found');
      }
    }
    
    if (!answer.includes('reference')) {
      issues.push('Answer missing References section');
    }
  }
  
  // Validate summary
  if (response.summary && response.summary.length < 10) {
    issues.push('Summary too short');
  }
  
  // Validate citations
  if (!Array.isArray(response.citations) || response.citations.length === 0) {
    issues.push('No citations provided');
  } else {
    for (const citation of response.citations) {
      if (!citation.title || !citation.url) {
        issues.push('Invalid citation structure');
        break;
      }
    }
  }
  
  // Validate retrieved docs
  if (!Array.isArray(response.retrieved_docs)) {
    issues.push('retrieved_docs is not an array');
  } else {
    for (const doc of response.retrieved_docs) {
      if (!doc.id || typeof doc.score !== 'number' || !doc.excerpt) {
        issues.push('Invalid retrieved document structure');
        break;
      }
    }
  }
  
  return {
    isValid: issues.length === 0,
    issues
  };
}

// Health check function
async function testHealthCheck() {
  console.log('\n🏥 Testing Health Check');
  console.log('-'.repeat(30));
  
  try {
    const response = await axios.get(`${BASE_URL}/health`);
    console.log(`✅ Health check: ${response.status}`);
    console.log(`📊 Status: ${response.data.status}`);
    
    if (response.data.checks) {
      response.data.checks.forEach(check => {
        console.log(`   - ${check.name}: ${check.status}`);
      });
    }
    
    return response.data.status === 'ok';
  } catch (error) {
    console.log('❌ Health check failed:', error.message);
    return false;
  }
}

// Main execution
async function runTests() {
  console.log('PowerSchool RAG API Test Suite');
  console.log('Testing against:', BASE_URL);
  console.log('Time:', new Date().toISOString());
  
  // First check if server is responding
  const healthOk = await testHealthCheck();
  if (!healthOk) {
    console.log('\n❌ Server health check failed. Make sure the server is running.');
    process.exit(1);
  }
  
  // Run RAG tests
  const ragTestsPassed = await testRAGEndpoint();
  
  // Final result
  console.log('\n' + '='.repeat(60));
  if (ragTestsPassed) {
    console.log('🎉 RAG Implementation Test: SUCCESS');
    console.log('✅ The RAG pipeline is working correctly and returning proper responses.');
  } else {
    console.log('❌ RAG Implementation Test: FAILED');
    console.log('⚠️  Check the server logs and fix any issues before proceeding.');
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  runTests().catch(error => {
    console.error('Test execution failed:', error);
    process.exit(1);
  });
}

module.exports = { testRAGEndpoint, testHealthCheck, runTests };