# Testing the Voice Agent

This guide explains how to test the AI voice agent functionality.

## Quick Start

### Prerequisites

1. **Backend running**: The API server must be running on port 3001 (or specify with `--api-url`)
2. **Environment variables**: Ensure `.env` has:
   - `GEMINI_API_KEY` - Required for Gemini API calls
   - `GCP_PROJECT` - Firebase/GCP project ID
   - `VERTEX_INDEX_ENDPOINT_ID`, `VERTEX_DEPLOYED_INDEX_ID`, `VERTEX_PUBLIC_ENDPOINT_DOMAIN` - For vector search (optional)

### Basic Test (Direct Service Call)

Test the VoiceService directly without WebSocket:

```bash
# Simple query test
npm run test:voice -- --query "What is the foundation depth requirement?"

# With specific document
npm run test:voice -- --query "What is the foundation depth?" --document-id "doc123"

# Streaming response
npm run test:voice:stream -- --query "What is the foundation depth?"
```

### WebSocket Test (Full Integration)

Test the complete WebSocket flow:

```bash
# Test via WebSocket (requires backend running)
npm run test:voice:ws -- \
  --query "What is the foundation depth?" \
  --tenant-id "your-user-id" \
  --document-id "doc123"
```

## Test Script Options

### `test-voice-agent.ts`

**Options:**
- `--query <text>` - Query to test (required)
- `--document-id <id>` - Document ID (default: "all")
- `--tenant-id <id>` - Tenant/User ID (required for WebSocket)
- `--stream` - Use streaming response
- `--websocket` - Test via WebSocket connection
- `--api-url <url>` - API URL (default: http://localhost:3001)

**Examples:**

```bash
# Direct service test
ts-node scripts/test-voice-agent.ts \
  --query "What are the foundation requirements?"

# Streaming test
ts-node scripts/test-voice-agent.ts \
  --query "What are the foundation requirements?" \
  --stream

# WebSocket test
ts-node scripts/test-voice-agent.ts \
  --query "What are the foundation requirements?" \
  --websocket \
  --tenant-id "test-user-123" \
  --document-id "doc123"
```

## Test Scenarios

### 1. Test Basic Voice Query

```bash
npm run test:voice -- --query "What is the foundation depth?"
```

**Expected:**
- VoiceService processes the query
- Retrieves context from Firestore (if documents exist)
- Calls Gemini API
- Returns a response

### 2. Test Streaming Response

```bash
npm run test:voice:stream -- --query "Explain the foundation requirements"
```

**Expected:**
- Response streams in chunks
- Text appears incrementally
- Faster perceived latency

### 3. Test WebSocket Connection

```bash
# First, get a user ID from your Firebase Auth
# Then run:
npm run test:voice:ws -- \
  --query "What is the foundation depth?" \
  --tenant-id "your-firebase-user-id"
```

**Expected:**
- WebSocket connects successfully
- Authentication passes
- Document is set
- Query is sent
- Response chunks are received
- Connection closes cleanly

### 4. Test with Specific Document

```bash
npm run test:voice -- \
  --query "What does the structural report say?" \
  --document-id "structural-report-2024"
```

**Expected:**
- Only searches within specified document
- Context is limited to that document

### 5. Test Error Handling

```bash
# Test with invalid document ID
npm run test:voice -- \
  --query "Test query" \
  --document-id "nonexistent-doc"

# Test with empty query
npm run test:voice -- --query ""
```

## Understanding Test Output

### Direct Service Test Output

```
🎤 Voice Agent Test Script
==================================================

🧪 Testing VoiceService directly...

Query: "What is the foundation depth?"
Document ID: all
Tenant ID: test-tenant-1234567890

Using model: gemini-2.0-flash

📚 Retrieving context...
Found 3 documents
💬 Testing single response...

Response:

Based on the Project Specifications document, the foundation 
requirements specify a minimum depth of 4 feet below grade 
with reinforced concrete footings...

✅ Response received. Length: 245 characters
✅ Test completed successfully
```

### WebSocket Test Output

```
🎤 Voice Agent Test Script
==================================================

🌐 Testing WebSocket connection...

API URL: http://localhost:3001
Query: "What is the foundation depth?"
Document ID: all
Tenant ID: test-user-123

🔐 Creating test token...
✅ Token created

✅ WebSocket connected
   Socket ID: abc123xyz

✅ Authenticated
   Data: {
     "tenantId": "test-user-123",
     "limits": { ... }
   }

📤 Setting document...
✅ Document set
   Data: { "documentId": "all" }

📤 Sending voice query...
✅ Voice query started
   Data: { "query": "What is the foundation depth?" }

📥 Waiting for response...

Based on the Project Specifications document, the foundation 
requirements specify a minimum depth of 4 feet below grade...

✅ Voice response completed
   Data: {
     "fullText": "...",
     "audioChunks": 0,
     "truncated": false
   }

🔌 WebSocket disconnected
✅ Test completed successfully
```

## Troubleshooting

### Error: GEMINI_API_KEY not set

**Solution:**
```bash
# Add to .env file
echo "GEMINI_API_KEY=your-api-key" >> .env
```

### Error: Firebase Admin initialization failed

**Solution:**
```bash
# Ensure GCP_PROJECT is set
echo "GCP_PROJECT=your-project-id" >> .env

# Or set Application Default Credentials
gcloud auth application-default login
```

### Error: WebSocket connection failed

**Possible causes:**
1. Backend not running - Start with `npm run dev:api`
2. Wrong API URL - Use `--api-url` to specify correct URL
3. CORS issues - Check backend CORS configuration
4. Invalid token - Ensure Firebase Admin is initialized correctly

**Solution:**
```bash
# Check if backend is running
curl http://localhost:3001/health

# Test with explicit API URL
npm run test:voice:ws -- \
  --api-url "http://localhost:3001" \
  --query "Test" \
  --tenant-id "test-user"
```

### Error: No documents found

**Expected behavior:** If no documents exist, the voice agent will still respond but with general construction knowledge.

**To test with documents:**
1. Upload documents via the web interface
2. Note the document ID
3. Use `--document-id` to test with that document

### Error: Vector search not configured

**Expected behavior:** Voice agent will work without vector search, but won't have document context.

**To enable vector search:**
```bash
# Add to .env
VERTEX_INDEX_ENDPOINT_ID=your-endpoint-id
VERTEX_DEPLOYED_INDEX_ID=your-deployed-index-id
VERTEX_PUBLIC_ENDPOINT_DOMAIN=your-domain
```

## Integration with Frontend Testing

### Test Voice via Browser

1. **Start backend:**
   ```bash
   npm run dev:api
   ```

2. **Start frontend:**
   ```bash
   npm run dev:web
   ```

3. **Open browser:**
   - Navigate to http://localhost:3000
   - Open browser DevTools Console
   - Switch to Voice mode
   - Click the voice button and speak

4. **Monitor logs:**
   ```bash
   # In another terminal
   npm run dev:api 2>&1 | tee logs/voice-test.log
   ```

5. **Extract logs:**
   ```bash
   npm run logs:extract -- --file logs/voice-test.log --component VoiceGateway --output voice-debug.md
   ```

## Performance Testing

### Measure Response Time

```bash
# Time the test
time npm run test:voice -- --query "What is the foundation depth?"
```

### Compare Streaming vs Non-Streaming

```bash
# Non-streaming
time npm run test:voice -- --query "Explain foundation requirements"

# Streaming
time npm run test:voice:stream -- --query "Explain foundation requirements"
```

### Test Concurrent Queries

```bash
# Run multiple tests in parallel
for i in {1..5}; do
  npm run test:voice -- --query "Test query $i" &
done
wait
```

## Advanced Testing

### Test with Custom Tenant ID

```bash
npm run test:voice -- \
  --query "What is the foundation depth?" \
  --tenant-id "custom-tenant-123"
```

### Test with Different Models

```bash
# Set model via environment variable
GEMINI_VOICE_MODEL=gemini-3-pro-preview npm run test:voice -- \
  --query "What is the foundation depth?"
```

### Test Error Scenarios

```bash
# Test with very long query
npm run test:voice -- --query "$(head -c 5000 < /dev/zero | tr '\0' 'a')"

# Test with special characters
npm run test:voice -- --query "What about $pecial characters & symbols?"

# Test with empty context
npm run test:voice -- \
  --query "What is the foundation depth?" \
  --document-id "nonexistent-doc-id"
```

## Next Steps

- Add unit tests for VoiceService methods
- Add integration tests for WebSocket flow
- Add performance benchmarks
- Add load testing for concurrent sessions

