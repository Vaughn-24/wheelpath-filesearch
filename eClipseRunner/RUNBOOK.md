# RUNBOOK.md

_Operational Guide for eClipseRunner_

---

## 📌 System Overview

eClipseRunner automates the Philadelphia eCLIPSE contractor portal.

- Users send SMS commands to a Twilio number.
- Express server parses requests and enqueues jobs in Redis.
- A Playwright worker logs into eCLIPSE with your GC credentials, retrieves permit/inspection data, and replies via SMS.

---

## 🧰 Prerequisites

- Node.js v20+
- npm / pnpm
- Redis (local Docker or cloud instance)
- Twilio account with phone number
- Valid eCLIPSE GC credentials
- `.env` with:
  - Twilio SID / Auth Token / Number
  - Redis URL
  - Allowed phone numbers
  - eCLIPSE credentials

---

## 🚀 Setup

1. Clone repo & install:

   ```bash
   git clone https://github.com/Vaughn-24/eClipseRunner.git
   cd eClipseRunner
   npm install
   npm run playwright:install
   ```

2. Configure `.env` (copy from `.env.example`):

   ```bash
   cp .env.example .env
   # Edit .env with your credentials
   ```

3. Start Redis:

   ```bash
   docker run -d -p 6379:6379 redis:7
   ```

4. Run development servers:

   ```bash
   # Terminal 1 - Server
   npm run dev:server

   # Terminal 2 - Worker
   npm run dev:worker
   ```

5. Expose webhook with ngrok:

   ```bash
   npx ngrok http 8080
   ```

6. Update Twilio Console → Messaging webhook to ngrok URL + `/sms`

---

## ✅ Daily Health Checks

- **Server**: `curl http://localhost:8080/health` → should return `{"status":"healthy"}`
- **Worker logs**: Check logs show jobs being processed without errors
- **Redis**: `redis-cli ping` → should return `PONG`
- **SMS test**: Send `HELP` → should get command list back

---

## 🧪 Available Commands

### User Commands

- **HELP** → Show command list
- **STATUS <permit#|address>** → Get permit status + deep-link
  - Examples: `STATUS P2024-001`, `STATUS 123 Main St`
- **LIST OPEN** → Show top 5 open permits
- **FEES** → Get fees page deep-link
- **INSPECT <permit#> <time> notes: <text>** → Request inspection + deep-link
  - Example: `INSPECT P2024-001 FRI AM notes: Ready for final inspection`

### Admin Endpoints

- **GET /health** → System health check
- **GET /admin/queue** → View job queue status
- **POST /admin/queue/clear-failed** → Clear failed jobs

---

## 🚨 Common Issues & Fixes

### Login Issues

**Problem**: Login loops or "invalid credentials"
**Fix**:

- Check `ECLIPSE_EMAIL` and `ECLIPSE_PASSWORD` in `.env`
- Verify credentials work by manually logging into eCLIPSE portal
- Check for CAPTCHA or 2FA requirements

### Selector Issues

**Problem**: "Selector not found" errors
**Fix**:

- eCLIPSE portal may have changed their HTML structure
- Use Playwright codegen to update selectors:
  ```bash
  npx playwright codegen https://eclipsepermits.phila.gov
  ```
- Update selectors in `/src/rpa/` files

### Redis Connection

**Problem**: Redis connection errors
**Fix**:

- Check Redis is running: `docker ps | grep redis`
- Restart Redis: `docker restart <container-id>`
- Verify `REDIS_URL` in `.env`

### Webhook Issues

**Problem**: SMS not reaching server
**Fix**:

- Check ngrok is running and URL is current
- Update Twilio webhook URL in console
- Check server logs for incoming requests
- Verify Twilio credentials in `.env`

### Rate Limiting

**Problem**: Users hitting rate limits
**Fix**:

- Check current limits: `GET /admin/queue`
- Reset specific user: Use Redis CLI to delete `rate_limit:+1234567890`
- Adjust `RATE_LIMIT_ACTIONS_PER_HOUR` in `.env`

---

## 🔄 Recovery Procedures

### Server Restart

```bash
# Kill existing processes
pkill -f "tsx.*server"
pkill -f "tsx.*worker"

# Restart services
npm run dev:server &
npm run dev:worker &
```

### Redis Restart

```bash
# Find Redis container
docker ps | grep redis

# Restart Redis
docker restart <container-id>

# Or start new Redis if needed
docker run -d -p 6379:6379 redis:7
```

### Clear Stuck Jobs

```bash
# Connect to Redis
redis-cli

# Clear all jobs (nuclear option)
FLUSHALL

# Or clear specific queue
DEL bull:eclipse-jobs:*
```

### Reset User Rate Limits

```bash
# Connect to Redis
redis-cli

# Reset specific user
DEL rate_limit:+15551234567

# Reset all rate limits
DEL rate_limit:*
```

---

## 📂 Logs & Screenshots

### Log Locations

- **Server logs**: stdout of `npm run dev:server`
- **Worker logs**: stdout of `npm run dev:worker`
- **Error screenshots**: `/fails/` directory

### Log Levels

- **Development**: Debug level (verbose)
- **Production**: Info level (concise)

### Screenshot Naming

Error screenshots follow pattern: `error_{context}_{timestamp}.png`

- Example: `error_status_P2024-001_2024-01-15T10-30-45-123Z.png`

---

## 🧭 Deployment

### Environment Variables for Production

```bash
NODE_ENV=production
PORT=8080
TWILIO_ACCOUNT_SID=your_sid
TWILIO_AUTH_TOKEN=your_token
TWILIO_PHONE_NUMBER=+15551234567
REDIS_URL=redis://your-redis-instance:6379
ECLIPSE_EMAIL=your_gc_email@example.com
ECLIPSE_PASSWORD=your_password
ALLOWED_PHONE_NUMBERS=+15551111111,+15552222222
RATE_LIMIT_ACTIONS_PER_HOUR=6
```

### Hosting Platforms

#### Render / Railway / Fly.io

1. Connect GitHub repo
2. Set environment variables in dashboard
3. Ensure build command: `npm run build`
4. Ensure start command: `npm run start:server` (for server) or `npm run start:worker` (for worker)
5. Deploy server and worker as separate services

#### Redis

- **Development**: Local Docker container
- **Production**: Use managed Redis (Redis Cloud, AWS ElastiCache, etc.)

#### Important Notes

- Playwright requires additional dependencies in production
- Some hosts need specific buildpacks for Playwright
- Server and worker should be deployed as separate services for scalability

---

## 🔧 Development Tips

### Testing SMS Locally

1. Use ngrok to expose local server
2. Update Twilio webhook to ngrok URL
3. Send SMS to your Twilio number
4. Watch logs in terminal

### Debugging Playwright

```bash
# Run with UI (development)
NODE_ENV=development npm run dev:worker

# Generate selectors
npx playwright codegen https://eclipsepermits.phila.gov

# Take manual screenshots
await page.screenshot({ path: 'debug.png' });
```

### Queue Management

```bash
# Check queue status
curl http://localhost:8080/admin/queue

# Clear failed jobs
curl -X POST http://localhost:8080/admin/queue/clear-failed
```

---

## 📞 Support

### Before Reporting Issues

1. Check logs for error messages
2. Verify all environment variables are set
3. Test with `HELP` command first
4. Check eCLIPSE portal manually for changes

### Common Log Messages

- `Login failed: Invalid credentials` → Check eCLIPSE credentials
- `Selector not found` → eCLIPSE portal structure changed
- `Rate limit exceeded` → User hit hourly limit
- `Redis connection error` → Redis is down

---

## 🚀 Performance Tips

### Scaling

- Deploy multiple worker instances for higher throughput
- Use Redis Cluster for high availability
- Monitor job queue length and processing times

### Optimization

- Adjust `concurrency` in worker.ts for parallel job processing
- Tune Playwright timeouts based on eCLIPSE portal performance
- Use headless browser in production for better performance

---

_Last updated: 2024-01-15_
