/**
 * Test AWS Bedrock authentication and fix credential issues
 */

const { BedrockRuntimeClient, InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');
require('dotenv').config();

async function testAWSAuthentication() {
  console.log('🔐 Testing AWS Bedrock Authentication...\n');

  // Check environment variables
  const requiredVars = ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_REGION'];
  const credentials = {};
  let missingVars = [];

  requiredVars.forEach(varName => {
    const value = process.env[varName];
    if (value) {
      credentials[varName] = value;
      console.log(`✅ ${varName}: ${'*'.repeat(Math.min(20, value.length))}`);
    } else {
      missingVars.push(varName);
      console.log(`❌ ${varName}: Not set`);
    }
  });

  if (process.env.AWS_SESSION_TOKEN) {
    credentials.AWS_SESSION_TOKEN = process.env.AWS_SESSION_TOKEN;
    console.log(`⚠️  AWS_SESSION_TOKEN: ${'*'.repeat(20)} (temporary credentials - may expire)`);
  }

  if (missingVars.length > 0) {
    console.log(`\n❌ Missing required environment variables: ${missingVars.join(', ')}`);
    return false;
  }

  // Test 1: Basic Bedrock client initialization
  console.log('\n1️⃣ Testing Bedrock client initialization...');
  
  const client = new BedrockRuntimeClient({
    region: process.env.AWS_REGION,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      ...(process.env.AWS_SESSION_TOKEN && { sessionToken: process.env.AWS_SESSION_TOKEN }),
    },
  });

  console.log(`✅ Bedrock client initialized for region: ${process.env.AWS_REGION}`);

  // Test 2: Simple embedding request
  console.log('\n2️⃣ Testing embedding generation...');

  try {
    const input = {
      modelId: 'amazon.titan-embed-text-v2:0',
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        inputText: 'Test authentication with AWS Bedrock'
      }),
    };

    const command = new InvokeModelCommand(input);
    console.log('   Sending request to Bedrock...');
    
    const response = await client.send(command);
    
    if (response.body) {
      const responseText = new TextDecoder().decode(response.body);
      const responseJson = JSON.parse(responseText);
      
      if (responseJson.embedding && Array.isArray(responseJson.embedding)) {
        console.log(`✅ Embedding generated successfully!`);
        console.log(`   - Embedding dimensions: ${responseJson.embedding.length}`);
        console.log(`   - Sample values: [${responseJson.embedding.slice(0, 3).map(v => v.toFixed(4)).join(', ')}...]`);
        return true;
      } else {
        console.log('❌ Invalid response format from Bedrock');
        console.log('   Response:', responseText);
        return false;
      }
    } else {
      console.log('❌ No response body from Bedrock');
      return false;
    }

  } catch (error) {
    console.log('❌ Bedrock request failed:');
    console.log(`   Error: ${error.message}`);
    
    if (error.name) {
      console.log(`   Type: ${error.name}`);
    }
    
    // Specific error handling
    if (error.message.includes('security token')) {
      console.log('\n🔧 SOLUTION: Your AWS session token is invalid or expired');
      console.log('   1. If using temporary credentials, refresh them');
      console.log('   2. Or use long-term AWS Access Keys instead of session tokens');
      console.log('   3. Remove AWS_SESSION_TOKEN from environment if using permanent keys');
    } else if (error.message.includes('AccessDenied')) {
      console.log('\n🔧 SOLUTION: Your AWS credentials lack Bedrock permissions');
      console.log('   1. Ensure IAM user/role has bedrock:InvokeModel permission');
      console.log('   2. Check if Bedrock is available in your region');
    } else if (error.message.includes('region')) {
      console.log('\n🔧 SOLUTION: Check your AWS region configuration');
      console.log('   1. Ensure Bedrock is available in your region');
      console.log('   2. Try changing AWS_REGION to us-east-1 or us-west-2');
    }
    
    return false;
  }
}

async function suggestFix() {
  console.log('\n💡 Quick Fix Suggestions:\n');

  const hasSessionToken = !!process.env.AWS_SESSION_TOKEN;
  
  if (hasSessionToken) {
    console.log('🔄 You are using temporary AWS credentials (session token detected)');
    console.log('   These expire frequently and cause "invalid token" errors');
    console.log('   Recommended fixes:');
    console.log('   1. Use permanent AWS Access Keys instead (remove AWS_SESSION_TOKEN)');
    console.log('   2. Or refresh your temporary credentials');
    console.log('   3. Or use AWS CLI: aws configure');
  } else {
    console.log('🔑 You are using permanent AWS credentials');
    console.log('   If still getting auth errors:');
    console.log('   1. Verify credentials are correct');
    console.log('   2. Check IAM permissions for Bedrock');
    console.log('   3. Verify region supports Bedrock');
  }

  console.log('\n📝 Required IAM permissions:');
  console.log('   - bedrock:InvokeModel');
  console.log('   - bedrock:InvokeModelWithResponseStream (optional)');

  console.log('\n🌍 Bedrock-supported regions:');
  console.log('   - us-east-1 (N. Virginia) ✅ Recommended');
  console.log('   - us-west-2 (Oregon) ✅ Recommended');
  console.log('   - ap-southeast-1 (Singapore)');
  console.log('   - eu-central-1 (Frankfurt)');
}

async function runAWSAuthTest() {
  console.log('🚀 AWS Bedrock Authentication Test\n');
  
  const success = await testAWSAuthentication();
  
  if (success) {
    console.log('\n🎉 AWS Authentication is working correctly!');
    console.log('   The embedding generation issue has been resolved.');
  } else {
    console.log('\n❌ AWS Authentication failed');
    await suggestFix();
  }
}

// Run test if this file is executed directly
if (require.main === module) {
  runAWSAuthTest().catch(console.error);
}

module.exports = { runAWSAuthTest, testAWSAuthentication };