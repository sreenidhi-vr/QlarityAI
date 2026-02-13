# 🔐 AWS Bedrock Authentication Fix

## 🚨 Current Issue
**Error**: "The security token included in the request is invalid"  
**Impact**: Embedding generation fails → Mock embeddings used → No document matches → Fallback triggered

## 🛠️ **IMMEDIATE FIXES** (Choose One)

### Option 1: Fix AWS Credentials (Recommended)
Your AWS credentials are invalid/expired. Here's how to fix them:

#### 1️⃣ **Get New AWS Credentials**
```bash
# If using AWS CLI (easiest method)
aws configure
# Enter your AWS Access Key ID
# Enter your AWS Secret Access Key  
# Enter region: us-east-1
# Enter format: json

# Test the credentials
aws bedrock list-foundation-models --region us-east-1
```

#### 2️⃣ **Update Environment Variables**
```bash
# In your .env file, update with valid credentials:
AWS_ACCESS_KEY_ID=your_valid_access_key_here
AWS_SECRET_ACCESS_KEY=your_valid_secret_key_here
AWS_REGION=us-east-1

# Remove any AWS_SESSION_TOKEN if present (causes expiration issues)
# AWS_SESSION_TOKEN=  # <- Delete this line
```

#### 3️⃣ **Verify IAM Permissions**
Ensure your AWS user/role has these permissions:
```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "bedrock:InvokeModel",
                "bedrock:InvokeModelWithResponseStream"
            ],
            "Resource": "*"
        }
    ]
}
```

### Option 2: Use Alternative Embedding Provider (Quick Fix)

#### Switch to OpenAI (if you have API key):
```bash
# In your .env file:
EMBEDDING_PROVIDER=openai
OPENAI_API_KEY=your_openai_api_key_here
EMBEDDING_MODEL=text-embedding-3-small
```

#### Switch to Local Embeddings (no API keys needed):
```bash
# In your .env file:
EMBEDDING_PROVIDER=local
EMBEDDING_MODEL=all-MiniLM-L6-v2
```

### Option 3: Temporary Mock Embeddings (Development Only)

I can modify the code to use consistent mock embeddings instead of random ones for development:

## 🧪 **TEST THE FIX**

After applying any fix above:

```bash
# 1. Test AWS authentication
node test-aws-auth.js

# 2. Test the full RAG pipeline
node test-enhanced-debug.js

# 3. Check if fallback is resolved
# Should see: is_fallback: false, used_mock_embedding: false
```

## 🚀 **NEXT STEPS**

1. **Fix credentials** using Option 1 above
2. **Populate database**: `npm run seed` (after fixing auth)
3. **Test API**: Run the debug test to confirm working RAG responses

## ⚡ **Quick Command to Fix**

```bash
# Set up AWS CLI and configure credentials
aws configure

# Test Bedrock access
aws bedrock list-foundation-models --region us-east-1

# If that works, restart your server
# The embedding authentication should now work
```

**The fallback issue will be resolved once embeddings work properly and the database has data.**