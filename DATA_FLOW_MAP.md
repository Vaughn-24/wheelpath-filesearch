# WheelPath Data Flow Map - WHERE Information Goes

## Complete Data Destination Map

### 1. Document Upload Flow

#### Step 1: User Selects File
**Source:** Browser (DocumentUploader.tsx)
**Destination:** None yet (local file object)

---

#### Step 2: Request Upload URL
**Source:** Frontend → API
**Endpoint:** `POST /documents/upload-url`
**Request:** `{ filename: string, contentType: string }`
**Response:** `{ uploadUrl: string, documentId: string, gcsPath: string }`

**What Gets Created:**
- ✅ **Firestore:** `documents/{documentId}` document with:
  ```typescript
  {
    id: documentId,
    tenantId: user.uid,
    title: filename,
    gcsPath: "gs://wheelpath-uploads-dev/{tenantId}/{documentId}.pdf",
    mimeType: contentType,
    status: 'uploading',  // ← INITIAL STATUS
    createdAt: ISO timestamp
  }
  ```

**Where:** `projects/wheelpath-ai-dev/databases/(default)/documents/documents/{documentId}`

---

#### Step 3: Direct Upload to GCS
**Source:** Browser → GCS (direct PUT)
**Destination:** Google Cloud Storage Bucket

**Path:** `gs://wheelpath-uploads-dev/{tenantId}/{documentId}.pdf`

**Where:** 
- Bucket: `wheelpath-uploads-dev`
- Region: `us-central1`
- File: `{tenantId}/{documentId}.pdf`

**Status:** File physically stored in GCS ✅

---

#### Step 4: GCS Event Trigger
**Source:** GCS Object Finalize Event
**Destination:** Eventarc → Cloud Function

**Trigger Configuration:**
- Event Type: `google.cloud.storage.object.v1.finalized`
- Bucket: `wheelpath-uploads-dev`
- Destination: Cloud Function `processDocument`
- Region: `us-central1`

**Where:** Eventarc Trigger `processdocument-952199`

---

### 2. Ingestion Processing Flow

#### Step 5: Cloud Function Invocation
**Source:** Eventarc
**Destination:** Cloud Function `processDocument`

**Function Details:**
- Name: `processDocument`
- Type: Cloud Function Gen2 (runs on Cloud Run)
- Region: `us-central1`
- Memory: 1Gi
- Timeout: 60s
- Environment Variables:
  - `GCP_PROJECT=wheelpath-ai-dev`
  - `GCP_LOCATION=us-central1`
  - `VERTEX_INDEX_ID=370783908188389376` ✅

**Where:** `projects/wheelpath-ai-dev/locations/us-central1/functions/processDocument`

---

#### Step 6: Update Status to "processing"
**Source:** Cloud Function
**Destination:** Firestore

**Update:**
```typescript
documents/{documentId}.status = 'processing'
```

**Where:** `projects/wheelpath-ai-dev/databases/(default)/documents/documents/{documentId}`

---

#### Step 7: Download PDF from GCS
**Source:** GCS Bucket
**Destination:** Cloud Function Memory (Buffer)

**Path:** `gs://wheelpath-uploads-dev/{tenantId}/{documentId}.pdf`

**Where:** Temporary buffer in function memory

---

#### Step 8: Extract Text with Page Markers
**Source:** PDF Buffer
**Destination:** Text string with `[[[PAGE:N]]]` markers

**Process:** `pdf-parse` library
**Output:** Text string with embedded page markers

**Where:** Function memory (temporary)

---

#### Step 9: Chunk Text
**Source:** Text string
**Destination:** Array of chunk objects

**Process:** Split by page markers, then chunk each page (4000 chars, 400 overlap)
**Output:** `[{ text: string, page: number }]`

**Where:** Function memory (temporary)

---

#### Step 10: Generate Embeddings
**Source:** Text chunks
**Destination:** Vertex AI Embedding API

**Model:** `text-embedding-004`
**Input:** Chunk text
**Output:** 768-dimensional vector

**Where:** Vertex AI API response (temporary in function memory)

---

#### Step 11: Store Chunks in Firestore
**Source:** Chunk array with embeddings
**Destination:** Firestore Subcollection

**Path:** `documents/{documentId}/chunks/{index}`

**Data Structure:**
```typescript
{
  text: string,           // Original chunk text
  index: number,          // Chunk index (0, 1, 2, ...)
  pageNumber: number,     // Page number from PDF
  pageSpan: string        // "Page N"
}
```

**Where:** `projects/wheelpath-ai-dev/databases/(default)/documents/documents/{documentId}/chunks/{index}`

**Note:** One document per chunk (not an array)

---

#### Step 12: Upsert Vectors to Vertex AI Index
**Source:** Embedding vectors + metadata
**Destination:** Vertex AI Vector Search Index

**Index:** `projects/945257727887/locations/us-central1/indexes/370783908188389376`
**Index Name:** `wheelpath-vector-index`

**Data Structure:**
```typescript
{
  datapointId: "{documentId}_{chunkIndex}",  // e.g., "abc123_0"
  featureVector: number[768],                 // Embedding vector
  restricts: [{
    namespace: 'documentId',
    allowList: [documentId]                   // Filter for queries
  }]
}
```

**Where:** Vertex AI Index `370783908188389376`
**Method:** `indexClient.upsertDatapoints()` (batched in groups of 50)

---

#### Step 13: Update Status to "ready"
**Source:** Cloud Function
**Destination:** Firestore

**Update:**
```typescript
documents/{documentId} = {
  status: 'ready',
  stats: {
    pageCount: number,
    chunkCount: number
  }
}
```

**Where:** `projects/wheelpath-ai-dev/databases/(default)/documents/documents/{documentId}`

---

### 3. RAG Query Flow

#### Step 14: User Asks Question
**Source:** ChatInterface.tsx
**Destination:** API `/chat/stream`

**Request:**
```typescript
{
  documentId: string | 'all',
  query: string,
  history: Message[]
}
```

---

#### Step 15: Embed Query
**Source:** User query string
**Destination:** Vertex AI Embedding API

**Model:** `text-embedding-004`
**Where:** Vertex AI PredictionsServiceClient

---

#### Step 16: Vector Search
**Source:** Query embedding
**Destination:** Vertex AI Index Endpoint

**Index Endpoint:** `projects/945257727887/locations/us-central1/indexEndpoints/8428049096996028416`
**Deployed Index ID:** `wheelpath_v1`
**Method:** `vectorSearchClient.findNeighbors()`

**Returns:** Top 5 nearest neighbors (chunk IDs)

**Where:** Vertex AI Index Endpoint `8428049096996028416`

---

#### Step 17: Fetch Chunks from Firestore
**Source:** Vector search results (chunk IDs)
**Destination:** Firestore Subcollection

**Path:** `documents/{documentId}/chunks/{chunkIndex}`

**Where:** `projects/wheelpath-ai-dev/databases/(default)/documents/documents/{documentId}/chunks/{index}`

---

#### Step 18: Generate Response with Gemini
**Source:** Retrieved chunks + user query
**Destination:** Vertex AI Gemini API

**Model:** `gemini-1.5-pro`
**Where:** Vertex AI GenerativeModel

**Output:** Streamed text response with citations `[1]`, `[2]`, etc.

---

#### Step 19: Display Response
**Source:** API SSE stream
**Destination:** ChatInterface.tsx

**Where:** Browser UI

---

## Data Storage Summary

| Data Type | Storage Location | Collection/Path |
|-----------|-----------------|-----------------|
| **Document Metadata** | Firestore | `documents/{documentId}` |
| **PDF Files** | GCS | `gs://wheelpath-uploads-dev/{tenantId}/{documentId}.pdf` |
| **Text Chunks** | Firestore | `documents/{documentId}/chunks/{index}` |
| **Vector Embeddings** | Vertex AI Index | Index `370783908188389376` |
| **Chat Messages** | Firestore | `chats/{chatId}` (if implemented) |

---

## Current Configuration Status

### ✅ Configured Correctly:
- GCS Bucket: `wheelpath-uploads-dev` ✅
- Firestore Database: `(default)` ✅
- Vertex AI Index: `370783908188389376` ✅
- Vertex AI Index Endpoint: `8428049096996028416` ✅
- Deployed Index ID: `wheelpath_v1` ✅
- Worker has `VERTEX_INDEX_ID` ✅
- API has `VERTEX_INDEX_ENDPOINT_ID` and `VERTEX_DEPLOYED_INDEX_ID` ✅

### ❓ Unknown Status:
- Are vectors actually being upserted? (Need to check Index stats)
- Are chunks being saved to Firestore? (Need to check Firestore)
- Is the function actually executing? (Need to check logs)

---

## Next Steps to Diagnose

1. **Check Firestore:** Verify if chunks subcollection exists for uploaded documents
2. **Check Vertex AI Index:** Verify if vectors are being stored (check vector count)
3. **Check Function Logs:** Verify if function is executing and where it's failing
4. **Test Upload:** Upload a new document and trace through each step

