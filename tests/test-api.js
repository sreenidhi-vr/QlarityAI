/**
 * Simple API test script to verify endpoint responses
 */

const http = require('http');

// Helper function to make HTTP requests
function makeRequest(options, data = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        try {
          const jsonData = JSON.parse(body);
          resolve({
            status: res.statusCode,
            headers: res.headers,
            data: jsonData
          });
        } catch (error) {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            data: body
          });
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    if (data) {
      req.write(JSON.stringify(data));
    }
    
    req.end();
  });
}

async function testAPIs() {
  console.log('🧪 Testing PowerSchool RAG API endpoints...\n');

  const baseURL = 'http://localhost:3000';
  
  // Test 1: Health Check
  console.log('1️⃣ Testing Health Check (/health)');
  try {
    const healthResponse = await makeRequest({
      hostname: 'localhost',
      port: 3000,
      path: '/health',
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    });
    
    console.log(`   Status: ${healthResponse.status}`);
    console.log(`   Response:`, JSON.stringify(healthResponse.data, null, 2));
  } catch (error) {
    console.log(`   Error:`, error.message);
  }
  console.log('\n' + '='.repeat(80) + '\n');

  // Test 2: Liveness Check
  console.log('2️⃣ Testing Liveness Check (/live)');
  try {
    const liveResponse = await makeRequest({
      hostname: 'localhost',
      port: 3000,
      path: '/live',
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    });
    
    console.log(`   Status: ${liveResponse.status}`);
    console.log(`   Response:`, JSON.stringify(liveResponse.data, null, 2));
  } catch (error) {
    console.log(`   Error:`, error.message);
  }
  console.log('\n' + '='.repeat(80) + '\n');

  // Test 3: Ask Endpoint - Simple Query
  console.log('3️⃣ Testing Ask Endpoint - Simple Query (/api/v1/ask)');
  try {
    const askResponse1 = await makeRequest({
      hostname: 'localhost',
      port: 3000,
      path: '/api/v1/ask',
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(JSON.stringify({
          query: "How do I configure student enrollment in PowerSchool?",
          userId: "test-user-1"
        }))
      }
    }, {
      query: "How do I configure student enrollment in PowerSchool?",
      userId: "test-user-1"
    });
    
    console.log(`   Status: ${askResponse1.status}`);
    console.log(`   Response:`, JSON.stringify(askResponse1.data, null, 2));
  } catch (error) {
    console.log(`   Error:`, error.message);
  }
  console.log('\n' + '='.repeat(80) + '\n');

  // Test 4: Ask Endpoint - With Steps Preference
  console.log('4️⃣ Testing Ask Endpoint - With Steps Preference (/api/v1/ask)');
  try {
    const askResponse2 = await makeRequest({
      hostname: 'localhost',
      port: 3000,
      path: '/api/v1/ask',
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(JSON.stringify({
          query: "How do I set up grade reporting?",
          userId: "test-user-2",
          prefer_steps: true,
          max_tokens: 1000
        }))
      }
    }, {
      query: "How do I set up grade reporting?",
      userId: "test-user-2",
      prefer_steps: true,
      max_tokens: 1000
    });
    
    console.log(`   Status: ${askResponse2.status}`);
    console.log(`   Response:`, JSON.stringify(askResponse2.data, null, 2));
  } catch (error) {
    console.log(`   Error:`, error.message);
  }
  console.log('\n' + '='.repeat(80) + '\n');

  // Test 5: Ask Endpoint - Validation Error (empty query)
  console.log('5️⃣ Testing Ask Endpoint - Validation Error (/api/v1/ask)');
  try {
    const askResponse3 = await makeRequest({
      hostname: 'localhost',
      port: 3000,
      path: '/api/v1/ask',
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(JSON.stringify({
          query: "",
          userId: "test-user-3"
        }))
      }
    }, {
      query: "",
      userId: "test-user-3"
    });
    
    console.log(`   Status: ${askResponse3.status}`);
    console.log(`   Response:`, JSON.stringify(askResponse3.data, null, 2));
  } catch (error) {
    console.log(`   Error:`, error.message);
  }
  console.log('\n' + '='.repeat(80) + '\n');

  // Test 6: Ask Endpoint - Long Query
  console.log('6️⃣ Testing Ask Endpoint - Long Query (/api/v1/ask)');
  try {
    const longQuery = "I need detailed information about configuring PowerSchool PSSIS-Admin for a new school district including setting up student information systems, grade reporting, attendance tracking, scheduling, and parent portal access. Can you provide comprehensive step-by-step instructions?";
    
    const askResponse4 = await makeRequest({
      hostname: 'localhost',
      port: 3000,
      path: '/api/v1/ask',
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(JSON.stringify({
          query: longQuery,
          userId: "test-user-4",
          prefer_steps: true,
          max_tokens: 2000
        }))
      }
    }, {
      query: longQuery,
      userId: "test-user-4",
      prefer_steps: true,
      max_tokens: 2000
    });
    
    console.log(`   Status: ${askResponse4.status}`);
    console.log(`   Response:`, JSON.stringify(askResponse4.data, null, 2));
  } catch (error) {
    console.log(`   Error:`, error.message);
  }
  
  console.log('\n🎉 API testing completed!');
}

// Run the tests
testAPIs().catch(console.error);