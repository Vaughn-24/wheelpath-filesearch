# WheelPath AI - Architecture Brain Map

## 🚀 Live Deployment

| Service | URL | Status |
|---------|-----|--------|
| **Web Frontend** | https://wheelpath-web-l2phyyl55q-uc.a.run.app | ✅ Live |
| **API Backend** | https://wheelpath-api-945257727887.us-central1.run.app | ✅ Live |
| **GCP Project** | `wheelpath-ai-dev` | ✅ Active |

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
│  │ • POST /chat/stream (RAG + Gemini)                          │      │
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
| Setting | Value |
|---------|-------|
| **SDK** | `@google/generative-ai` |
| **Model** | `gemini-2.0-flash-exp` |
| **Auth** | `GEMINI_API_KEY` environment variable |
| **Method** | Streaming via `sendMessageStream()` |

> **Note**: Vertex AI Gemini models (`gemini-1.5-flash`, `gemini-pro`) are not accessible in this GCP project. Using Google AI API instead.

### Embeddings: Vertex AI
| Setting | Value |
|---------|-------|
| **Model** | `text-embedding-004` |
| **Dimensions** | 768 |
| **SDK** | `@google-cloud/aiplatform` PredictionServiceClient |

### Vector Search: Vertex AI Matching Engine
| Setting | Value |
|---------|-------|
| **Index ID** | `4769674844222521344` |
| **Endpoint ID** | `6176249283310780416` |
| **Deployed Index ID** | `wheelpath_streaming_deploy` |
| **Public Endpoint** | `1495366374.us-central1-945257727887.vdb.vertexai.goog` |
| **Update Method** | Streaming Updates |

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
│   │   │   ├── documents/       # Document CRUD
│   │   │   ├── rag/             # RAG Service + Controller
│   │   │   ├── tenant/          # Tenant isolation
│   │   │   └── main.ts          # App entry
│   │   ├── Dockerfile           # Docker build
│   │   └── package.json
│   │
│   └── web/                     # Next.js Frontend
│       ├── components/
│       │   ├── ChatInterface.tsx
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
| Variable | Description |
|----------|-------------|
| `GCP_PROJECT` | `wheelpath-ai-dev` |
| `GCP_LOCATION` | `us-central1` |
| `GCS_BUCKET_NAME` | `wheelpath-uploads-dev` |
| `GEMINI_API_KEY` | Google AI API key |
| `VERTEX_INDEX_ENDPOINT_ID` | `6176249283310780416` |
| `VERTEX_DEPLOYED_INDEX_ID` | `wheelpath_streaming_deploy` |
| `VERTEX_PUBLIC_ENDPOINT_DOMAIN` | `1495366374.us-central1-945257727887.vdb.vertexai.goog` |

---

## ✅ Working Features

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
| Secret | Location |
|--------|----------|
| `GEMINI_API_KEY` | Cloud Run env var / GCP Secret Manager |
| `ADMIN_API_KEY` | Cloud Run env var / GCP Secret Manager |
| Firebase Config | Cloud Run build args |

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

*Last Updated: November 26, 2025*
