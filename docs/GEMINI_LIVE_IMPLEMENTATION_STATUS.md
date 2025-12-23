# Gemini Live API Implementation Status

## ✅ Completed Backend Implementation

### 1. VoiceLiveService (`apps/api/src/voice/voice-live.service.ts`)
- ✅ WebSocket connection to Gemini Live API
- ✅ Function calling setup for RAG (`search_project_documents`)
- ✅ Integration with existing `retrieveContext` method
- ✅ Raw PCM audio handling (16kHz input, 24kHz output)
- ✅ Session management

### 2. VoiceGateway Updates (`apps/api/src/voice/voice.gateway.ts`)
- ✅ Added Live API message handlers:
  - `startLiveSession` - Initialize Live API connection
  - `sendLiveAudio` - Forward PCM audio to Gemini
  - `stopLiveSession` - Cleanup session
- ✅ Message forwarding from Gemini Live API to client
- ✅ Function call event forwarding (for debugging)

### 3. Module Registration (`apps/api/src/voice/voice.module.ts`)
- ✅ VoiceLiveService registered as provider

### 4. Frontend Audio Utilities (`apps/web/lib/audio-utils.ts`)
- ✅ `audioBufferToPCM16` - Convert AudioBuffer to PCM 16-bit, 16kHz
- ✅ `pcm24ToAudioBuffer` - Convert PCM 24kHz to AudioBuffer for playback
- ✅ `base64ToPCM16` / `pcm16ToBase64` - Base64 conversion utilities
- ✅ `createAudioContext` / `getUserMedia` - Audio capture helpers

---

## 🚧 Frontend Integration (In Progress)

### VoiceOverlay Component Updates Needed

The `VoiceOverlay.tsx` component needs to be updated to support Live API mode:

1. **Add Live API Mode Toggle**
   - Option to use Live API vs legacy STT→LLM→TTS
   - Environment variable or feature flag

2. **Microphone Capture**
   - Use `getUserMedia()` from audio-utils
   - Capture audio chunks as PCM 16kHz
   - Send to backend via `sendLiveAudio` event

3. **Audio Playback**
   - Receive PCM 24kHz from backend via `liveAudio` event
   - Convert to AudioBuffer and play using Web Audio API

4. **Session Management**
   - Call `startLiveSession` on connect
   - Handle `liveSessionReady`, `liveError`, `liveDisconnected` events
   - Call `stopLiveSession` on disconnect

---

## 📋 Implementation Checklist

### Backend ✅
- [x] VoiceLiveService created
- [x] WebSocket connection to Gemini Live API
- [x] Function calling for RAG
- [x] VoiceGateway handlers added
- [x] Module registration

### Frontend 🚧
- [x] Audio utilities created
- [ ] VoiceOverlay Live API integration
- [ ] Microphone capture implementation
- [ ] PCM audio playback implementation
- [ ] Error handling and fallback

### Testing ⏳
- [ ] Test Live API WebSocket connection
- [ ] Test RAG function calling
- [ ] Test audio capture/playback
- [ ] Test with uploaded documents
- [ ] Compare latency vs legacy implementation

---

## 🔧 Next Steps

### 1. Complete Frontend Integration

Add Live API support to `VoiceOverlay.tsx`:

```typescript
// Add state for Live API mode
const [useLiveAPI, setUseLiveAPI] = useState(true); // Feature flag

// Add Live API handlers
useEffect(() => {
  if (!socketRef.current || !useLiveAPI) return;

  socketRef.current.on('liveSessionReady', () => {
    setState('listening');
    startMicrophoneCapture();
  });

  socketRef.current.on('liveAudio', (data: { audio: string; format: string }) => {
    playPCMAudio(data.audio);
  });

  socketRef.current.on('liveError', (data: { message: string }) => {
    setError(data.message);
    setState('error');
  });
}, [useLiveAPI]);

// Start Live API session
const startLiveSession = async () => {
  if (socketRef.current) {
    socketRef.current.emit('startLiveSession', { documentId });
  }
};

// Microphone capture
const startMicrophoneCapture = async () => {
  const stream = await getUserMedia();
  const audioContext = createAudioContext();
  if (!stream || !audioContext) return;

  const source = audioContext.createMediaStreamSource(stream);
  const processor = audioContext.createScriptProcessor(4096, 1, 1);

  processor.onaudioprocess = (e) => {
    const audioBuffer = e.inputBuffer;
    const pcm16 = await audioBufferToPCM16(audioBuffer);
    const base64 = pcm16ToBase64(pcm16);
    
    socketRef.current?.emit('sendLiveAudio', { audio: base64 });
  };

  source.connect(processor);
  processor.connect(audioContext.destination);
};

// PCM audio playback
const playPCMAudio = (base64Audio: string) => {
  const pcm24 = base64ToPCM16(base64Audio);
  const audioBuffer = pcm24ToAudioBuffer(pcm24);
  const audioContext = new AudioContext({ sampleRate: 24000 });
  const source = audioContext.createBufferSource();
  
  source.buffer = audioBuffer;
  source.connect(audioContext.destination);
  source.start();
};
```

### 2. Verify Gemini Live API WebSocket Protocol

The current implementation assumes a specific WebSocket message format. Verify against:
- [Gemini Live API Documentation](https://ai.google.dev/gemini-api/docs/live)
- [Live API WebSocket Reference](https://ai.google.dev/api/live)

May need to adjust message format in `voice-live.service.ts` based on actual API.

### 3. Add Feature Flag

Add environment variable to toggle Live API:
```bash
NEXT_PUBLIC_USE_LIVE_API=true
```

### 4. Testing Plan

1. **Unit Tests**
   - Test RAG function calling
   - Test PCM conversion utilities
   - Test session management

2. **Integration Tests**
   - Test full voice flow with Live API
   - Test document retrieval during voice session
   - Test error handling

3. **Performance Tests**
   - Measure latency vs legacy implementation
   - Test with various document sizes
   - Test concurrent sessions

---

## 🐛 Known Issues / Considerations

1. **WebSocket Protocol**: The Gemini Live API WebSocket message format may differ from the current implementation. Verify and adjust as needed.

2. **Audio Format**: Ensure PCM format matches Gemini Live API requirements exactly:
   - Input: 16-bit PCM, 16kHz, Little-endian
   - Output: 16-bit PCM, 24kHz, Little-endian

3. **Browser Compatibility**: Web Audio API support varies. May need polyfills or fallback to legacy mode.

4. **Error Handling**: Add robust error handling for:
   - WebSocket connection failures
   - Audio capture failures
   - RAG retrieval failures

5. **Cost Monitoring**: Track Live API usage separately from legacy TTS costs.

---

## 📚 References

- [Gemini Live API Docs](https://ai.google.dev/gemini-api/docs/live)
- [Web Audio API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API)
- [PCM Audio Format](https://en.wikipedia.org/wiki/Pulse-code_modulation)

