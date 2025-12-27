# API Log Monitoring Guide

## Quick Log Access

### View All API Logs
```bash
# Real-time log tailing
tail -f /tmp/api-server.log

# Last 50 lines
tail -50 /tmp/api-server.log

# Filter for errors only
tail -f /tmp/api-server.log | grep -E "(ERROR|error|failed|timeout|expired)"
```

### Filtered Log Monitoring (Already Running)
```bash
# View filtered logs (RagService, errors, timeouts)
tail -f /tmp/api-filtered.log
```

## Current Issues Found

### 1. Vertex AI API Not Enabled
**Error:** `PERMISSION_DENIED: Vertex AI API has not been used in project wheelpath-filesearch before or it is disabled`

**Impact:** Embeddings will fail, but the system falls back gracefully and continues without RAG context.

**Fix:** Enable Vertex AI API at:
https://console.developers.google.com/apis/api/aiplatform.googleapis.com/overview?project=wheelpath-filesearch

### 2. Gemini API Key Expired
**Error:** `API key expired. Please renew the API key`

**Impact:** All chat requests will fail with "I ran into a temporary issue" message.

**Fix:** 
1. Get a new API key from: https://aistudio.google.com/app/apikey
2. Update `apps/api/.env`:
   ```
   GEMINI_API_KEY=your_new_key_here
   ```
3. Restart the API server

## Testing the Text UI

1. **Open browser:** http://localhost:3000
2. **Open browser console** (F12) to see frontend logs
3. **Open terminal** to monitor API logs:
   ```bash
   tail -f /tmp/api-server.log
   ```
4. **Send a test message** in the text UI
5. **Watch both logs** to see:
   - Frontend: Network requests, errors
   - Backend: Processing steps, errors, timeouts

## Log Locations

- **API Server Logs:** `/tmp/api-server.log`
- **Filtered Logs:** `/tmp/api-filtered.log`
- **Server Process:** Check with `ps aux | grep nest`

## Common Error Messages

| Error Message | Cause | Solution |
|--------------|-------|----------|
| "I ran into a temporary issue..." | Generic error fallback | Check API logs for specific error |
| "I've hit my rate limit..." | Rate limit (429) | Wait and retry |
| "That took longer than expected..." | Timeout | Check network/API response times |
| "API key expired" | Invalid/expired key | Renew API key in .env |
| "PERMISSION_DENIED" | Vertex AI not enabled | Enable API in GCP console |

