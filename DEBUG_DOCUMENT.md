# Debugging Document Processing Issues

## Current Issue: RFI 91 Document Shows "Error" Status

### Error Found in Logs

**Error:** `TypeError: pdfParse is not a function`

**Recent Failures:**
- 2025-11-23 20:27:59 UTC: Document `47d092c9-67a5-435c-bdb3-20ff0c9a6dea` failed
- 2025-11-23 20:18:04 UTC: Document `7aa28f91-194d-4aa3-a73b-504b6e71d7f9` failed
- Both show: `Failed to parse PDF TypeError: pdfParse is not a function`

### Root Cause

The `pdf-parse` module is a CommonJS module, and we're using it in an ESM context. The `require()` approach with `createRequire` might not be working correctly in the Cloud Function runtime.

### Debugging Steps

1. **Check GCS File Upload:**
   ```bash
   gsutil ls -lh gs://wheelpath-uploads-dev/{tenantId}/*.pdf
   ```

2. **Check Firestore Document Status:**
   - Collection: `documents`
   - Look for document with `status: 'error'`
   - Check `gcsPath` to verify file exists

3. **Check Cloud Function Logs:**
   ```bash
   gcloud logging read \
     "resource.type=cloud_run_revision AND resource.labels.service_name=processdocument" \
     --limit=50 \
     --format="value(timestamp,textPayload)" \
     --order=desc
   ```

4. **Check Specific Document Processing:**
   - Find document ID from Firestore
   - Search logs for that document ID
   - Check for PDF parsing errors

### Next Steps

1. Fix the `pdf-parse` import issue
2. Verify the module is correctly required
3. Test with a sample PDF
4. Redeploy the function

