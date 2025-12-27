# Debugging with Logs

This guide explains how to extract, format, and reference logs for debugging and AI-assisted troubleshooting.

## Quick Start

### 1. Capture Logs

**Backend (NestJS):**
```bash
# Run API and save logs to file
npm run dev:api 2>&1 | tee logs/api-$(date +%Y%m%d-%H%M%S).log

# Or just pipe to extract script
npm run dev:api 2>&1 | node scripts/extract-logs.js --output debug-logs.md
```

**Frontend (Next.js):**
```bash
# Open browser DevTools Console
# Right-click → Save as... → save-logs.txt
# Then extract:
node scripts/extract-logs.js --file save-logs.txt --output frontend-logs.md
```

**Both:**
```bash
# Terminal 1: Backend
npm run dev:api 2>&1 | tee logs/backend.log

# Terminal 2: Frontend  
npm run dev:web 2>&1 | tee logs/frontend.log

# Then extract both:
node scripts/extract-logs.js --file logs/backend.log --output debug-backend.md
node scripts/extract-logs.js --file logs/frontend.log --output debug-frontend.md
```

### 2. Extract and Format Logs

**Basic extraction:**
```bash
node scripts/extract-logs.js --file logs.txt
```

**Filter by component:**
```bash
node scripts/extract-logs.js --file logs.txt --component RagService
node scripts/extract-logs.js --file logs.txt --component ChatContainer
```

**Filter by checkpoint:**
```bash
node scripts/extract-logs.js --file logs.txt --checkpoint 12
node scripts/extract-logs.js --file logs.txt --checkpoint 8
```

**Extract only errors:**
```bash
node scripts/extract-logs.js --file logs.txt --errors
```

**Save as markdown:**
```bash
node scripts/extract-logs.js --file logs.txt --output debug-logs.md
```

### 3. Create Summary

```bash
node scripts/log-summary.js --file logs.txt
node scripts/log-summary.js --file logs.txt --component RagService
```

### 4. Reference in Prompts

**Option 1: Attach markdown file**
```
I'm debugging an authentication issue. Here are the logs:
[Attach debug-logs.md]
```

**Option 2: Copy-paste summary**
```bash
node scripts/log-summary.js --file logs.txt | pbcopy  # macOS
node scripts/log-summary.js --file logs.txt | xclip  # Linux
```

**Option 3: Reference specific checkpoint**
```bash
node scripts/extract-logs.js --file logs.txt --checkpoint 8 --output checkpoint-8.md
```

## Log Components

### Frontend Components
- `[ChatContainer]` - Chat interface and request handling
- `[Auth]` - Authentication state and token management

### Backend Components
- `[HTTP]` - HTTP request/response logging
- `[JwtStrategy]` - JWT token validation
- `[RagController]` - Chat endpoint controller
- `[RagService]` - RAG service (Firestore, embeddings, Gemini)
- `[VoiceGateway]` - WebSocket voice gateway
- `[VoiceService]` - Voice service (context retrieval, streaming)

## Checkpoint Reference

The logs are tagged with checkpoint numbers that trace the request flow:

```
Frontend:
  [Checkpoint 1] User authenticated? Token available?
  [Checkpoint 2] processQuery() called? Parameters valid?
  [Checkpoint 3] Request constructed? Headers set?

Network:
  [Checkpoint 4] Request sent? Status code?
  [Checkpoint 5] CORS preflight successful?

Backend:
  [Checkpoint 6] Request received? Route matched?
  [Checkpoint 7] JWT Guard executed? Token extracted?
  [Checkpoint 8] Firebase Admin verified token?
  [Checkpoint 9] Tenant ID extracted?
  [Checkpoint 10] Controller method called?

Service Layer:
  [Checkpoint 11] Service method invoked?
  [Checkpoint 12] Firestore query successful?
  [Checkpoint 12.1] Embedding generated?
  [Checkpoint 12.2] Vector search successful?
  [Checkpoint 12.3] Chunks retrieved?
  [Checkpoint 13] Gemini API call successful?
  [Checkpoint 14] Response stream started?
```

## Common Debugging Scenarios

### Issue: 401 Unauthorized

```bash
# Extract authentication-related logs
node scripts/extract-logs.js --file logs.txt \
  --component JwtStrategy \
  --checkpoint 8 \
  --output auth-debug.md

# Or get summary
node scripts/log-summary.js --file logs.txt --component JwtStrategy
```

### Issue: Voice Stuck on "Thinking"

```bash
# Extract voice-related logs
node scripts/extract-logs.js --file logs.txt \
  --component VoiceGateway \
  --output voice-debug.md

# Check WebSocket connection
node scripts/extract-logs.js --file logs.txt \
  --component VoiceGateway \
  --checkpoint 6 \
  --output voice-connection.md
```

### Issue: No Network Requests

```bash
# Check frontend logs
node scripts/extract-logs.js --file frontend-logs.txt \
  --component ChatContainer \
  --checkpoint 3 \
  --output no-requests-debug.md

# Check if demo mode is active
grep -i "demo" frontend-logs.txt
```

### Issue: Slow Responses

```bash
# Extract all logs with timing info
node scripts/extract-logs.js --file logs.txt \
  --output performance-debug.md

# Look for duration fields in logs
grep -i "duration" logs.txt
```

## Advanced Usage

### Real-time Log Extraction

```bash
# Watch logs and extract errors in real-time
npm run dev:api 2>&1 | \
  tee logs/api.log | \
  grep --line-buffered -i "error\|failed\|warn" | \
  node scripts/extract-logs.js --errors
```

### Compare Two Log Sessions

```bash
# Extract logs from two sessions
node scripts/extract-logs.js --file logs/session1.log --output session1.md
node scripts/extract-logs.js --file logs/session2.log --output session2.md

# Then compare in your editor or use diff
diff session1.md session2.md
```

### Extract Specific Time Range

```bash
# Extract logs from specific time (ISO format)
node scripts/extract-logs.js \
  --file logs.txt \
  --time-range "2024-01-15T10:00:00-2024-01-15T11:00:00" \
  --output time-range.md
```

## Best Practices

1. **Save logs immediately** - Don't wait until you need them
   ```bash
   npm run dev:api 2>&1 | tee logs/api-$(date +%Y%m%d-%H%M%S).log
   ```

2. **Use descriptive filenames** - Include date/time and issue type
   ```bash
   logs/auth-401-20240115-143022.log
   logs/voice-stuck-20240115-150000.log
   ```

3. **Extract before debugging** - Create markdown summaries for easy reference
   ```bash
   node scripts/extract-logs.js --file logs.txt --output debug-summary.md
   ```

4. **Filter aggressively** - Use component/checkpoint filters to focus on relevant logs
   ```bash
   node scripts/extract-logs.js --file logs.txt --component RagService --checkpoint 13
   ```

5. **Include context** - When sharing logs, include:
   - What you were trying to do
   - Expected vs actual behavior
   - Relevant log file or summary

## Example Prompt Template

```
I'm debugging [ISSUE DESCRIPTION]. 

**What I did:**
- [Steps to reproduce]

**Expected behavior:**
- [What should happen]

**Actual behavior:**
- [What actually happened]

**Logs:**
[Attach debug-logs.md or paste summary]

**Relevant checkpoints:**
- Checkpoint X: [What happened]
- Checkpoint Y: [What failed]

Can you help identify the root cause?
```

## Script Reference

### extract-logs.js

Extract and format logs from files or stdin.

**Options:**
- `--file <path>` - Read logs from file
- `--component <name>` - Filter by component name
- `--checkpoint <number>` - Filter by checkpoint number
- `--errors` - Show only errors
- `--output <path>` - Save to file (use .md for markdown)
- `--time-range <start-end>` - Filter by time range

**Examples:**
```bash
# Basic extraction
node scripts/extract-logs.js --file logs.txt

# Extract errors only
node scripts/extract-logs.js --file logs.txt --errors --output errors.md

# Filter by component and checkpoint
node scripts/extract-logs.js --file logs.txt --component RagService --checkpoint 12

# Pipe from running process
npm run dev:api 2>&1 | node scripts/extract-logs.js --output live-logs.md
```

### log-summary.js

Create a summary of logs for quick reference.

**Options:**
- `--file <path>` - Read logs from file (required)
- `--component <name>` - Filter by component
- `--checkpoint <number>` - Filter by checkpoint

**Examples:**
```bash
# Full summary
node scripts/log-summary.js --file logs.txt

# Component-specific summary
node scripts/log-summary.js --file logs.txt --component VoiceGateway
```

## Troubleshooting

**Scripts not executable:**
```bash
chmod +x scripts/extract-logs.js
chmod +x scripts/log-summary.js
```

**No logs found:**
- Check that logs are being written (check console output)
- Verify log file path is correct
- Check log format matches expected patterns

**Script errors:**
- Ensure Node.js version >= 20
- Check that required files exist
- Verify log file encoding is UTF-8

