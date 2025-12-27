# Voice Agent Architecture

## Overview

The WheelPath Voice Agent is a **standard Google Gemini voice agent** with **RAG (Retrieval Augmented Generation) context injection** from user-uploaded documents.

## Core Architecture

```
User Voice Input
    ↓
[Standard Gemini Voice Agent]
    ↓
+ RAG Context Injection (user documents)
    ↓
Gemini Response
```

## What Makes It Different

### Standard Gemini Voice Agent ✅
- Uses Google Gemini API (`gemini-2.0-flash` or `gemini-3-pro-preview`)
- Standard voice conversation capabilities
- Natural language understanding
- Conversational responses
- Same as any other Gemini voice agent

### Added RAG Layer 🔍
- **Document Context Retrieval**: Searches user-uploaded documents
- **Vector Search**: Finds relevant document chunks using embeddings
- **Context Injection**: Adds document context to system prompt
- **Tenant Isolation**: Each user only sees their own documents

## How It Works

### 1. Standard Voice Flow
```
User speaks → STT → Gemini API → TTS → User hears response
```

### 2. With RAG Context
```
User speaks → STT → [RAG: Find relevant docs] → Gemini API (with context) → TTS → User hears response
```

### Implementation Details

#### Step 1: Voice Input
- Browser Web Speech API transcribes speech to text
- Text sent to backend via WebSocket

#### Step 2: RAG Context Retrieval
```typescript
// apps/api/src/voice/voice.service.ts
private async retrieveContext(tenantId: string, documentId: string, query: string) {
  // 1. Query Firestore for user's documents
  const docs = await firestore.collection('documents')
    .where('tenantId', '==', tenantId)
    .get();
  
  // 2. Generate embedding for user query
  const embedding = await generateEmbedding(query);
  
  // 3. Vector search for relevant chunks
  const neighbors = await findNeighbors(embedding, documentFilter);
  
  // 4. Retrieve chunk text from Firestore
  const chunks = await firestore.getAll(...chunkRefs);
  
  // 5. Return context string
  return chunks.map(c => c.text).join('\n\n');
}
```

#### Step 3: Context Injection
```typescript
// Build system prompt with context
const systemPrompt = `
You are WheelPath Voice — the calm, experienced field mentor.

PROJECT CONTEXT (from user's documents):
${context}  // ← RAG context injected here

Answer using ONLY the context above.
`;
```

#### Step 4: Standard Gemini Call
```typescript
// Standard Gemini API call (same as any Gemini voice agent)
const chat = model.startChat({ history: chatHistory });
const result = await chat.sendMessageStream(query);
// Returns standard Gemini response
```

## Key Components

### 1. VoiceService (`apps/api/src/voice/voice.service.ts`)
- **Standard Gemini API**: Uses `@google/generative-ai` SDK
- **RAG Layer**: `retrieveContext()` method adds document context
- **System Prompt**: Injects context into prompt

### 2. VoiceGateway (`apps/api/src/voice/voice.gateway.ts`)
- **WebSocket Handler**: Manages voice sessions
- **Standard Flow**: Receives text → calls VoiceService → streams response
- **No Custom Logic**: Just standard WebSocket message handling

### 3. Frontend (`apps/web/components/ChatContainer.tsx`)
- **Standard STT**: Browser Web Speech API
- **Standard TTS**: Google Cloud TTS or browser TTS
- **Standard WebSocket**: Socket.io for communication

## What's Standard vs Custom

### ✅ Standard (Same as Any Gemini Voice Agent)
- Gemini API calls
- Voice conversation flow
- Natural language understanding
- Response generation
- Streaming responses
- Error handling

### 🔍 Custom (RAG Layer Only)
- Document storage (Firestore)
- Vector search (Vertex AI)
- Context retrieval (`retrieveContext()`)
- Context injection into system prompt
- Tenant isolation

## Comparison

| Aspect | Standard Gemini Voice | WheelPath Voice Agent |
|--------|----------------------|----------------------|
| **Gemini API** | ✅ Yes | ✅ Yes (same) |
| **Voice Capabilities** | ✅ Yes | ✅ Yes (same) |
| **Conversation Flow** | ✅ Yes | ✅ Yes (same) |
| **Document Context** | ❌ No | ✅ Yes (RAG layer) |
| **Vector Search** | ❌ No | ✅ Yes (custom) |
| **Tenant Isolation** | ❌ No | ✅ Yes (custom) |

## The RAG Layer (The Only Difference)

The RAG layer is a **thin wrapper** around standard Gemini that:

1. **Before Gemini call**: Retrieves relevant document chunks
2. **During Gemini call**: Injects context into system prompt
3. **After Gemini call**: Returns standard Gemini response

```typescript
// Simplified flow
async streamVoiceResponse(query: string) {
  // 1. RAG: Get context (ONLY custom part)
  const context = await this.retrieveContext(tenantId, documentId, query);
  
  // 2. Standard: Build prompt with context
  const prompt = buildPrompt(context);
  
  // 3. Standard: Call Gemini (same as any Gemini voice agent)
  const result = await gemini.sendMessageStream(query);
  
  // 4. Standard: Return response (same as any Gemini voice agent)
  return result.stream;
}
```

## Why This Matters

### For Users
- **Same Experience**: Feels like talking to a standard Gemini voice agent
- **Added Value**: Responses are grounded in their project documents
- **No Learning Curve**: Standard voice conversation

### For Developers
- **Standard API**: Uses standard Gemini SDK, no custom APIs
- **Simple Architecture**: RAG is just a preprocessing step
- **Easy to Maintain**: Most code is standard Gemini usage

## Future: Gemini Live API

When migrating to Gemini Live API:

### What Stays the Same ✅
- RAG context retrieval
- Document storage
- Vector search
- Context injection

### What Changes 🔄
- Audio handling (PCM instead of STT/TTS)
- WebSocket protocol (direct audio streaming)
- Lower latency (native audio processing)

### The RAG Layer Remains
```typescript
// Future Gemini Live API flow
async handleLiveAudio(audio: Buffer) {
  // 1. RAG: Get context (still custom)
  const context = await this.retrieveContext(tenantId, documentId, transcribedText);
  
  // 2. Standard: Gemini Live API with context (standard API)
  const liveSession = await geminiLive.createSession({
    systemPrompt: buildPrompt(context) // ← RAG context injected
  });
  
  // 3. Standard: Stream audio (standard API)
  return liveSession.stream(audio);
}
```

## Summary

**WheelPath Voice Agent = Standard Gemini Voice Agent + RAG Context Layer**

- **95% Standard**: Uses standard Gemini APIs and patterns
- **5% Custom**: RAG layer for document context retrieval
- **Same Experience**: Users get standard Gemini voice conversation
- **Added Value**: Responses grounded in their documents

The RAG layer is transparent to the user - they just get better, more relevant responses because the agent has access to their project documents.

