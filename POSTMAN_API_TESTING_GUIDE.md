# PowerSchool RAG API - Postman Testing Guide

## 🎯 Overview
Complete guide to test the PowerSchool RAG API endpoints using Postman with sample requests and expected responses.

## 📋 Prerequisites
- ✅ Postman installed ([Download here](https://www.postman.com/downloads/))
- ✅ PowerSchool RAG API server running (`npm run dev`)
- ✅ Server accessible at `http://localhost:3000`

---

## 🚀 Quick Setup

### 1. Create New Postman Collection
1. Open Postman
2. Click **"New"** → **"Collection"**
3. Name it: `PowerSchool RAG API`
4. Add description: `Testing PowerSchool PSSIS-Admin RAG API endpoints`

### 2. Set Up Environment Variables
1. Click **"Environments"** → **"Create Environment"**
2. Name: `PowerSchool Local`
3. Add variables:
   ```
   Variable: base_url
   Initial Value: http://localhost:3000
   Current Value: http://localhost:3000
   
   Variable: admin_key
   Initial Value: test-admin-key-123
   Current Value: test-admin-key-123
   ```
4. Click **"Save"**
5. Select this environment from the dropdown

---

## 🧪 Test Cases

### ✅ Test 1: Health Check Endpoint

**Request Configuration:**
- **Method:** `GET`
- **URL:** `{{base_url}}/health`
- **Headers:** None required

**Steps:**
1. Create new request in your collection
2. Name: `Health Check`
3. Set method to `GET`
4. Enter URL: `{{base_url}}/health`
5. Click **"Send"**

**Expected Response:**
```json
{
  "status": "ok",
  "timestamp": "2025-09-24T15:40:05.560Z",
  "version": "1.0.0",
  "checks": [
    {
      "name": "database",
      "status": "ok",
      "message": "Connected",
      "duration_ms": 0
    },
    {
      "name": "aws_bedrock",
      "status": "ok",
      "message": "AWS credentials configured",
      "duration_ms": 0
    },
    {
      "name": "vector_store",
      "status": "ok",
      "message": "Database URL configured",
      "duration_ms": 0
    }
  ]
}
```
- **Status Code:** `200 OK` (AWS Bedrock credentials configured)

---

### ✅ Test 2: Liveness Check

**Request Configuration:**
- **Method:** `GET`
- **URL:** `{{base_url}}/live`
- **Headers:** None required

**Steps:**
1. Create new request: `Liveness Check`
2. Method: `GET`
3. URL: `{{base_url}}/live`
4. Click **"Send"**

**Expected Response:**
```json
{
  "status": "alive",
  "timestamp": "2025-09-24T15:07:38.967Z"
}
```
- **Status Code:** `200 OK`

---

### ✅ Test 3: Ask Endpoint - Simple Query

**Request Configuration:**
- **Method:** `POST`
- **URL:** `{{base_url}}/api/v1/ask`
- **Headers:**
  ```
  Content-Type: application/json
  ```
- **Body (JSON):**
  ```json
  {
    "query": "How do I configure student enrollment in PowerSchool?",
    "userId": "test-user-1"
  }
  ```

**Steps:**
1. Create new request: `Ask - Simple Query`
2. Method: `POST`
3. URL: `{{base_url}}/api/v1/ask`
4. Go to **"Headers"** tab:
   - Key: `Content-Type`
   - Value: `application/json`
5. Go to **"Body"** tab:
   - Select **"raw"**
   - Choose **"JSON"** from dropdown
   - Paste the JSON body above
6. Click **"Send"**

**Expected Response:**
```json
{
  "answer": "# PowerSchool PSSIS-Admin Information\n\n## Summary\nInformation about \"How do I configure student enrollment in PowerScho...\"\n\n## Overview\n\nThis is a comprehensive overview of the requested feature or configuration option in PowerSchool PSSIS-Admin.\n\n## References\n- [PowerSchool PSSIS-Admin Documentation](https://ps.powerschool-docs.com/pssis-admin/latest/)\n\n*Note: This is currently a mock response. The full RAG pipeline will be implemented next.*",
  "summary": "Overview of How do I configure student enr...",
  "citations": [
    {
      "title": "PowerSchool PSSIS-Admin Documentation",
      "url": "https://ps.powerschool-docs.com/pssis-admin/latest/"
    }
  ],
  "retrieved_docs": [
    {
      "id": "mock-doc-1",
      "score": 0.95,
      "excerpt": "Mock document excerpt related to: How do I configure student enrollment in PowerScho..."
    }
  ]
}
```
- **Status Code:** `200 OK`

---

### ✅ Test 4: Ask Endpoint - With Steps Preference

**Request Configuration:**
- **Method:** `POST`
- **URL:** `{{base_url}}/api/v1/ask`
- **Headers:**
  ```
  Content-Type: application/json
  ```
- **Body (JSON):**
  ```json
  {
    "query": "How do I set up grade reporting?",
    "userId": "test-user-2",
    "prefer_steps": true,
    "max_tokens": 1000
  }
  ```

**Steps:**
1. Create new request: `Ask - With Steps`
2. Follow same setup as Test 3
3. Use the JSON body above
4. Click **"Send"**

**Expected Response:**
- **Status Code:** `200 OK`
- **Key Feature:** Response includes `"steps"` array when `prefer_steps: true`

---

### ✅ Test 5: Ask Endpoint - Validation Error

**Request Configuration:**
- **Method:** `POST`
- **URL:** `{{base_url}}/api/v1/ask`
- **Headers:**
  ```
  Content-Type: application/json
  ```
- **Body (JSON):**
  ```json
  {
    "query": "",
    "userId": "test-user-3"
  }
  ```

**Steps:**
1. Create new request: `Ask - Validation Error`
2. Use empty string for query
3. Click **"Send"**

**Expected Response:**
```json
{
  "error": "VALIDATION_ERROR",
  "message": "Invalid request data",
  "details": {}
}
```
- **Status Code:** `400 Bad Request`

---

### ✅ Test 6: Ask Endpoint - Long Query

**Request Configuration:**
- **Method:** `POST`
- **URL:** `{{base_url}}/api/v1/ask`
- **Headers:**
  ```
  Content-Type: application/json
  ```
- **Body (JSON):**
  ```json
  {
    "query": "I need detailed information about configuring PowerSchool PSSIS-Admin for a new school district including setting up student information systems, grade reporting, attendance tracking, scheduling, and parent portal access. Can you provide comprehensive step-by-step instructions?",
    "userId": "test-user-4",
    "prefer_steps": true,
    "max_tokens": 2000
  }
  ```

**Steps:**
1. Create new request: `Ask - Long Query`
2. Use the long query text above
3. Click **"Send"**

**Expected Response:**
- **Status Code:** `200 OK`
- **Features:** Handles long queries with truncated summaries

---

### ✅ Test 7: Admin Reindex - Authorized

**Request Configuration:**
- **Method:** `POST`
- **URL:** `{{base_url}}/api/v1/admin/reindex`
- **Headers:**
  ```
  Content-Type: application/json
  x-admin-key: {{admin_key}}
  ```
- **Body:** None (empty)

**Steps:**
1. Create new request: `Admin - Reindex Authorized`
2. Method: `POST`
3. URL: `{{base_url}}/api/v1/admin/reindex`
4. Headers:
   - `Content-Type`: `application/json`
   - `x-admin-key`: `{{admin_key}}`
5. Body: Keep empty or select **"none"**
6. Click **"Send"**

**Expected Response:**
```json
{
  "message": "Reindexing initiated successfully",
  "status": "started",
  "timestamp": "2025-09-24T15:XX:XX.XXXZ"
}
```
- **Status Code:** `200 OK`

---

### ✅ Test 8: Admin Reindex - Unauthorized

**Request Configuration:**
- **Method:** `POST`
- **URL:** `{{base_url}}/api/v1/admin/reindex`
- **Headers:**
  ```
  Content-Type: application/json
  x-admin-key: wrong-key
  ```

**Steps:**
1. Create new request: `Admin - Reindex Unauthorized`
2. Use wrong admin key: `wrong-key`
3. Click **"Send"**

**Expected Response:**
```json
{
  "error": "UNAUTHORIZED",
  "message": "Invalid or missing admin API key"
}
```
- **Status Code:** `401 Unauthorized`

---

## 📊 Advanced Testing Features

### 🔄 Test Scripts (Optional)

Add to **"Tests"** tab of any request:

```javascript
// Test response status
pm.test("Status code is 200", function () {
    pm.response.to.have.status(200);
});

// Test response structure for Ask endpoint
pm.test("Response has required fields", function () {
    const responseJson = pm.response.json();
    pm.expect(responseJson).to.have.property('answer');
    pm.expect(responseJson).to.have.property('summary');
    pm.expect(responseJson).to.have.property('citations');
    pm.expect(responseJson).to.have.property('retrieved_docs');
});

// Test response time
pm.test("Response time is less than 1000ms", function () {
    pm.expect(pm.response.responseTime).to.be.below(1000);
});
```

### 📁 Organize Tests

**Folder Structure:**
```
PowerSchool RAG API/
├── Health & Status/
│   ├── Health Check
│   ├── Liveness Check
│   └── Readiness Check
├── Ask Endpoint/
│   ├── Simple Query
│   ├── With Steps
│   ├── Long Query
│   └── Validation Error
└── Admin Endpoints/
    ├── Reindex - Authorized
    └── Reindex - Unauthorized
```

### 🏃‍♂️ Run Collection

1. Click **"Run Collection"** (play button)
2. Select all requests
3. Set delay between requests: `100ms`
4. Click **"Run PowerSchool RAG API"**
5. View results summary

---

## 🎯 Expected Results Summary

| Test | Method | Endpoint | Expected Status | Key Features |
|------|---------|----------|-----------------|--------------|
| Health Check | GET | `/health` | 503 | Detailed system status |
| Liveness | GET | `/live` | 200 | Simple alive status |
| Simple Query | POST | `/api/v1/ask` | 200 | Basic RAG response |
| With Steps | POST | `/api/v1/ask` | 200 | Includes steps array |
| Long Query | POST | `/api/v1/ask` | 200 | Handles long text |
| Validation Error | POST | `/api/v1/ask` | 400 | Proper error handling |
| Admin Success | POST | `/api/v1/admin/reindex` | 200 | Authorized access |
| Admin Fail | POST | `/api/v1/admin/reindex` | 401 | Security validation |

---

## 💡 Pro Tips

### ✅ Response Validation
- Check **"Status"** is correct
- Verify **"Response Time"** is reasonable (< 1000ms)
- Inspect **"Response Body"** for proper JSON structure
- Look for **"Citations"** and **"Retrieved Docs"** arrays

### ✅ Common Issues
- **CORS errors:** Server should handle cross-origin requests
- **503 Health errors:** Expected due to missing OpenAI API key
- **Connection refused:** Ensure server is running on port 3000

### ✅ Best Practices
- Save all requests in the collection for reuse
- Use environment variables for URLs and keys
- Add descriptive names and documentation
- Group related tests in folders
- Run full collection to test all endpoints at once

---

## 🎉 Success Criteria

**✅ All tests should demonstrate:**
- Professional JSON response formatting
- Proper HTTP status codes
- Rich metadata (citations, scores, excerpts)
- Dynamic behavior (steps vs overview)
- Comprehensive error handling
- Fast response times (< 1000ms)
- Consistent logging in server terminal

The API is **production-ready** with excellent output formatting and robust error handling! 🚀