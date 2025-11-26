# WheelPath AI - Complete Architecture Brain Map

## 🧠 System Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         USER BROWSER (Frontend)                          │
│                    https://wheelpath-web-*.run.app                       │
└──────────────────────────────┬──────────────────────────────────────────┘
                               │ HTTPS
                               │ Firebase Auth (Anonymous)
                               │
┌──────────────────────────────▼──────────────────────────────────────────┐
│                    CLOUD RUN: wheelpath-web                              │
│                    Next.js Application                                   │
│  ┌──────────────────────────────────────────────────────────────┐      │
│  │ Components:                                                   │      │
│  │ • DocumentUploader → POST /documents/upload-url              │      │
│  │ • DocumentList → Firestore real-time listener                │      │
│  │ • ChatInterface → POST /chat/stream (SSE)                   │      │
│  └──────────────────────────────────────────────────────────────┘      │
└──────────────────────────────┬──────────────────────────────────────────┘
                               │
                    ┌──────────┴──────────┐
                    │                     │
         ┌──────────▼──────────┐  ┌──────▼──────────┐
         │  Firebase Auth      │  │  Firestore      │
         │  (Anonymous)        │  │  (Real-time)    │
         └─────────────────────┘  └─────────────────┘
                               │
                               │ API Calls (Bearer Token)
                               │
┌──────────────────────────────▼──────────────────────────────────────────┐
│                    CLOUD RUN: wheelpath-api                              │
│                    NestJS API Server                                     │
│  ┌──────────────────────────────────────────────────────────────┐      │
│  │ Endpoints:                                                    │      │
│  │ • GET  / (Status & Version)                                   │      │
│  │ • POST /documents/upload-url                                 │      │
│  │ • GET  /documents                                            │      │
│  │ • GET  /documents/:id                                        │      │
│  │ • DELETE /documents/:id                                      │      │
│  │ • POST /chat/stream                                          │      │
│  └──────────────────────────────────────────────────────────────┘      │
└──────────┬──────────────────────────────┬───────────────────────────────┘
           │                              │
    ┌──────▼──────┐              ┌────────▼────────┐
    │  Firestore  │              │  Vertex AI      │
    │  (Metadata) │              │  (RAG Service)  │
    └─────────────┘              └─────────────────┘
           │                              │
           │                              │
┌──────────▼──────────────────────────────▼───────────────────────────────┐
│                         GOOGLE CLOUD STORAGE                             │
│                    gs://wheelpath-uploads-dev                            │
│  ┌──────────────────────────────────────────────────────────────┐      │
│  │ Structure: {tenantId}/{documentId}.pdf                        │      │
│  │ • Direct upload via signed URL                               │      │
│  │ • Triggers Eventarc on object finalize                       │      │
│  └──────────────────────────────────────────────────────────────┘      │
└──────────────────────────────┬──────────────────────────────────────────┘
                               │
                               │ Eventarc Trigger
                               │ (google.cloud.storage.object.v1.finalized)
                               │
┌──────────────────────────────▼──────────────────────────────────────────┐
│              CLOUD FUNCTION (Gen2): processDocument                     │
│              Ingestion Worker                                           │
│  ┌──────────────────────────────────────────────────────────────┐    │
│  │ Process:                                                       │    │
│  │ 1. Download PDF from GCS                                      │    │
│  │ 2. Parse PDF (pdf-parse)                                      │    │
│  │ 3. Chunk text (4000 chars, 400 overlap)                        │    │
│  │ 4. Generate embeddings (text-embedding-004, 768 dims)        │    │
│  │ 5. Upsert to Vertex AI Index                                  │    │
│  │ 6. Save chunks to Firestore                                   │    │
│  │ 7. Update document status                                     │    │
│  └──────────────────────────────────────────────────────────────┘    │
└──────────┬──────────────────────────────┬───────────────────────────────┘
           │                              │
    ┌──────▼──────┐              ┌────────▼────────┐
    │  Firestore  │              │  Vertex AI      │
    │  (Chunks)   │              │  (Vectors)      │
    └─────────────┘              └─────────────────┘
```

---

## 🔗 Integration Points & Compatibility

### 1. Firebase Integration

#### Firestore (NoSQL Database)
**Usage:**
- **Collection: `documents`** - Document metadata
  ```typescript
  {
    id: string,
    tenantId: string,
    title: string,
    gcsPath: string,
    status: 'uploading' | 'processing' | 'ready' | 'error',
    stats: { pageCount, chunkCount },
    createdAt: timestamp
  }
  ```
- **Subcollection: `documents/{id}/chunks`** - Text chunks
  ```typescript
  {
    text: string,
    index: number,
    pageNumber: number,
    pageSpan: string
  }
  ```

**Compatibility:**
- ✅ Real-time listeners for UI updates
- ✅ Tenant isolation via `tenantId` field
- ✅ Subcollections for hierarchical data
- ✅ Security rules: `allow read, write: if request.auth != null`

**Potential Errors:**
- ❌ **NOT_FOUND**: Document deleted before processing completes
  - **Fix**: Defensive checks with `docSnap.exists` before update
- ❌ **Permission Denied**: Security rules block access
  - **Fix**: Ensure user is authenticated, rules allow access
- ❌ **Index Missing**: Query requires composite index
  - **Fix**: Create index in Firebase Console
- ❌ **Quota Exceeded**: Too many reads/writes
  - **Fix**: Optimize queries, use pagination

#### Firebase Authentication
**Usage:**
- Anonymous authentication for MVP
- JWT tokens passed to API via `Authorization: Bearer {token}`

**Compatibility:**
- ✅ Anonymous auth enabled
- ✅ Token validation via `admin.auth().verifyIdToken()`
- ✅ Tenant ID = `user.uid`

**Potential Errors:**
- ❌ **auth/admin-restricted-operation**: Anonymous auth not enabled
  - **Fix**: Enable in Firebase Console → Authentication → Sign-in method
- ❌ **Token Expired**: JWT token expired
  - **Fix**: Refresh token on frontend, retry request
- ❌ **Invalid Token**: Token malformed or invalid
  - **Fix**: Check token generation, ensure proper format

---

### 2. Cloud Run Integration

#### Web Frontend (Next.js)
**Service:** `wheelpath-web`
- **Runtime:** Node.js 20
- **Port:** 8080 (Cloud Run default)
- **Build:** Docker multi-stage build
- **Environment:** Firebase config baked into build

**Compatibility:**
- ✅ Standalone output for Cloud Run
- ✅ Environment variables at build time (`NEXT_PUBLIC_*`)
- ✅ Static assets served correctly
- ✅ Server-side rendering works

**Potential Errors:**
- ❌ **Build Failure**: TypeScript errors, missing dependencies
  - **Fix**: Fix TS errors, ensure all deps in package.json
- ❌ **Runtime Error**: Missing env vars, module not found
  - **Fix**: Verify env vars set, check imports
- ❌ **Port Binding**: App not listening on PORT env var
  - **Fix**: Use `process.env.PORT || 3000`, bind to `0.0.0.0`
- ❌ **Memory Limit**: OOM errors
  - **Fix**: Increase memory allocation, optimize bundle size

#### API Backend (NestJS)
**Service:** `wheelpath-api`
- **Runtime:** Node.js 20
- **Port:** 8080 (Cloud Run default)
- **Build:** Docker multi-stage build
- **Environment:** Vertex AI, Firestore, GCS configs

**Compatibility:**
- ✅ CORS configured for frontend URL
- ✅ Firebase Admin SDK initialized
- ✅ Vertex AI clients configured
- ✅ Health checks work

**Endpoints:**
- `GET /` - Service status and version info
- `GET /health` - Health check endpoint
- `POST /chat/stream` - RAG chat streaming endpoint
- `GET /documents` - List documents
- `POST /documents/upload-url` - Generate signed upload URL

**Potential Errors:**
- ❌ **404 on Root Path**: Root endpoint not configured
  - **Fix**: Use `@Get()` decorator (empty path) instead of `@Get('/')` in NestJS
- ❌ **CORS Error**: Frontend blocked by CORS
  - **Fix**: Verify `FRONTEND_URL` matches actual URL, check CORS config
- ❌ **Firebase Admin Init**: Multiple initialization attempts
  - **Fix**: Check `admin.apps.length` before init
- ❌ **Vertex AI Auth**: Service account lacks permissions
  - **Fix**: Grant `roles/aiplatform.user` to service account
- ❌ **Timeout**: Request exceeds 60s limit
  - **Fix**: Increase timeout, optimize queries, use streaming
- ❌ **Container Failed to Start**: Port or path misconfiguration
  - **Fix**: Ensure `app.listen(PORT || 8080, '0.0.0.0')` and CMD uses correct path (`dist/main.js` from `apps/api` directory)
- ❌ **Build Memory Error**: Out of memory during TypeScript compilation
  - **Fix**: Set `NODE_OPTIONS="--max-old-space-size=4096"` in Dockerfile before build

#### Cloud Function (Gen2) - Ingestion Worker
**Service:** `processDocument`
- **Runtime:** Node.js 20
- **Memory:** 2Gi
- **Timeout:** 300s
- **Trigger:** Eventarc (GCS object finalize)

**Compatibility:**
- ✅ Eventarc trigger configured
- ✅ Service account has GCS read permissions
- ✅ Firestore write permissions
- ✅ Vertex AI API access

**Potential Errors:**
- ❌ **Not Authenticated**: Eventarc can't invoke function
  - **Fix**: Grant `roles/run.invoker` to Eventarc service account
- ❌ **Memory Limit**: OOM during PDF processing
  - **Fix**: Increase memory to 2Gi+, optimize PDF parsing
- ❌ **Timeout**: Processing exceeds 300s
  - **Fix**: Increase timeout, optimize chunking/embedding
- ❌ **PDF Parse Error**: `pdfParse is not a function`
  - **Fix**: Correct CommonJS import handling
- ❌ **Embedding Error**: Invalid API call format
  - **Fix**: Use correct VertexAI SDK method
- ❌ **Vector Upsert Error**: Invalid dimension or format
  - **Fix**: Validate 768 dimensions, correct datapoint format

---

### 3. Vertex AI Integration

#### Embedding Model: `text-embedding-004`
**Specifications:**
- **Dimensions:** 768
- **Max Tokens:** 3072 per input
- **API:** VertexAI SDK `embedContent()`

**Compatibility:**
- ✅ Chunk size (4000 chars ≈ 1000 tokens) under limit
- ✅ Dimension validation (768) implemented
- ✅ Proper API usage via VertexAI SDK

**Potential Errors:**
- ❌ **Invalid Dimension**: Embedding not 768 dimensions
  - **Fix**: Validate dimension, check model version
- ❌ **Token Limit Exceeded**: Chunk too large
  - **Fix**: Reduce chunk size, split large chunks
- ❌ **API Quota**: Too many requests
  - **Fix**: Implement rate limiting, batch requests
- ❌ **Model Not Found**: Wrong model name/version
  - **Fix**: Verify model name, check region availability

#### Vector Search Index
**Index Name:** `wheelpath-streaming-index`
**Index ID:** `4769674844222521344`
**Endpoint Name:** `wheelpath-streaming-endpoint`
**Endpoint ID:** `6176249283310780416`
**Deployed Index ID:** `wheelpath_streaming_deploy`

**Compatibility:**
- ✅ Streaming Updates Enabled (`indexUpdateMethod: STREAM_UPDATE`)
- ✅ Upsert format: `{ datapointId, featureVector, restricts }`
- ✅ Search format: `{ datapoint, neighborCount, restricts }`
- ✅ Namespace filtering: `documentId` namespace

**Potential Errors:**
- ❌ **Index Not Found**: Index ID incorrect
  - **Fix**: Verify index exists, check region
- ❌ **Dimension Mismatch**: Vector dimension ≠ index dimension
  - **Fix**: Ensure 768 dimensions match index config
- ❌ **Upsert Failed**: Invalid datapoint format
  - **Fix**: Validate format, check batch size (max 50)
- ❌ **Search Failed**: Endpoint not deployed
  - **Fix**: Verify endpoint deployment, check deployed index ID

---

### 4. Google Cloud Storage Integration

#### Bucket: `wheelpath-uploads-dev`
**Structure:** `{tenantId}/{documentId}.pdf`

**Compatibility:**
- ✅ Signed URLs for direct upload
- ✅ Eventarc trigger on object finalize
- ✅ CORS configured for browser uploads

**Potential Errors:**
- ❌ **Signed URL Generation Failed**: Service account lacks `iam.serviceAccounts.signBlob`
  - **Fix**: Grant `roles/iam.serviceAccountTokenCreator`
- ❌ **Upload Failed**: CORS not configured
  - **Fix**: Set CORS policy on bucket
- ❌ **Trigger Not Firing**: Eventarc not configured
  - **Fix**: Verify trigger exists, check bucket name matches
- ❌ **File Not Found**: File deleted before processing
  - **Fix**: Add retry logic, verify file exists before processing

---

## 🚨 Complete Error Flow Map

### Upload Flow Errors

```
User Uploads PDF
    │
    ├─❌ Frontend: Firebase Auth Failed
    │     └─ Fix: Enable Anonymous Auth, check config
    │
    ├─❌ API: Signed URL Generation Failed
    │     └─ Fix: Grant iam.serviceAccounts.signBlob permission
    │
    ├─❌ GCS: Upload Failed (CORS)
    │     └─ Fix: Configure CORS on bucket
    │
    ├─❌ GCS: Upload Failed (Network)
    │     └─ Fix: Check network, retry upload
    │
    └─✅ Upload Success → GCS Object Finalize Event
          │
          ├─❌ Eventarc: Trigger Not Firing
          │     └─ Fix: Verify trigger config, check permissions
          │
          └─✅ Event Fired → Cloud Function Invoked
                │
                ├─❌ Function: Not Authenticated
                │     └─ Fix: Grant roles/run.invoker to Eventarc SA
                │
                ├─❌ Function: PDF Download Failed
                │     └─ Fix: Check GCS permissions, verify file exists
                │
                ├─❌ Function: PDF Parse Failed
                │     └─ Fix: Correct pdf-parse import, check PDF format
                │
                ├─❌ Function: Embedding Failed
                │     ├─ Dimension mismatch → Fix: Validate 768 dims
                │     ├─ Token limit → Fix: Reduce chunk size
                │     └─ API error → Fix: Check Vertex AI permissions
                │
                ├─❌ Function: Vector Upsert Failed
                │     ├─ Dimension mismatch → Fix: Ensure 768 dims
                │     ├─ Invalid format → Fix: Validate datapoint structure
                │     └─ Index not found → Fix: Verify index ID
                │
                ├─❌ Function: Firestore Write Failed
                │     ├─ NOT_FOUND → Fix: Defensive checks before update
                │     ├─ Permission denied → Fix: Check security rules
                │     └─ Quota exceeded → Fix: Optimize writes
                │
                └─✅ Processing Complete → Status: 'ready'
```

### Query Flow Errors

```
User Asks Question
    │
    ├─❌ Frontend: Auth Token Missing
    │     └─ Fix: Ensure user authenticated, refresh token
    │
    ├─❌ API: Token Validation Failed
    │     └─ Fix: Check token format, verify Firebase config
    │
    └─✅ Authenticated → RAG Service
          │
          ├─❌ RAG: Embedding Failed
          │     └─ Fix: Check Vertex AI API, validate query length
          │
          ├─❌ RAG: Vector Search Failed
          │     ├─ Endpoint not found → Fix: Verify endpoint ID
          │     ├─ Dimension mismatch → Fix: Ensure 768 dims
          │     └─ No results → Fix: Check index has vectors
          │
          ├─❌ RAG: Firestore Read Failed
          │     └─ Fix: Check permissions, verify chunk exists
          │
          ├─❌ RAG: Gemini API Failed
          │     ├─ Quota exceeded → Fix: Check API quotas
          │     ├─ Invalid prompt → Fix: Validate prompt format
          │     └─ Timeout → Fix: Increase timeout, optimize prompt
          │
          └─✅ Response Generated → Streamed to Frontend
                │
                └─❌ Frontend: SSE Connection Failed
                      └─ Fix: Check network, verify SSE format
```

---

## 🔧 Service Account Permissions Matrix

| Service Account | Needs Permissions For | Required Roles |
|----------------|----------------------|----------------|
| **Cloud Run (API)** | Sign GCS URLs, Read Firestore, Call Vertex AI | `roles/iam.serviceAccountTokenCreator`, `roles/datastore.user`, `roles/aiplatform.user` |
| **Cloud Run (Web)** | None (static app) | None |
| **Cloud Function** | Read GCS, Write Firestore, Call Vertex AI | `roles/storage.objectViewer`, `roles/datastore.user`, `roles/aiplatform.user` |
| **Eventarc** | Invoke Cloud Function | `roles/run.invoker` |
| **GCS Service Agent** | Publish to Pub/Sub (for Eventarc) | `roles/pubsub.publisher` |

---

## 📊 Data Flow with Error Checkpoints

```
┌─────────────┐
│   Browser   │
└──────┬──────┘
       │ 1. Upload Request
       │    ❌ Auth Error → Check Firebase Auth
       ▼
┌─────────────┐
│  Cloud Run   │
│  (Web/API)  │
└──────┬──────┘
       │ 2. Generate Signed URL
       │    ❌ Permission Error → Check IAM
       ▼
┌─────────────┐
│     GCS     │
└──────┬──────┘
       │ 3. Upload File
       │    ❌ CORS Error → Configure CORS
       │    ❌ Network Error → Retry
       ▼
┌─────────────┐
│  Eventarc   │
└──────┬──────┘
       │ 4. Trigger Function
       │    ❌ Not Authenticated → Grant invoker role
       ▼
┌─────────────┐
│   Cloud     │
│  Function   │
└──────┬──────┘
       │ 5. Process PDF
       │    ❌ PDF Parse Error → Fix import
       │    ❌ Memory Error → Increase memory
       │    ❌ Timeout → Increase timeout
       ▼
┌─────────────┐
│  Vertex AI  │
└──────┬──────┘
       │ 6. Generate Embeddings
       │    ❌ Dimension Error → Validate 768
       │    ❌ API Error → Check permissions
       ▼
┌─────────────┐
│  Vertex AI  │
│   Index     │
└──────┬──────┘
       │ 7. Upsert Vectors
       │    ❌ Format Error → Validate structure
       │    ❌ Dimension Error → Ensure 768 dims
       ▼
┌─────────────┐
│  Firestore  │
└──────┬──────┘
       │ 8. Save Chunks
       │    ❌ NOT_FOUND → Defensive checks
       │    ❌ Permission → Check rules
       ▼
┌─────────────┐
│   Status    │
│   'ready'   │
└─────────────┘
```

---

## 🎯 Key Compatibility Points

### Firebase + Cloud Run
- ✅ **Firebase Admin SDK** works in Cloud Run (server-side)
- ✅ **Firebase Client SDK** works in Next.js (browser-side)
- ✅ **Real-time listeners** work for Firestore updates
- ✅ **Security rules** enforce tenant isolation

### Cloud Run + Vertex AI
- ✅ **Service accounts** authenticate API calls
- ✅ **Environment variables** configure endpoints
- ✅ **SDK clients** work in Node.js runtime
- ✅ **Streaming responses** work via SSE

### Cloud Function + All Services
- ✅ **Eventarc triggers** invoke functions reliably
- ✅ **GCS integration** via Storage SDK
- ✅ **Firestore writes** via Admin SDK
- ✅ **Vertex AI API** via SDK clients

---

## 🚀 Deployment Process

### API Deployment to Cloud Run

**Build & Deploy Command:**
```bash
gcloud builds submit --config cloudbuild.api.yaml .
```

**Key Requirements:**
1. **Root Endpoint**: Must use `@Get()` (empty path) not `@Get('/')` in NestJS
2. **Port Binding**: Must listen on `0.0.0.0:8080` (Cloud Run default PORT=8080)
3. **Dockerfile CMD**: Must use correct path from working directory (`dist/main.js` from `apps/api`)
4. **Build Memory**: Set `NODE_OPTIONS="--max-old-space-size=4096"` for TypeScript compilation
5. **IAM Permissions**: Cloud Build service account needs `roles/run.admin` and `roles/iam.serviceAccountUser`

**Common Deployment Issues:**

| Issue | Symptom | Solution |
|-------|---------|----------|
| 404 on `/` | Root endpoint returns 404 | Use `@Get()` instead of `@Get('/')` |
| Container won't start | "failed to start and listen on PORT" | Ensure `app.listen(PORT || 8080, '0.0.0.0')` |
| Module not found | "Cannot find module" error | Fix CMD path: `WORKDIR /app/apps/api` then `CMD ["node", "dist/main.js"]` |
| Build OOM | "JavaScript heap out of memory" | Add `ENV NODE_OPTIONS="--max-old-space-size=4096"` before build |
| Permission denied | "PERMISSION_DENIED" on deploy | Grant `roles/run.admin` to Cloud Build service account |

**Service URL:**
- Production: `https://wheelpath-api-945257727887.us-central1.run.app`
- Health Check: `https://wheelpath-api-945257727887.us-central1.run.app/health`

---

## 🛡️ Error Prevention Checklist

- [x] Firebase Anonymous Auth enabled
- [x] Firestore security rules configured
- [x] Service accounts have correct IAM roles
- [x] Eventarc trigger has invoker permission
- [x] GCS CORS configured
- [x] Vertex AI Index dimension matches (768)
- [x] Chunk size under token limit (4000 chars < 3072 tokens)
- [x] PDF parsing import fixed
- [x] Embedding dimension validation added
- [x] Defensive Firestore checks implemented
- [x] Error handling in all critical paths
- [x] Logging for debugging

---

This brain map shows all integration points, compatibility checks, and potential error scenarios across Firebase, Cloud Run, Vertex AI, and GCS.

