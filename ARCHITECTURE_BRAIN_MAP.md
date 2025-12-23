# WheelPath AI - Architecture Brain Map

## 🚀 Live Deployment

| Service          | URL                                                    | Status    |
| ---------------- | ------------------------------------------------------ | --------- |
| **Web Frontend** | https://wheelpath-web-l2phyyl55q-uc.a.run.app          | ✅ Live   |
| **API Backend**  | https://wheelpath-api-945257727887.us-central1.run.app | ✅ Live   |
| **GCP Project**  | `wheelpath-filesearch`                                 | ✅ Active |

---

## 🧠 System Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         USER BROWSER (Frontend)                          │
│              https://wheelpath-web-l2phyyl55q-uc.a.run.app              │
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
│  │ • VoiceOverlay → WebSocket /voice (real-time voice)         │      │
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
│  │ Modules:                                                       │      │
│  │ • CommonModule → RateLimitService (shared cost protections)  │      │
│  │ • DocumentsModule → Upload/view/delete documents             │      │
│  │ • RagModule → Text chat with RAG                             │      │
│  │ • VoiceModule → Real-time voice chat (WebSocket)             │      │
│  │                                                               │      │
│  │ Endpoints:                                                    │      │
│  │ • GET  / (Status & Version)                                   │      │
│  │ • POST /documents/upload-url [rate limited]                  │      │
│  │ • GET  /documents                                            │      │
│  │ • GET  /documents/:id                                        │      │
│  │ • DELETE /documents/:id                                      │      │
│  │ • POST /chat/stream (RAG + Gemini) [rate limited]           │      │
│  │ • WS   /voice (Voice + TTS) [rate limited]                  │      │
│  └──────────────────────────────────────────────────────────────┘      │
└──────────┬──────────────────────────────┬───────────────────────────────┘
           │                              │
    ┌──────▼──────┐              ┌────────▼────────┐
    │  Firestore  │              │  Google AI API  │
    │  (Metadata) │              │  (Gemini Chat)  │
    └─────────────┘              └─────────────────┘
           │                              │
           │                     ┌────────▼────────┐
           │                     │  Vertex AI      │
           │                     │  (Embeddings +  │
           │                     │   Vector Search)│
           │                     └─────────────────┘
           │
┌──────────▼──────────────────────────────────────────────────────────────┐
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

## 🤖 AI Services Configuration

### Chat Generation: Google AI API

| Setting           | Value                                 |
| ----------------- | ------------------------------------- |
| **SDK**           | `@google/generative-ai`               |
| **Model (Text)**  | `gemini-2.0-flash-exp`                |
| **Model (Voice)** | `gemini-3-pro-preview`                |
| **Auth**          | `GEMINI_API_KEY` environment variable |
| **Method**        | Streaming via `sendMessageStream()`   |

> **Note**: Vertex AI Gemini models (`gemini-1.5-flash`, `gemini-pro`) are not accessible in this GCP project. Using Google AI API instead.

### Voice TTS: Google Cloud Text-to-Speech

| Setting    | Value                                           |
| ---------- | ----------------------------------------------- |
| **SDK**    | `@google-cloud/text-to-speech`                  |
| **Voice**  | `en-US-Chirp3-HD-Zephyr` (Bright, professional) |
| **Format** | MP3, streamed in chunks                         |
| **Method** | Sentence-by-sentence streaming for low latency  |

### Embeddings: Vertex AI

| Setting        | Value                                              |
| -------------- | -------------------------------------------------- |
| **Model**      | `text-embedding-004`                               |
| **Dimensions** | 768                                                |
| **SDK**        | `@google-cloud/aiplatform` PredictionServiceClient |

### Vector Search: Vertex AI Matching Engine

| Setting               | Value                                                   |
| --------------------- | ------------------------------------------------------- |
| **Index ID**          | `4769674844222521344`                                   |
| **Endpoint ID**       | `6176249283310780416`                                   |
| **Deployed Index ID** | `wheelpath_streaming_deploy`                            |
| **Public Endpoint**   | `1495366374.us-central1-945257727887.vdb.vertexai.goog` |
| **Update Method**     | Streaming Updates                                       |

---

## 🔗 Data Models

### Firestore: `documents` Collection

```typescript
{
  id: string,
  tenantId: string,          // User's Firebase UID
  title: string,             // Original filename
  gcsPath: string,           // GCS path: {tenantId}/{id}.pdf
  status: 'uploading' | 'processing' | 'ready' | 'error',
  stats: {
    pageCount: number,
    chunkCount: number
  },
  createdAt: Timestamp
}
```

### Firestore: `documents/{id}/chunks` Subcollection

```typescript
{
  text: string,              // Chunk content
  index: number,             // Chunk position (0-based)
  pageNumber: number,        // Source page
  pageSpan: string           // e.g., "1-2"
}
```

### Vector Index Datapoint Format

```typescript
{
  datapointId: `${documentId}_${chunkIndex}`,
  featureVector: number[],   // 768 dimensions
  restricts: [{
    namespace: 'documentId',
    allowList: [documentId]
  }]
}
```

---

## 🔄 User Flows

### Flow 1: Document Upload

```
User selects PDF → Frontend
    │
    ▼
POST /documents/upload-url → API
    │ Creates Firestore doc (status: 'uploading')
    │ Generates signed URL
    ▼
PUT signed URL → GCS (direct browser upload)
    │
    ▼
Object finalize event → Eventarc
    │
    ▼
processDocument → Cloud Function
    │ Parse PDF, chunk text
    │ Generate embeddings (Vertex AI)
    │ Upsert vectors (Vertex AI Index)
    │ Save chunks (Firestore)
    │ Update status → 'ready'
    ▼
Real-time listener → Frontend updates UI
```

### Flow 2: Chat (RAG)

```
User types message → ChatInterface
    │
    ▼
[RATE LIMIT CHECK: 60 queries/hour, 2000 char max]
    │
    ▼
POST /chat/stream → API (RagController)
    │
    ▼
RagService.chatStream(tenantId, documentId, query, history)
    │
    ├─ If documentId === 'all':
    │     Query Firestore for ALL tenant documents
    │     Create filter with all document IDs
    │
    ├─ Generate query embedding (Vertex AI text-embedding-004)
    │
    ├─ Vector Search (Vertex AI Matching Engine)
    │     Find nearest neighbors with document filter
    │
    ├─ Fetch chunks from Firestore
    │
    ├─ Build context prompt with citations
    │
    └─ Stream response (Google AI API gemini-2.0-flash-exp)
         │
         ▼
    SSE stream → Frontend displays response with citations
    [Rate limit remaining returned in response]
```

### Flow 3: Voice Chat

```
User opens VoiceOverlay → Frontend
    │
    ▼
WebSocket connect → /voice namespace
    │ Firebase token authentication
    │
    ▼
[SESSION LIMITS: 30 min max, 10 queries/min]
    │
    ▼
User speaks → Browser Speech Recognition → Text
    │ [15 sec silence timeout, 60 sec max listening]
    │
    ▼
voiceQuery event → VoiceGateway
    │
    ▼
VoiceService.streamVoiceResponse(tenantId, documentId, query)
    │
    ├─ Same RAG retrieval as text chat
    │
    ├─ Voice-optimized prompt (concise, no citations)
    │
    └─ Stream response (Gemini 3 Pro)
         │
         ▼
    For each sentence:
         │
         ├─ Convert to audio (Google TTS Zephyr voice)
         │   [100 TTS calls/hour limit, 2000 char max response]
         │
         └─ Stream audio chunk → Frontend plays immediately
              │
              ▼
         Progressive audio playback (1-2s latency)
```

---

## 🛡️ Authentication Flow

```
Browser → Firebase Anonymous Auth
    │ Signs in automatically on page load
    │
    ▼
Get ID Token → user.getIdToken()
    │
    ▼
API Request → Authorization: Bearer {token}
    │
    ▼
JwtAuthGuard → Verifies Firebase ID token
    │ Extracts user.uid as tenantId
    │
    ▼
TenantGuard → Attaches tenantId to request
    │
    ▼
Controllers → Use @CurrentTenant() decorator
```

---

## 📁 Project Structure

```
wheelpath-ai/
├── apps/
│   ├── api/                     # NestJS Backend
│   │   ├── src/
│   │   │   ├── auth/            # Firebase Auth Guard
│   │   │   ├── common/          # RateLimitService (shared)
│   │   │   ├── documents/       # Document CRUD
│   │   │   ├── rag/             # RAG Service + Controller
│   │   │   ├── voice/           # Voice Gateway + Service
│   │   │   ├── tenant/          # Tenant isolation
│   │   │   └── main.ts          # App entry
│   │   ├── Dockerfile           # Docker build
│   │   └── package.json
│   │
│   └── web/                     # Next.js Frontend
│       ├── components/
│       │   ├── ChatInterface.tsx    # Text chat with rate limiting
│       │   ├── VoiceOverlay.tsx     # Voice chat with cost controls
│       │   ├── DocumentUploader.tsx
│       │   └── DocumentList.tsx
│       ├── lib/
│       │   ├── auth.tsx         # Auth context
│       │   └── firebase.ts      # Firebase init
│       ├── pages/
│       │   └── index.tsx        # Main page
│       ├── Dockerfile           # Docker build
│       └── package.json
│
├── packages/
│   ├── schemas/                 # Shared TypeScript types
│   └── validation/              # Shared validation
│
├── workers/
│   └── ingestion/              # Cloud Function source
│
├── cloudbuild.api.yaml         # API deployment config
├── cloudbuild.web.yaml         # Web deployment config
├── Dockerfile.api              # API Docker build
└── Dockerfile.web              # Web Docker build
```

---

## 🚀 Deployment

### Deploy API

```bash
gcloud builds submit --config=cloudbuild.api.yaml .
```

### Deploy Web

```bash
gcloud builds submit --config=cloudbuild.web.yaml .
```

### Environment Variables (API - Cloud Run)

| Variable                        | Description                                             |
| ------------------------------- | ------------------------------------------------------- |
| `GCP_PROJECT`                   | `wheelpath-filesearch`                                  |
| `GCP_LOCATION`                  | `us-central1`                                           |
| `GCS_BUCKET_NAME`               | `wheelpath-uploads-dev`                                 |
| `GEMINI_API_KEY`                | Google AI API key                                       |
| `VERTEX_INDEX_ENDPOINT_ID`      | `6176249283310780416`                                   |
| `VERTEX_DEPLOYED_INDEX_ID`      | `wheelpath_streaming_deploy`                            |
| `VERTEX_PUBLIC_ENDPOINT_DOMAIN` | `1495366374.us-central1-945257727887.vdb.vertexai.goog` |
| `GEMINI_VOICE_MODEL`            | `gemini-3-pro-preview`                                  |

---

## 🛡️ Cost Protection Limits

All limits are configurable via environment variables. These protect against runaway costs.

### Text Chat Limits

| Limit                 | Default | Env Var                     | UX Impact                  |
| --------------------- | ------- | --------------------------- | -------------------------- |
| Queries/hour          | 60      | `CHAT_QUERIES_PER_HOUR`     | Shows remaining in header  |
| Query max chars       | 2000    | `CHAT_QUERY_MAX_LENGTH`     | Char counter while typing  |
| History max messages  | 20      | `CHAT_HISTORY_MAX_MESSAGES` | Auto-trimmed (invisible)   |
| Response max tokens   | 2000    | `CHAT_RESPONSE_MAX_TOKENS`  | Shows "[truncated]" if hit |
| Cooldown between msgs | 2s      | Frontend only               | Shows countdown timer      |

### Voice Chat Limits

| Limit                | Default | Env Var                         | UX Impact                    |
| -------------------- | ------- | ------------------------------- | ---------------------------- |
| Session max duration | 30 min  | `VOICE_MAX_SESSION_MS`          | Auto-disconnect with message |
| Idle timeout         | 5 min   | `VOICE_IDLE_TIMEOUT_MS`         | Warning at 4 min, close at 5 |
| Queries/minute       | 10      | `VOICE_MAX_QUERIES_PER_MIN`     | Shows rate limit message     |
| Query cooldown       | 2s      | `VOICE_QUERY_COOLDOWN_MS`       | Prevents rapid queries       |
| Query timeout        | 30s     | `VOICE_QUERY_TIMEOUT_MS`        | Cancels long queries         |
| Response max chars   | 2000    | `VOICE_MAX_RESPONSE_CHARS`      | Truncates response           |
| TTS calls/hour       | 100     | `VOICE_MAX_TTS_PER_HOUR`        | Falls back to browser TTS    |
| Sessions/tenant      | 3       | `VOICE_MAX_SESSIONS_PER_TENANT` | Rejects new connections      |
| Silence timeout      | 15s     | Frontend only                   | Auto-stops listening         |
| Max listening        | 60s     | Frontend only                   | Hard stop on listening       |

### Document Upload Limits

| Limit         | Default | Env Var                 | UX Impact                     |
| ------------- | ------- | ----------------------- | ----------------------------- |
| Uploads/hour  | 10      | `DOCS_UPLOADS_PER_HOUR` | Shows error with reset time   |
| Max documents | 50      | `DOCS_PER_TENANT_MAX`   | Shows "delete to upload more" |
| Max file size | 25 MB   | `DOC_MAX_SIZE_MB`       | Rejects with size message     |
| Max storage   | 500 MB  | `STORAGE_PER_TENANT_MB` | Shows storage usage           |

### Ingestion Limits (Cloud Function)

| Limit           | Default | Env Var                     |
| --------------- | ------- | --------------------------- |
| Max pages       | 200     | `INGESTION_MAX_PAGES`       |
| Max chunks      | 500     | `INGESTION_MAX_CHUNKS`      |
| Max text length | 2 MB    | `INGESTION_MAX_TEXT_LENGTH` |

---

## ✅ Working Features

### Core Features

- [x] Anonymous authentication (Firebase)
- [x] PDF upload with progress tracking
- [x] Document processing pipeline (Cloud Function)
- [x] Text chunking and embedding generation
- [x] Vector index upsert (streaming updates)
- [x] Real-time document list updates
- [x] Chat with single document
- [x] Chat with ALL documents (multi-document RAG)
- [x] Streaming AI responses
- [x] Citation display with page numbers
- [x] Click citation to view source page

### Voice Features

- [x] Real-time voice chat (WebSocket)
- [x] Browser speech recognition
- [x] Streaming TTS (Google Chirp3 HD Zephyr voice)
- [x] Progressive audio playback (~1-2s latency)
- [x] Voice-optimized prompts (concise, no markdown)

### Cost Protections

- [x] Rate limiting across all features
- [x] Query length limits
- [x] Session timeouts (voice)
- [x] TTS cost controls with browser fallback
- [x] Document upload limits
- [x] Ingestion safeguards (page/chunk limits)
- [x] Usage stats returned to frontend

---

## 🔧 Troubleshooting

### "Gemini model not found" (404)

- **Cause**: Vertex AI Gemini models not accessible in project
- **Fix**: Use Google AI API with `GEMINI_API_KEY` instead

### "Vector Search UNIMPLEMENTED"

- **Cause**: Using wrong endpoint format
- **Fix**: Use public endpoint domain: `{id}.{region}-{project}.vdb.vertexai.goog`

### "Chat not sending messages"

- **Cause**: Form submission issues with browser automation
- **Fix**: Use direct button `onClick` instead of form `onSubmit`

### "System instruction invalid"

- **Cause**: Google AI SDK format differs from Vertex AI
- **Fix**: Use history-based system prompt instead of `systemInstruction`

---

---

## 🔐 Developer Access & Secrets

### Where Secrets Are Stored

| Secret           | Location                               |
| ---------------- | -------------------------------------- |
| `GEMINI_API_KEY` | Cloud Run env var / GCP Secret Manager |
| `ADMIN_API_KEY`  | Cloud Run env var / GCP Secret Manager |
| Firebase Config  | Cloud Run build args                   |

### Access Admin Metrics

```bash
# Get your admin key from GCP Console or team lead
curl -H "x-admin-key: YOUR_ADMIN_KEY" \
  https://wheelpath-api-945257727887.us-central1.run.app/admin/metrics
```

### View Secrets in GCP

```bash
# List Cloud Run env vars
gcloud run services describe wheelpath-api --region=us-central1 --format='yaml(spec.template.spec.containers[0].env)'

# Or use Secret Manager (if migrated)
gcloud secrets list
gcloud secrets versions access latest --secret=ADMIN_API_KEY
```

### Local Development

Copy `.env.example` to `.env` and fill in values from GCP or team lead.

---

_Last Updated: November 28, 2025_
