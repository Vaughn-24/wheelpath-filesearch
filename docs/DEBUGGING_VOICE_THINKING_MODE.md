# Debugging Voice Agent Stuck on "Thinking" Mode

## Problem

Voice agent gets stuck in "processing" (thinking) state and never transitions to "speaking" or "idle".

## Common Causes

### 1. Gemini API Stream Not Completing
The `sendMessageStream()` call may hang or never complete.

**Symptoms:**
- Backend logs show `[VoiceService] Calling Gemini API` but no completion
- No `voiceChunk` or `voiceEnd` events received
- Frontend stuck on "Thinking..."

**Check:**
```bash
# Check backend logs for Gemini API calls
npm run logs:extract -- --file logs/api.log --component VoiceService --checkpoint 13
```

### 2. WebSocket Events Not Received
Frontend may not be receiving `voiceChunk` or `voiceEnd` events.

**Symptoms:**
- Backend logs show response being sent
- Frontend console shows no `voiceChunk` events
- WebSocket connection appears active

**Check:**
```bash
# Check WebSocket connection logs
npm run logs:extract -- --file logs/api.log --component VoiceGateway
```

### 3. Error Not Being Caught
Exception in stream processing may not be properly handled.

**Symptoms:**
- Backend logs show error but frontend doesn't receive `voiceError`
- Stream hangs without error message

**Check:**
```bash
# Check for errors
npm run logs:extract -- --file logs/api.log --errors
```

### 4. Timeout Not Firing
Query timeout may not be working correctly.

**Symptoms:**
- Stuck longer than 30 seconds (QUERY_TIMEOUT_MS)
- No timeout error message

**Check:**
- Look for `[VoiceGateway] Query timeout` in logs
- Verify `COST_LIMITS.QUERY_TIMEOUT_MS` is set correctly

## Debugging Steps

### Step 1: Check Backend Logs

```bash
# Start backend with logging
npm run dev:api 2>&1 | tee logs/voice-debug.log

# In another terminal, extract relevant logs
npm run logs:extract -- \
  --file logs/voice-debug.log \
  --component VoiceGateway \
  --output voice-gateway-debug.md

npm run logs:extract -- \
  --file logs/voice-debug.log \
  --component VoiceService \
  --output voice-service-debug.md
```

**Look for:**
- `[VoiceGateway] voiceQuery received` - Query received?
- `[VoiceGateway] Calling voiceService.streamVoiceResponse` - Service called?
- `[VoiceService] Calling Gemini API` - API called?
- `[VoiceService] Gemini API stream started` - Stream started?
- `[VoiceService] Voice response stream completed` - Stream completed?
- `[VoiceGateway] Voice query completed` - Query completed?

### Step 2: Check Frontend Console

Open browser DevTools Console and look for:

```javascript
// Should see these logs:
[ChatContainer] Emitting voiceQuery via WebSocket
[ChatContainer] Voice socket authenticated
[ChatContainer] Voice query started
// Then should see:
[ChatContainer] Voice chunk received (multiple times)
[ChatContainer] Voice response completed
```

**If missing:**
- Check WebSocket connection status
- Check for JavaScript errors
- Check network tab for WebSocket messages

### Step 3: Test Direct Service Call

Bypass WebSocket and test VoiceService directly:

```bash
npm run test:voice -- \
  --query "What is the foundation depth?" \
  --tenant-id "test-user" \
  --stream
```

**If this works:** Issue is in WebSocket layer
**If this fails:** Issue is in VoiceService or Gemini API

### Step 4: Check Gemini API Response

Add temporary logging to see if Gemini is responding:

```typescript
// In voice.service.ts, add after sendMessageStream:
for await (const chunk of result.stream) {
  console.log('[VoiceService] Chunk received:', {
    hasText: !!chunk.candidates?.[0]?.content?.parts?.[0]?.text,
    chunkIndex: chunkCount++,
  });
  // ... rest of code
}
```

## Common Fixes

### Fix 1: Add Timeout to Gemini Stream

```typescript
// In voice.service.ts
async *streamVoiceResponse(...) {
  const stream = this.voiceService.streamVoiceResponse(...);
  
  // Add timeout wrapper
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => reject(new Error('Stream timeout')), 30000);
  });
  
  try {
    for await (const chunk of Promise.race([stream, timeoutPromise])) {
      yield chunk;
    }
  } catch (error) {
    console.error('[VoiceService] Stream error:', error);
    throw error;
  }
}
```

### Fix 2: Ensure voiceEnd is Always Emitted

```typescript
// In voice.gateway.ts, ensure finally block always emits voiceEnd
try {
  // ... stream processing
} catch (error) {
  client.emit('voiceError', { message: error.message });
} finally {
  session.isActive = false;
  // Always emit voiceEnd, even on error
  if (!client.disconnected) {
    client.emit('voiceEnd', {
      fullText: fullResponse || '',
      audioChunks: audioChunkIndex,
      error: error?.message,
    });
  }
}
```

### Fix 3: Add Frontend Timeout

```typescript
// In ChatContainer.tsx, add timeout for voice responses
useEffect(() => {
  if (voiceState === 'processing') {
    const timeout = setTimeout(() => {
      console.error('[ChatContainer] Voice response timeout');
      setVoiceState('error');
      setChatError('Voice response timed out. Please try again.');
    }, 35000); // Slightly longer than backend timeout
    
    return () => clearTimeout(timeout);
  }
}, [voiceState]);
```

## Resources

### Official Documentation

1. **Gemini API Troubleshooting**
   - https://ai.google.dev/gemini-api/docs/troubleshooting
   - Common issues and solutions

2. **Gemini API Streaming**
   - https://ai.google.dev/gemini-api/docs/streaming
   - How streaming works and common pitfalls

3. **Google AI Developers Forum**
   - https://discuss.ai.google.dev/
   - Search for "streaming" or "timeout" issues

### GitHub Issues & Discussions

1. **Gemini CLI Issues**
   - https://github.com/google-gemini/gemini-cli/issues
   - Search for "stuck", "hanging", "timeout"

2. **Google Generative AI SDK**
   - https://github.com/google/generative-ai-nodejs
   - Check issues related to streaming

3. **NestJS WebSocket Issues**
   - https://github.com/nestjs/nest/issues
   - Search for "websocket" and "timeout"

### Community Forums

1. **Cursor Community**
   - https://forum.cursor.com/
   - Search for "Gemini thinking" or "Gemini stuck"

2. **Stack Overflow**
   - Search: "Gemini API streaming timeout"
   - Search: "Gemini sendMessageStream not completing"

3. **Reddit r/GoogleGemini**
   - https://www.reddit.com/r/GoogleGemini/
   - Community discussions

## Specific Issues to Check

### Issue 1: Gemini API Rate Limits

**Symptoms:**
- Works sometimes, fails other times
- Error messages about quota

**Check:**
```bash
# Check API quota in Google Cloud Console
# https://console.cloud.google.com/apis/api/generativelanguage.googleapis.com/quotas
```

**Fix:**
- Increase quota limits
- Add retry logic with exponential backoff
- Implement request queuing

### Issue 2: Network Timeout

**Symptoms:**
- Works locally, fails in production
- Intermittent failures

**Check:**
```bash
# Test network connectivity
curl -v https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:streamGenerateContent
```

**Fix:**
- Increase timeout values
- Add retry logic
- Check firewall/proxy settings

### Issue 3: Context Too Large

**Symptoms:**
- Works with simple queries
- Fails with complex queries or many documents

**Check:**
```bash
# Check context length in logs
npm run logs:extract -- --file logs/api.log --component VoiceService | grep contextLength
```

**Fix:**
- Limit context size
- Truncate long contexts
- Use document filtering

### Issue 4: Async Iterator Not Completing

**Symptoms:**
- Stream starts but never ends
- No error, just hangs

**Check:**
- Verify `for await` loop is properly handling stream completion
- Check if stream is being cancelled prematurely

**Fix:**
```typescript
// Ensure stream is properly consumed
let streamDone = false;
try {
  for await (const chunk of stream) {
    // Process chunk
  }
  streamDone = true;
} finally {
  if (!streamDone) {
    console.error('Stream did not complete normally');
  }
}
```

## Quick Diagnostic Script

Create a test script to isolate the issue:

```typescript
// scripts/test-voice-stream.ts
import { GoogleGenerativeAI } from '@google/generative-ai';

async function testStream() {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
  
  console.log('Starting stream test...');
  const startTime = Date.now();
  
  try {
    const chat = model.startChat({ history: [] });
    const result = await chat.sendMessageStream('Say hello');
    
    let chunkCount = 0;
    for await (const chunk of result.stream) {
      chunkCount++;
      const text = chunk.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text) {
        process.stdout.write(text);
      }
    }
    
    const duration = Date.now() - startTime;
    console.log(`\n\n✅ Stream completed: ${chunkCount} chunks in ${duration}ms`);
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`\n❌ Stream failed after ${duration}ms:`, error);
  }
}

testStream();
```

Run it:
```bash
ts-node scripts/test-voice-stream.ts
```

If this hangs, the issue is with Gemini API itself.
If this works, the issue is in your VoiceService implementation.

## Next Steps

1. **Run diagnostics** using the steps above
2. **Check logs** for specific error patterns
3. **Test isolated components** to find the failing layer
4. **Search GitHub/forums** for similar issues
5. **Report to Google** if it's a Gemini API issue

## Reporting Issues

If you find it's a Gemini API issue, report it:

1. **Google AI Issue Tracker**
   - https://issuetracker.google.com/issues?q=componentid:1164542
   - Component: Generative AI API

2. **Include in report:**
   - Model name (`gemini-2.0-flash`)
   - API method (`sendMessageStream`)
   - Error logs
   - Minimal reproduction code
   - Environment details

