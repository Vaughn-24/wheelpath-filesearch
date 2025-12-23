# Voice Implementation Comparison: Current vs Gemini Live API

## 📊 Current Implementation Architecture

### Flow Diagram
```
Browser (VoiceOverlay.tsx)
  ↓ [Web Speech API - STT]
Transcribed Text
  ↓ [Socket.io WebSocket]
Backend (VoiceGateway)
  ↓ [VoiceService]
Gemini 3 Pro (text-only)
  ↓ [Text Streaming]
Google Cloud TTS API
  ↓ [MP3 Audio Chunks]
Browser (Audio Playback)
```

### Current Stack
- **STT**: Browser Web Speech API (`webkitSpeechRecognition`)
- **LLM**: Gemini 3 Pro (`gemini-3-pro-preview`) - text-only
- **TTS**: Google Cloud Text-to-Speech API (`en-US-Chirp3-HD-Zephyr`)
- **Transport**: Socket.io WebSocket (text + base64 audio)
- **Audio Format**: MP3 (TTS output)

### Key Characteristics
1. **Three-Step Pipeline**: STT → LLM → TTS (separate services)
2. **Text-Based**: All communication is text, audio only at endpoints
3. **Manual VAD**: Browser handles speech detection, but no barge-in
4. **Higher Latency**: Multiple round trips (STT → LLM → TTS)
5. **Cost**: Separate charges for TTS API calls
6. **Model**: Gemini 3 Pro (more expensive, slower)

---

## 🚀 Gemini Live API Architecture

### Flow Diagram
```
Browser (Voice Client)
  ↓ [Raw PCM Audio - 16kHz, 16-bit]
Gemini Live API (WebSocket)
  ↓ [Native Audio Processing]
Gemini 2.0 Flash (multimodal)
  ↓ [Raw PCM Audio - 24kHz, 16-bit]
Browser (Direct Audio Playback)
```

### New Stack
- **STT + LLM + TTS**: Gemini 2.0 Flash (`gemini-2.0-flash-exp`) - unified
- **Transport**: Native WebSocket (WSS) - raw audio
- **Audio Format**: Raw PCM (16-bit, Little-endian)
  - Input: 16kHz
  - Output: 24kHz
- **VAD**: Built-in Voice Activity Detection
- **Barge-in**: Native support for interrupting AI

### Key Characteristics
1. **Unified Pipeline**: Single API handles audio → audio
2. **Audio-Native**: Direct audio streaming, no text conversion
3. **Built-in VAD**: Automatic speech detection and turn-taking
4. **Lower Latency**: Single round trip, no TTS conversion delay
5. **Cost**: Single API call (potentially cheaper overall)
6. **Model**: Gemini 2.0 Flash (faster, optimized for live)

---

## 🔍 Detailed Differences

### 1. Audio Handling

| Aspect | Current | Gemini Live API |
|--------|---------|-----------------|
| **Input Format** | Browser STT → Text | Raw PCM 16kHz, 16-bit |
| **Output Format** | MP3 (TTS) → Base64 | Raw PCM 24kHz, 16-bit |
| **Processing** | Text-based | Audio-native |
| **Latency** | ~2-3 seconds (STT + LLM + TTS) | ~500ms-1s (direct audio) |

### 2. Model & API

| Aspect | Current | Gemini Live API |
|--------|---------|-----------------|
| **Model** | `gemini-3-pro-preview` | `gemini-2.0-flash-exp` |
| **API Type** | REST (text) | WebSocket (audio) |
| **SDK** | `@google/generative-ai` | `google-genai` (v1alpha) |
| **Voice Quality** | TTS voice (Chirp3) | Native expressive voices (Puck, etc.) |

### 3. Features

| Feature | Current | Gemini Live API |
|---------|---------|-----------------|
| **Barge-in** | ❌ Not supported | ✅ Native support |
| **VAD** | Browser-based (limited) | ✅ Built-in, advanced |
| **Emotional Range** | Fixed TTS voice | ✅ Affective dialog |
| **Function Calling** | ✅ Supported | ✅ Supported |
| **Streaming** | Text chunks → TTS | ✅ Direct audio streaming |

### 4. Cost Structure

| Component | Current | Gemini Live API |
|-----------|---------|-----------------|
| **STT** | Free (browser) | Included |
| **LLM** | Gemini 3 Pro pricing | Gemini 2.0 Flash pricing |
| **TTS** | $0.016 per 1K characters | Included |
| **Total** | LLM + TTS costs | Single API cost |

### 5. Code Complexity

| Aspect | Current | Gemini Live API |
|--------|---------|-----------------|
| **Frontend** | STT + Socket.io + Audio playback | WebSocket + Audio capture/playback |
| **Backend** | Socket.io + Gemini + TTS API | WebSocket proxy + Gemini Live |
| **Audio Processing** | Manual (browser STT, TTS conversion) | Native (PCM handling) |

---

## 🔧 What Needs to Change

### Backend Changes Required

1. **Replace VoiceService** (`apps/api/src/voice/voice.service.ts`)
   - ❌ Remove: Gemini 3 Pro text generation
   - ❌ Remove: Google Cloud TTS client
   - ✅ Add: Gemini Live API WebSocket connection
   - ✅ Add: Raw PCM audio handling (16kHz → 24kHz conversion)

2. **Replace VoiceGateway** (`apps/api/src/voice/voice.gateway.ts`)
   - ❌ Remove: Socket.io text-based messages (`voiceQuery`, `voiceChunk`)
   - ❌ Remove: TTS chunk generation
   - ✅ Add: WebSocket proxy to Gemini Live API
   - ✅ Add: Raw audio passthrough (browser ↔ Gemini)

3. **New Dependencies**
   ```bash
   npm install @google/generative-ai  # Update to latest with Live API support
   # OR
   npm install google-genai  # New SDK
   ```

### Frontend Changes Required

1. **Replace VoiceOverlay** (`apps/web/components/VoiceOverlay.tsx`)
   - ❌ Remove: Web Speech API (`webkitSpeechRecognition`)
   - ❌ Remove: Browser TTS (`speechSynthesis`)
   - ❌ Remove: MP3 audio playback
   - ✅ Add: Raw PCM audio capture (microphone → 16kHz, 16-bit)
   - ✅ Add: Raw PCM audio playback (24kHz → speakers)
   - ✅ Add: Direct WebSocket to Gemini Live API (or via backend proxy)

2. **Audio Processing**
   - Need: Web Audio API for PCM capture/playback
   - Need: Audio resampling (16kHz input, 24kHz output)
   - Need: Buffer management for streaming

### Infrastructure Changes

1. **WebSocket Endpoint**
   - Current: Socket.io namespace `/voice`
   - New: Native WebSocket or proxy to Gemini Live API

2. **CORS Configuration**
   - May need updates for direct Gemini Live API access
   - Or: Backend proxy to handle CORS

---

## 📝 Migration Path

### Option 1: Direct Browser → Gemini Live (Recommended for Simplicity)
```
Browser → Gemini Live API (WSS) → Direct connection
```
- **Pros**: Lowest latency, simplest architecture
- **Cons**: Requires API key in frontend (security consideration)
- **Best for**: Public-facing apps with API key restrictions

### Option 2: Backend Proxy (Recommended for Security)
```
Browser → Backend WebSocket → Gemini Live API (WSS)
```
- **Pros**: API key stays on backend, better security
- **Cons**: Slightly higher latency (one extra hop)
- **Best for**: Production apps with sensitive API keys

### Option 3: Hybrid (Current + New)
```
Keep current implementation as fallback
Add Gemini Live as primary path
```
- **Pros**: Gradual migration, fallback support
- **Cons**: More code to maintain
- **Best for**: Phased rollout

---

## 🎯 Key Benefits of Migration

1. **Lower Latency**: ~50-70% reduction (direct audio vs STT→LLM→TTS)
2. **Better UX**: Native barge-in, expressive voices, affective dialog
3. **Simpler Code**: Single API instead of 3 services
4. **Cost Efficiency**: Potentially lower (no separate TTS charges)
5. **Future-Proof**: Latest Gemini capabilities (2.0 Flash)

---

## ⚠️ Considerations

1. **Browser Support**: Raw PCM audio requires Web Audio API (modern browsers)
2. **Audio Quality**: Need proper microphone permissions and audio processing
3. **Network**: WebSocket connection stability (reconnection logic)
4. **RAG Integration**: Still need to pass context to Gemini Live API
5. **Cost Monitoring**: Different pricing model (need to track usage)

---

## 🚦 Next Steps

1. **Evaluate**: Test Gemini Live API with a simple POC
2. **Decide**: Choose migration path (direct vs proxy)
3. **Implement**: Start with backend proxy approach (safer)
4. **Test**: Compare latency and quality vs current implementation
5. **Migrate**: Gradual rollout or full replacement

---

## 📚 Resources

- [Gemini Live API Documentation](https://ai.google.dev/gemini-api/docs/live)
- [Google GenAI SDK](https://github.com/google/generative-ai-node)
- [Web Audio API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API)
- [PCM Audio Format](https://en.wikipedia.org/wiki/Pulse-code_modulation)

