# WheelPath Upload → Ingestion → Vectorization Flow

## Complete End-to-End Pipeline (CCC Verified)

### 1. SHOW (UI Layer) - DocumentUploader.tsx
**User Action:** Click or drag PDF file

**Code Path:**
- `handleFileChange()` or `handleDrop()` → `processFile(file)`
- Calls `POST /documents/upload-url` with `{ filename, contentType }`
- Receives `{ uploadUrl, documentId, gcsPath }`
- **Direct PUT** to GCS signed URL (bypasses API, goes straight to storage)
- ✅ **Status:** File uploaded to GCS

---

### 2. MOVE (API Layer) - DocumentsService.generateUploadUrl()
**Endpoint:** `POST /documents/upload-url`

**Code Path:**
- Generates UUID `documentId`
- Constructs GCS path: `${tenantId}/${documentId}.pdf`
- Creates GCS signed URL (write, 15min expiry)
- **Creates Firestore document** with `status: 'uploading'`
- Returns `{ uploadUrl, documentId, gcsPath }`
- ✅ **Status:** Firestore record created, URL generated

---

### 3. MOVE (Direct Upload) - Frontend → GCS
**Action:** Browser PUT request to signed URL

**What Happens:**
- File uploaded directly to `gs://wheelpath-uploads-dev/{tenantId}/{documentId}.pdf`
- GCS stores the file
- ✅ **Status:** File physically stored in GCS

---

### 4. MOVE (Event Trigger) - GCS → Eventarc → Cloud Function
**Trigger:** GCS Object Finalize Event

**Configuration:**
- **Eventarc Trigger:** `processdocument-952199`
- **Type:** `google.cloud.storage.object.v1.finalized`
- **Bucket:** `wheelpath-uploads-dev`
- **Destination:** Cloud Function `processDocument`
- **Permissions:** ✅ Eventarc Service Agent has `roles/run.invoker`

**What Happens:**
- GCS publishes event to Eventarc
- Eventarc invokes Cloud Function `processDocument`
- ✅ **Status:** Function triggered (after permission fix)

---

### 5. CHANGE (Ingestion Worker) - processDocument Cloud Function
**File:** `workers/ingestion/src/index.ts`

**Processing Steps:**

1. **Parse Event:**
   - Extracts `bucketName`, `fileName`, `contentType`
   - Validates PDF (`contentType.includes('pdf')`)
   - Parses path: `tenantId/documentId.pdf`
   - ✅ **Status:** Event parsed correctly

2. **Update Status:**
   - Sets Firestore `status: 'processing'`
   - ✅ **Status:** UI updates to "PROCESSING"

3. **Download PDF:**
   - `bucket.file(fileName).download()` → Buffer
   - ✅ **Status:** PDF downloaded from GCS

4. **Extract Text:**
   - Uses `pdf-parse` with custom `pagerender`
   - Injects `[[[PAGE:N]]]` markers for page tracking
   - Extracts text with page numbers
   - ✅ **Status:** Text extracted with page metadata

5. **Chunk Text:**
   - Splits by page markers
   - Chunks each page: 4000 chars, 400 overlap
   - Creates `{ text, page }[]` array
   - ✅ **Status:** Text chunked with page numbers

6. **Generate Embeddings:**
   - For each chunk: `model.embedContent(chunk.text)`
   - Gets embedding vector (768 dimensions for text-embedding-004)
   - ✅ **Status:** Embeddings generated

7. **Store Chunks in Firestore:**
   - Saves to `documents/{documentId}/chunks/{index}`
   - Stores: `{ text, index, pageNumber, pageSpan }`
   - ✅ **Status:** Chunks stored for retrieval

8. **Upsert Vectors to Vertex AI:**
   - Creates datapoints: `{ datapointId: '${documentId}_${i}', featureVector, restricts }`
   - Batches (50 at a time)
   - Calls `indexClient.upsertDatapoints()`
   - ✅ **Status:** Vectors indexed in Vertex AI

9. **Update Status:**
   - Sets Firestore `status: 'ready'`
   - Sets `stats: { pageCount, chunkCount }`
   - ✅ **Status:** Document ready for RAG queries

**Error Handling:**
- If any step fails → Sets `status: 'error'`
- ✅ **Status:** Errors are caught and reported

---

### 6. SHOW (UI Layer) - DocumentList.tsx
**Real-time Updates:**

- Subscribes to Firestore: `collection('documents').where('tenantId', '==', user.uid)`
- Watches for status changes: `uploading` → `processing` → `ready`
- ✅ **Status:** UI updates automatically via Firestore listeners

---

## Potential Gaps Identified

### ❌ Gap 1: Vector Cleanup on Re-upload
**Issue:** If a document is re-uploaded, old vectors remain in Vertex AI Index.
**Impact:** Duplicate vectors, potential confusion in search results.
**Fix Needed:** Delete old vectors before upserting new ones (or use upsert which should overwrite by datapointId).

### ⚠️ Gap 2: Worker Memory/Timeout
**Issue:** Large PDFs might exceed memory limits or timeout.
**Status:** We attempted to increase memory but command failed. Need to verify current limits.

### ✅ Gap 3: Permissions (FIXED)
**Issue:** Eventarc couldn't invoke Cloud Function.
**Status:** ✅ Fixed - Added invoker permissions.

---

## Verification Checklist

- [x] Frontend uploads to GCS successfully
- [x] Firestore document created with 'uploading' status
- [x] GCS trigger configured (Eventarc)
- [x] Cloud Function receives events (after permission fix)
- [x] PDF parsing works
- [x] Chunking preserves page numbers
- [x] Embeddings generated
- [x] Chunks stored in Firestore
- [x] Vectors upserted to Vertex AI
- [x] Status updates to 'ready'
- [x] UI reflects status changes

---

## Current Status

**✅ The line is now UNBROKEN** after fixing the Eventarc invoker permissions.

The pipeline flows: **UI → API → GCS → Eventarc → Worker → Firestore/Vertex → UI**

All 4 CCC pillars are connected:
- **STORE:** Firestore + GCS + Vertex AI ✅
- **MOVE:** API endpoints + Direct upload + Event trigger ✅
- **CHANGE:** PDF parsing + Chunking + Embedding + Indexing ✅
- **SHOW:** Real-time status updates ✅

