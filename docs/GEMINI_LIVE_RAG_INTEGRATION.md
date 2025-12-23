# Gemini Live API + RAG Integration Guide

## ✅ Yes, Your Voice Agent Can Respond Based on Uploaded Documents!

The Gemini Live API fully supports RAG (Retrieval-Augmented Generation) with your existing document system. You can integrate your current vector search and document retrieval with the Live API.

---

## 🎯 Two Integration Approaches

### Approach 1: Function Calling (Recommended) ⭐

**How it works:**
- Pass your `retrieveContext` function as a **tool** to Gemini Live API
- When the user asks a question, Gemini automatically calls your function to retrieve relevant document chunks
- Gemini uses the retrieved context to generate a grounded response

**Advantages:**
- ✅ On-demand retrieval (only when needed)
- ✅ Lower latency (no pre-retrieval delay)
- ✅ More efficient (Gemini decides when to search)
- ✅ Supports multi-turn conversations with dynamic context

**Implementation:**

```typescript
// In VoiceService for Gemini Live API
async createLiveSession(tenantId: string, documentId: string) {
  const client = new genai.Client({ 
    apiKey: process.env.GEMINI_API_KEY,
    httpOptions: { api_version: 'v1alpha' }
  });

  // Define your RAG retrieval function as a tool
  const ragTool = {
    name: 'search_project_documents',
    description: 'Search through uploaded project documents to find relevant information. Use this when the user asks about project details, specifications, RFIs, or any information that might be in their documents.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search query to find relevant document chunks'
        }
      },
      required: ['query']
    }
  };

  const config = {
    speech_config: {
      voice_config: {
        prebuilt_voice_config: { voice_name: 'Puck' }
      }
    },
    system_instruction: {
      parts: [{ 
        text: this.buildVoiceSystemPrompt('') // Base prompt without context
      }]
    },
    tools: [ragTool] // Register your RAG function
  };

  const session = await client.live.connect({
    model: 'gemini-2.0-flash-exp',
    config
  });

  // Handle function calls from Gemini
  session.on('function_call', async (call) => {
    if (call.name === 'search_project_documents') {
      const query = call.args.query;
      
      // Use your existing retrieveContext method
      const context = await this.retrieveContext(tenantId, documentId, query);
      
      // Return context to Gemini
      session.send({
        functionResponse: {
          name: call.name,
          response: {
            context: context || 'No relevant information found in documents.'
          }
        }
      });
    }
  });

  return session;
}
```

---

### Approach 2: Context Injection (Current Pattern)

**How it works:**
- Retrieve document context **before** starting the Live API session
- Inject retrieved context into the system prompt
- Gemini uses the context throughout the conversation

**Advantages:**
- ✅ Simpler implementation (matches your current pattern)
- ✅ All context available upfront
- ✅ Good for focused, single-document queries

**Disadvantages:**
- ⚠️ Higher initial latency (must retrieve before starting)
- ⚠️ Context may become stale in long conversations
- ⚠️ Less efficient (retrieves even if not needed)

**Implementation:**

```typescript
// In VoiceService for Gemini Live API
async createLiveSessionWithContext(
  tenantId: string, 
  documentId: string,
  initialQuery?: string
) {
  const client = new genai.Client({ 
    apiKey: process.env.GEMINI_API_KEY,
    httpOptions: { api_version: 'v1alpha' }
  });

  // Retrieve context proactively (like your current implementation)
  let context = '';
  if (initialQuery) {
    context = await this.retrieveContext(tenantId, documentId, initialQuery);
  }

  const config = {
    speech_config: {
      voice_config: {
        prebuilt_voice_config: { voice_name: 'Puck' }
      }
    },
    system_instruction: {
      parts: [{ 
        text: this.buildVoiceSystemPrompt(context) // Inject context here
      }]
    }
  };

  const session = await client.live.connect({
    model: 'gemini-2.0-flash-exp',
    config
  });

  return session;
}
```

---

## 🔄 Hybrid Approach (Best of Both Worlds)

**Combine both methods:**
1. Start with initial context injection (if user mentions a document)
2. Use function calling for follow-up questions and dynamic retrieval

```typescript
async createLiveSessionHybrid(
  tenantId: string,
  documentId: string,
  initialContext?: string
) {
  const config = {
    speech_config: {
      voice_config: {
        prebuilt_voice_config: { voice_name: 'Puck' }
      }
    },
    system_instruction: {
      parts: [{ 
        text: this.buildVoiceSystemPrompt(initialContext || '')
      }]
    },
    tools: [{
      name: 'search_project_documents',
      description: 'Search through uploaded project documents...',
      // ... tool definition
    }]
  };

  // Handle both initial context AND dynamic function calls
  // ...
}
```

---

## 📋 Integration with Your Current Code

### Your Existing RAG Components (Keep These!)

✅ **Vector Search** (`findNeighbors` method)
- Vertex AI Index Endpoint
- Embedding generation
- Document chunk retrieval

✅ **Document Storage** (Firestore)
- Document metadata
- Chunk storage
- Tenant/document filtering

✅ **Context Building** (`buildVoiceSystemPrompt`)
- Your WheelPath Voice profile
- Context formatting
- Response guidelines

### What Changes

❌ **Remove:**
- Separate STT/TTS pipeline
- Text-based message passing
- Google Cloud TTS client

✅ **Add:**
- Gemini Live API WebSocket connection
- Function calling handler
- Raw PCM audio handling

---

## 🎤 Example: Full Voice Session with RAG

```typescript
// VoiceGateway.ts - WebSocket handler
@SubscribeMessage('startVoiceSession')
async handleStartVoiceSession(
  @ConnectedSocket() client: Socket,
  @MessageBody() data: { documentId: string }
) {
  const session = this.sessions.get(client.id);
  if (!session) {
    client.emit('error', { message: 'Not authenticated' });
    return;
  }

  // Create Live API session with RAG support
  const liveSession = await this.voiceService.createLiveSessionWithRAG(
    session.tenantId,
    data.documentId || 'all'
  );

  // Handle audio from browser
  client.on('audioData', async (audioChunk: Buffer) => {
    // Send raw PCM audio to Gemini Live API
    await liveSession.send({
      inputAudio: audioChunk // Raw PCM 16kHz, 16-bit
    });
  });

  // Handle responses from Gemini Live API
  liveSession.on('response', (response) => {
    if (response.outputAudio) {
      // Send raw PCM audio back to browser
      client.emit('audioResponse', {
        audio: response.outputAudio, // Raw PCM 24kHz, 16-bit
        format: 'pcm'
      });
    }
  });

  // Handle function calls (RAG retrieval)
  liveSession.on('function_call', async (call) => {
    if (call.name === 'search_project_documents') {
      const context = await this.voiceService.retrieveContext(
        session.tenantId,
        data.documentId || 'all',
        call.args.query
      );

      await liveSession.send({
        functionResponse: {
          name: call.name,
          response: { context }
        }
      });
    }
  });

  client.emit('sessionReady');
}
```

---

## 🔍 How RAG Works with Live API

### Flow Diagram

```
User speaks: "What's the status of RFI-128?"
    ↓
[Raw Audio → Gemini Live API]
    ↓
Gemini detects need for document search
    ↓
[Calls function: search_project_documents("RFI-128")]
    ↓
[Your retrieveContext() executes]
    ↓
[Vector search → Firestore chunks → Context text]
    ↓
[Context returned to Gemini]
    ↓
Gemini generates response with context
    ↓
[Raw Audio Response → Browser]
    ↓
User hears: "Based on your documents, RFI-128 shows..."
```

---

## ✅ Key Points

1. **Your existing RAG system works perfectly** - no changes needed to vector search or document storage

2. **Function calling is preferred** - more efficient and supports dynamic context retrieval

3. **System prompt injection still works** - good for initial context or focused queries

4. **Multi-turn conversations supported** - Gemini can call your RAG function multiple times as the conversation evolves

5. **Same document filtering** - your tenant/document filtering logic remains unchanged

---

## 🚀 Next Steps

1. **Implement function calling** - Register your `retrieveContext` as a Gemini Live tool
2. **Test RAG integration** - Verify document retrieval works with voice queries
3. **Optimize context size** - Ensure retrieved chunks fit within token limits
4. **Monitor performance** - Track latency of RAG calls during voice sessions

---

## 📚 References

- [Gemini Live API Function Calling](https://ai.google.dev/gemini-api/docs/live#function_calling)
- [Gemini Tools & Function Calling](https://ai.google.dev/gemini-api/docs/function-calling)
- Your existing RAG implementation: `apps/api/src/voice/voice.service.ts`

