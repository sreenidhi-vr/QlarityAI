#!/usr/bin/env node

/**
 * Comprehensive Slack Integration Test Suite
 * Tests all Slack endpoints with proper payload validation
 */

const https = require('https');
const http = require('http');
const crypto = require('crypto');

const BASE_URL = 'http://localhost:3000';
const SLACK_SIGNING_SECRET = 'test_signing_secret_for_validation';

// Test utilities
function createSlackSignature(timestamp, body, secret = SLACK_SIGNING_SECRET) {
  const baseString = `v0:${timestamp}:${body}`;
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(baseString);
  return `v0=${hmac.digest('hex')}`;
}

function makeRequest(path, method = 'GET', data = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const options = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Slack-Integration-Test/1.0',
        ...headers
      }
    };

    if (data && typeof data === 'object') {
      data = JSON.stringify(data);
      options.headers['Content-Length'] = Buffer.byteLength(data);
    }

    const req = (url.protocol === 'https:' ? https : http).request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const parsed = body ? JSON.parse(body) : {};
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: parsed,
            rawBody: body
          });
        } catch (e) {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: body,
            rawBody: body
          });
        }
      });
    });

    req.on('error', reject);

    if (data) {
      req.write(data);
    }
    
    req.end();
  });
}

// Test payloads
const testPayloads = {
  urlVerification: {
    token: 'test_token',
    challenge: 'test_challenge_12345',
    type: 'url_verification'
  },

  appMention: {
    token: 'test_token',
    team_id: 'T1234567890',
    api_app_id: 'A1234567890',
    event: {
      type: 'app_mention',
      user: 'U1234567890',
      text: '<@U0987654321> How do I configure attendance codes in PowerSchool?',
      ts: '1234567890.123456',
      channel: 'C1234567890',
      channel_type: 'channel'
    },
    type: 'event_callback',
    event_id: 'Ev1234567890',
    event_time: Date.now()
  },

  slashCommand: {
    token: 'test_token',
    team_id: 'T1234567890',
    team_domain: 'test-workspace',
    channel_id: 'C1234567890',
    channel_name: 'general',
    user_id: 'U1234567890',
    user_name: 'testuser',
    command: '/ask',
    text: 'How do I add new users in PowerSchool PSSIS-Admin?',
    response_url: 'https://hooks.slack.com/commands/1234567890/0987654321/test',
    trigger_id: '1234567890.0987654321.test'
  },

  interactiveAction: {
    payload: JSON.stringify({
      type: 'block_actions',
      user: { id: 'U1234567890', name: 'testuser' },
      team: { id: 'T1234567890', domain: 'test-workspace' },
      channel: { id: 'C1234567890', name: 'general' },
      response_url: 'https://hooks.slack.com/actions/1234567890/0987654321/test',
      actions: [
        {
          action_id: 'show_sources',
          value: 'show_sources',
          type: 'button'
        }
      ]
    })
  }
};

// Test suite
async function runTests() {
  console.log('🚀 Starting Slack Integration Test Suite\n');

  let passed = 0;
  let failed = 0;

  // Helper function to run individual tests
  async function runTest(name, testFn) {
    try {
      console.log(`🧪 Testing: ${name}`);
      const result = await testFn();
      if (result.success) {
        console.log(`✅ PASSED: ${name}`);
        if (result.details) console.log(`   ${result.details}`);
        passed++;
      } else {
        console.log(`❌ FAILED: ${name}`);
        console.log(`   Error: ${result.error}`);
        failed++;
      }
    } catch (error) {
      console.log(`❌ FAILED: ${name}`);
      console.log(`   Exception: ${error.message}`);
      failed++;
    }
    console.log('');
  }

  // Test 1: Server Health Check
  await runTest('Server Health Check', async () => {
    const response = await makeRequest('/health');
    if (response.status === 200) {
      return {
        success: true,
        details: `Server is healthy. Status: ${response.body.status}`
      };
    }
    return {
      success: false,
      error: `Health check failed with status ${response.status}`
    };
  });

  // Test 2: Slack Health Check
  await runTest('Slack Health Check', async () => {
    const response = await makeRequest('/slack/health');
    if (response.status === 200 || response.status === 503) {
      return {
        success: true,
        details: `Slack health endpoint accessible. Status: ${response.body.status || 'unknown'}`
      };
    }
    return {
      success: false,
      error: `Slack health check failed with status ${response.status}`
    };
  });

  // Test 3: URL Verification Challenge
  await runTest('URL Verification Challenge', async () => {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const body = JSON.stringify(testPayloads.urlVerification);
    const signature = createSlackSignature(timestamp, body);

    const response = await makeRequest('/slack/events', 'POST', testPayloads.urlVerification, {
      'X-Slack-Request-Timestamp': timestamp,
      'X-Slack-Signature': signature
    });

    if (response.status === 200 && response.body.challenge === testPayloads.urlVerification.challenge) {
      return {
        success: true,
        details: 'URL verification challenge handled correctly'
      };
    }
    return {
      success: false,
      error: `Expected challenge response, got status ${response.status}: ${JSON.stringify(response.body)}`
    };
  });

  // Test 4: App Mention Event (without valid Slack tokens)
  await runTest('App Mention Event Processing', async () => {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const body = JSON.stringify(testPayloads.appMention);
    const signature = createSlackSignature(timestamp, body);

    const response = await makeRequest('/slack/events', 'POST', testPayloads.appMention, {
      'X-Slack-Request-Timestamp': timestamp,
      'X-Slack-Signature': signature
    });

    if (response.status === 200 && response.body.status === 'ok') {
      return {
        success: true,
        details: 'App mention event accepted and queued for processing'
      };
    }
    return {
      success: false,
      error: `App mention event failed with status ${response.status}: ${JSON.stringify(response.body)}`
    };
  });

  // Test 5: Slash Command
  await runTest('Slash Command Processing', async () => {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    
    // Convert to URL-encoded format (as Slack sends it)
    const formData = Object.entries(testPayloads.slashCommand)
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
      .join('&');
    
    const signature = createSlackSignature(timestamp, formData);

    const response = await makeRequest('/slack/command', 'POST', formData, {
      'X-Slack-Request-Timestamp': timestamp,
      'X-Slack-Signature': signature,
      'Content-Type': 'application/x-www-form-urlencoded'
    });

    if (response.status === 200) {
      return {
        success: true,
        details: 'Slash command accepted and queued for processing'
      };
    }
    return {
      success: false,
      error: `Slash command failed with status ${response.status}: ${JSON.stringify(response.body)}`
    };
  });

  // Test 6: Interactive Actions
  await runTest('Interactive Actions Processing', async () => {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const formData = `payload=${encodeURIComponent(testPayloads.interactiveAction.payload)}`;
    const signature = createSlackSignature(timestamp, formData);

    const response = await makeRequest('/slack/actions', 'POST', formData, {
      'X-Slack-Request-Timestamp': timestamp,
      'X-Slack-Signature': signature,
      'Content-Type': 'application/x-www-form-urlencoded'
    });

    if (response.status === 200 && response.body.status === 'ok') {
      return {
        success: true,
        details: 'Interactive action accepted and queued for processing'
      };
    }
    return {
      success: false,
      error: `Interactive action failed with status ${response.status}: ${JSON.stringify(response.body)}`
    };
  });

  // Test 7: Invalid Signature Rejection
  await runTest('Invalid Signature Rejection', async () => {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const body = JSON.stringify(testPayloads.urlVerification);
    const invalidSignature = 'v0=invalid_signature_12345';

    const response = await makeRequest('/slack/events', 'POST', testPayloads.urlVerification, {
      'X-Slack-Request-Timestamp': timestamp,
      'X-Slack-Signature': invalidSignature
    });

    if (response.status === 401) {
      return {
        success: true,
        details: 'Invalid signature properly rejected with 401 status'
      };
    }
    return {
      success: false,
      error: `Expected 401 for invalid signature, got status ${response.status}`
    };
  });

  // Test 8: Old Timestamp Rejection
  await runTest('Old Timestamp Rejection', async () => {
    const oldTimestamp = (Math.floor(Date.now() / 1000) - 400).toString(); // 6+ minutes old
    const body = JSON.stringify(testPayloads.urlVerification);
    const signature = createSlackSignature(oldTimestamp, body);

    const response = await makeRequest('/slack/events', 'POST', testPayloads.urlVerification, {
      'X-Slack-Request-Timestamp': oldTimestamp,
      'X-Slack-Signature': signature
    });

    if (response.status === 401) {
      return {
        success: true,
        details: 'Old timestamp properly rejected with 401 status'
      };
    }
    return {
      success: false,
      error: `Expected 401 for old timestamp, got status ${response.status}`
    };
  });

  // Summary
  console.log('📊 Test Results Summary');
  console.log('=' .repeat(50));
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`📈 Success Rate: ${Math.round((passed / (passed + failed)) * 100)}%`);
  
  if (failed === 0) {
    console.log('\n🎉 All Slack integration tests passed!');
    console.log('\nNext Steps:');
    console.log('1. Configure your Slack app with the documented settings');
    console.log('2. Add your SLACK_BOT_TOKEN and SLACK_SIGNING_SECRET to .env');
    console.log('3. Set up your Slack app endpoints to point to your server');
    console.log('4. Test with real Slack interactions');
  } else {
    console.log(`\n⚠️  ${failed} test(s) failed. Please review the errors above.`);
  }

  process.exit(failed === 0 ? 0 : 1);
}

// Wait for server to start, then run tests
console.log('⏳ Waiting for server to start...');
setTimeout(() => {
  runTests().catch(error => {
    console.error('❌ Test suite failed with error:', error);
    process.exit(1);
  });
}, 5000); // Wait 5 seconds for server to start