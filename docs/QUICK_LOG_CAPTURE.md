# Quick Log Capture Guide

## Option 1: If Backend is Already Running

**Copy the console output** from your backend terminal and paste it here, or:

1. **Select all text** in your backend terminal (Cmd+A / Ctrl+A)
2. **Copy** (Cmd+C / Ctrl+C)
3. **Save to file:**
   ```bash
   # Paste into a file
   pbpaste > logs/backend-output.log  # macOS
   # or manually create logs/backend-output.log and paste
   ```

## Option 2: Restart Backend with Log Capture

**Stop your current backend**, then restart with logging:

```bash
# Backend with log capture
npm run dev:api 2>&1 | tee logs/voice-test-$(date +%Y%m%d-%H%M%S).log
```

Then test the voice agent. When done, press Ctrl+C to stop.

## Option 3: Share Console Output Directly

Just **copy and paste** the console output from your backend terminal here. I can analyze it directly.

## What to Look For

When testing voice, look for these log entries:

### ✅ Success Flow:
```
[VoiceGateway] voiceQuery received
[VoiceGateway] Calling voiceService.streamVoiceResponse
[VoiceService] Calling Gemini API
[VoiceService] Gemini API stream started
[VoiceService] Chunk received (multiple times)
[VoiceService] Voice response stream completed
[VoiceGateway] Voice query completed
```

### ❌ Failure Indicators:
```
[VoiceGateway] Voice query error
[VoiceService] LLM streaming failed
ERROR
timeout
```

## Quick Analysis

Once you have logs saved:

```bash
# Extract voice-related logs
npm run logs:extract -- --file logs/backend-output.log --component VoiceGateway --output voice-debug.md

# Extract errors only
npm run logs:extract -- --file logs/backend-output.log --errors --output errors.md

# Create summary
npm run logs:summary -- --file logs/backend-output.log
```

