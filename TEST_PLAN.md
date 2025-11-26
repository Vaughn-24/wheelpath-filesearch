# WheelPath Ingestion Test Plan

## Test Execution Checklist

### Phase 1: Data Integrity Verification

#### Test 1.1: GCS File Upload Verification
**Objective:** Verify files are uploaded correctly to GCS

**Steps:**
1. Upload a test PDF via the UI
2. Check GCS bucket: `gs://wheelpath-uploads-dev/{tenantId}/{documentId}.pdf`
3. Verify file exists and size matches original

**Expected Result:** ✅ File exists in GCS with correct size

**Status:** ⏳ **PENDING TEST**

---

#### Test 1.2: Firestore Document Creation
**Objective:** Verify document metadata is created in Firestore

**Steps:**
1. After upload, check Firestore collection `documents`
2. Verify document exists with:
   - `id`: matches documentId
   - `tenantId`: matches user ID
   - `status`: `'uploading'` initially
   - `gcsPath`: correct GCS path
   - `title`: filename

**Expected Result:** ✅ Document created with all required fields

**Status:** ⏳ **PENDING TEST**

---

#### Test 1.3: PDF Extraction Verification
**Objective:** Verify PDF text extraction works correctly

**Steps:**
1. Upload a known PDF (e.g., 5-page document with specific text)
2. Monitor Cloud Function logs for extraction
3. Verify no "PDF Parsing Failed" errors
4. Check that text is extracted (sample verification)

**Expected Result:** ✅ Text extracted successfully, no errors

**Status:** ⏳ **PENDING TEST** (Latest deployment should have fixed this)

---

### Phase 2: Processing Verification

#### Test 2.1: Chunking Verification
**Objective:** Verify chunks are created correctly with page numbers

**Steps:**
1. Upload a multi-page PDF (e.g., 10 pages)
2. Wait for processing to complete (`status: 'ready'`)
3. Check Firestore subcollection: `documents/{id}/chunks`
4. Verify:
   - Chunk count matches expected (based on 4000 char chunks)
   - Each chunk has `pageNumber` field
   - `pageSpan` field is correct
   - Chunk text doesn't split mid-word/sentence

**Expected Result:** ✅ Chunks created with correct page numbers

**Status:** ⏳ **PENDING TEST**

**Sample Verification:**
- Document: 10 pages, ~50,000 characters
- Expected: ~13-15 chunks (4000 chars each, 400 overlap)
- Each chunk should have accurate `pageNumber`

---

#### Test 2.2: Embedding Generation
**Objective:** Verify all chunks are embedded successfully

**Steps:**
1. Check Cloud Function logs for embedding errors
2. Verify no chunks were skipped due to embedding failures
3. Count successful embeddings vs total chunks

**Expected Result:** ✅ All chunks embedded successfully

**Status:** ⏳ **PENDING TEST**

---

#### Test 2.3: Vector Storage Verification
**Objective:** Verify vectors are stored in Vertex AI Index

**Steps:**
1. After processing completes, check Vertex AI Index
2. Verify datapoints exist with format: `{documentId}_{chunkIndex}`
3. Count vectors should match chunk count
4. Verify `restricts` contain correct `documentId`

**Expected Result:** ✅ All vectors stored in Index

**Status:** ⏳ **PENDING TEST**

**Note:** Requires Vertex AI API access or Console verification

---

#### Test 2.4: Firestore Chunks Verification
**Objective:** Verify chunks are stored in Firestore

**Steps:**
1. Check `documents/{documentId}/chunks` subcollection
2. Verify chunk count matches `stats.chunkCount`
3. Sample check: Verify chunk text matches expected content
4. Verify `index` field is sequential (0, 1, 2, ...)

**Expected Result:** ✅ All chunks stored correctly

**Status:** ⏳ **PENDING TEST**

---

### Phase 3: End-to-End Retrieval Testing

#### Test 3.1: Sanity Check Retrieval
**Objective:** Verify retrieval returns correct chunks

**Test Document:** Upload a PDF containing the phrase "HVAC Ductwork"

**Steps:**
1. Upload test PDF
2. Wait for processing (`status: 'ready'`)
3. Query chat: "What does the document say about HVAC Ductwork?"
4. Verify:
   - Response contains relevant information
   - Citations `[1]`, `[2]` are present
   - Citations link to correct pages
   - Retrieved chunks contain the phrase

**Expected Result:** ✅ Correct chunks retrieved and cited

**Status:** ⏳ **PENDING TEST**

---

#### Test 3.2: Citation Accuracy Test
**Objective:** Verify citations point to correct pages

**Steps:**
1. Upload a multi-page PDF with known content on specific pages
2. Ask a question that should reference a specific page (e.g., "What's on page 5?")
3. Click citation `[1]` in response
4. Verify PDF viewer opens to correct page
5. Verify cited text matches page content

**Expected Result:** ✅ Citations link to correct pages

**Status:** ⏳ **PENDING TEST**

---

#### Test 3.3: Multi-Document Retrieval
**Objective:** Verify global chat searches across all documents

**Steps:**
1. Upload 3 different PDFs
2. Wait for all to process (`status: 'ready'`)
3. Use global chat (no document selected)
4. Ask a question that should match content from multiple documents
5. Verify:
   - Response cites multiple documents
   - Citations include `documentId` in metadata
   - PDF viewer switches to correct document when citation clicked

**Expected Result:** ✅ Retrieval works across all documents

**Status:** ⏳ **PENDING TEST**

---

### Phase 4: Performance & Monitoring

#### Test 4.1: Processing Time Measurement
**Objective:** Measure average processing time

**Steps:**
1. Upload 5 test PDFs of varying sizes:
   - Small: 1-2 pages
   - Medium: 5-10 pages
   - Large: 20+ pages
2. Record processing time for each (from `uploading` → `ready`)
3. Calculate average time per page/chunk

**Expected Result:** 
- Small: < 30s
- Medium: < 2min
- Large: < 5min

**Status:** ⏳ **PENDING TEST**

---

#### Test 4.2: Error Handling Verification
**Objective:** Verify errors are handled gracefully

**Steps:**
1. Upload a corrupted PDF (if possible)
2. Upload a non-PDF file (should be skipped)
3. Verify:
   - Status updates to `'error'` for failures
   - Error messages logged
   - UI shows error state
   - No crashes or unhandled exceptions

**Expected Result:** ✅ Errors handled gracefully

**Status:** ⏳ **PENDING TEST**

---

#### Test 4.3: Concurrent Processing
**Objective:** Verify multiple documents can process simultaneously

**Steps:**
1. Upload 5 PDFs simultaneously
2. Monitor Cloud Function logs
3. Verify:
   - All documents start processing
   - No conflicts or race conditions
   - All complete successfully
   - Status updates are accurate

**Expected Result:** ✅ Concurrent processing works correctly

**Status:** ⏳ **PENDING TEST**

---

## Test Execution Log

### Test Run 1: [DATE]
**Tester:** [NAME]
**Environment:** Production

| Test ID | Status | Notes |
|---------|--------|-------|
| 1.1 | ⏳ | |
| 1.2 | ⏳ | |
| 1.3 | ⏳ | |
| 2.1 | ⏳ | |
| 2.2 | ⏳ | |
| 2.3 | ⏳ | |
| 2.4 | ⏳ | |
| 3.1 | ⏳ | |
| 3.2 | ⏳ | |
| 3.3 | ⏳ | |
| 4.1 | ⏳ | |
| 4.2 | ⏳ | |
| 4.3 | ⏳ | |

---

## Quick Verification Commands

### Check GCS Files
```bash
gsutil ls -l gs://wheelpath-uploads-dev/**/*.pdf
```

### Check Firestore Documents
```bash
# Requires Firebase Admin SDK or Console
# Collection: documents
# Check: status, stats, createdAt
```

### Check Processing Logs
```bash
gcloud logging read \
  "resource.type=cloud_run_revision AND resource.labels.service_name=processdocument" \
  --limit=50 \
  --format="value(timestamp,textPayload)" \
  --order=desc
```

### Check Vertex AI Index
```bash
gcloud ai indexes describe 370783908188389376 --region=us-central1
```

### Check Function Status
```bash
gcloud functions describe processDocument --gen2 --region=us-central1
```

---

## Success Criteria

### Must Pass (Critical)
- ✅ All PDFs extract text successfully
- ✅ All chunks embedded and stored
- ✅ Retrieval returns correct chunks
- ✅ Citations link to correct pages
- ✅ No data loss or corruption

### Should Pass (Important)
- ✅ Processing completes within timeout
- ✅ Error handling works correctly
- ✅ Concurrent processing works
- ✅ Performance is acceptable

### Nice to Have (Enhancement)
- ⚠️ PDF metadata extraction
- ⚠️ Batch embedding optimization
- ⚠️ Monitoring dashboards
- ⚠️ Cost tracking

