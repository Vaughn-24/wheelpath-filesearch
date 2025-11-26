# Backend Debugging Guide - RFI 91 Document Error

## Issue Summary

**Document ID:** `47d092c9-67a5-435c-bdb3-20ff0c9a6dea`  
**Tenant ID:** `jpYI7ikH7sTzOXbIcdbjjA1jUkn1`  
**GCS Path:** `gs://wheelpath-uploads-dev/jpYI7ikH7sTzOXbIcdbjjA1jUkn1/47d092c9-67a5-435c-bdb3-20ff0c9a6dea.pdf`  
**Status:** `error` (in Firestore)  
**Error:** `TypeError: pdfParse is not a function`

---

## Backend Debugging Commands

### 1. Check GCS File Exists
```bash
gsutil ls -lh gs://wheelpath-uploads-dev/jpYI7ikH7sTzOXbIcdbjjA1jUkn1/47d092c9-67a5-435c-bdb3-20ff0c9a6dea.pdf
```

### 2. Check Firestore Document Status
```bash
# Use Firebase Console or Admin SDK
# Collection: documents
# Document ID: 47d092c9-67a5-435c-bdb3-20ff0c9a6dea
# Check: status field (should be 'error')
```

### 3. Check Cloud Function Logs for This Document
```bash
gcloud logging read \
  "resource.type=cloud_run_revision AND resource.labels.service_name=processdocument" \
  --limit=100 \
  --format="value(timestamp,textPayload)" \
  --order=desc | grep "47d092c9"
```

### 4. Check All Recent Errors
```bash
gcloud logging read \
  "resource.type=cloud_run_revision AND resource.labels.service_name=processdocument AND severity>=ERROR" \
  --limit=20 \
  --format="value(timestamp,severity,textPayload)" \
  --order=desc
```

### 5. Check Function Execution Details
```bash
gcloud logging read \
  "resource.type=cloud_run_revision AND resource.labels.service_name=processdocument AND timestamp>=\"2025-11-23T20:27:00Z\" AND timestamp<=\"2025-11-23T20:28:00Z\"" \
  --limit=50 \
  --format="value(timestamp,textPayload,jsonPayload)" \
  --order=desc
```

---

## Root Cause Analysis

### Error Location
- **File:** `dist/index.js:88` (compiled from `src/index.ts`)
- **Error:** `TypeError: pdfParse is not a function`
- **Context:** PDF parsing step during document ingestion

### Problem
The `pdf-parse` module is a CommonJS module being used in an ESM context. The `require()` approach with `createRequire` might not be correctly handling the module export.

### Current Code
```typescript
const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');
```

### Expected Behavior
- `pdf-parse` should export a function directly
- The function should accept a Buffer and options object
- Should return a Promise with PDF data

---

## Verification Steps

1. **Verify File Upload:**
   - ✅ File exists in GCS: `gs://wheelpath-uploads-dev/jpYI7ikH7sTzOXbIcdbjjA1jUkn1/47d092c9-67a5-435c-bdb3-20ff0c9a6dea.pdf`

2. **Verify Firestore Document:**
   - Check if document exists with `status: 'error'`
   - Verify `gcsPath` matches GCS location
   - Check `createdAt` timestamp

3. **Verify Function Trigger:**
   - Eventarc trigger should fire on GCS object finalize
   - Function should receive cloud event
   - Function should start processing

4. **Verify Processing Steps:**
   - ✅ Function receives event (log: "Processing 47d092c9...")
   - ❌ PDF parsing fails (error: "pdfParse is not a function")
   - ❌ Status update to 'error' (should happen in catch block)

---

## Next Steps

1. **Fix pdf-parse import** - Ensure correct module loading
2. **Test locally** - Verify pdf-parse works in ESM context
3. **Redeploy function** - Deploy fix to Cloud Function
4. **Retry processing** - Re-upload or manually trigger processing
5. **Verify success** - Check logs and Firestore status

---

## Manual Retry (After Fix)

Once the fix is deployed, you can manually trigger processing by:
1. Re-uploading the document, OR
2. Manually invoking the Cloud Function with the GCS event

