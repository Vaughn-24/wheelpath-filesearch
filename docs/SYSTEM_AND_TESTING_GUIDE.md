# WheelPath System Architecture & User Testing Guide

> **Version:** 1.0  
> **Last Updated:** December 2024  
> **Tagline:** "Get Clarity. Go Build."

---

## 📐 System Architecture Overview

### High-Level Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                        USER JOURNEY                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   1. UPLOAD          2. ASK (TEXT)         3. ASK (VOICE)       │
│   ┌─────────┐        ┌─────────┐           ┌─────────┐          │
│   │   PDF   │        │  Query  │           │  Speak  │          │
│   └────┬────┘        └────┬────┘           └────┬────┘          │
│        │                  │                     │                │
│        ▼                  ▼                     ▼                │
│   ┌─────────┐        ┌─────────┐           ┌─────────┐          │
│   │   GCS   │        │   RAG   │           │   STT   │          │
│   │ Storage │        │ Service │           │ Browser │          │
│   └────┬────┘        └────┬────┘           └────┬────┘          │
│        │                  │                     │                │
│        ▼                  │                     ▼                │
│   ┌─────────┐             │              ┌─────────┐            │
│   │ Gemini  │             │              │  Voice  │            │
│   │File API │◄────────────┴──────────────│ Service │            │
│   └────┬────┘                            └────┬────┘            │
│        │                                      │                  │
│        ▼                                      ▼                  │
│   ┌─────────┐                            ┌─────────┐            │
│   │Firestore│                            │ Gemini  │            │
│   │Metadata │                            │   TTS   │            │
│   └─────────┘                            └─────────┘            │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Component Breakdown

| Component | Purpose | Technology |
|-----------|---------|------------|
| **Web App** | User interface | Next.js on Cloudflare Pages |
| **API** | Backend logic | NestJS on Cloud Run |
| **Storage** | Document files | Google Cloud Storage |
| **Database** | Document metadata | Firestore |
| **AI/LLM** | Answers & TTS | Gemini 2.0 Flash |
| **Auth** | User identity | Firebase Auth |

---

## 🧪 User Testing Framework

### Testing Philosophy

Based on best practices from OpenAI, Anthropic, and Google's AI UX research:

1. **Test the journey, not just features** - Users don't test "upload"; they test "Can I get answers about my RFI?"
2. **Fail gracefully** - Every error should guide the user forward
3. **Speed = Trust** - Latency over 3 seconds erodes confidence
4. **Accuracy > Speed** - Wrong fast answers destroy trust faster than slow right ones

---

## 📋 Testing Regimen

### Test Environment Setup

```bash
# Start local API
cd apps/api && npm run start:dev

# Start local web
cd apps/web && npm run dev

# Open browser to http://localhost:3000
```

---

## 🔵 TEST AREA 1: Document Upload

### User Story
> "As a GC, I want to upload my RFIs so the AI can answer questions about my project."

### Test Cases

| ID | Test Case | Steps | Expected Result | Pass/Fail |
|----|-----------|-------|-----------------|-----------|
| U1 | Happy path upload | 1. Click "Add Source" 2. Select PDF 3. Wait for processing | Green success, doc appears in Sources | |
| U2 | Large file (>10MB) | Upload a 15MB PDF | Should process (up to 25MB limit) | |
| U3 | Invalid file type | Upload a .docx file | Clear error: "Only PDF files supported" | |
| U4 | Network interruption | Upload, then disable WiFi mid-upload | Graceful error, retry option | |
| U5 | Duplicate upload | Upload same file twice | Should handle gracefully | |
| U6 | Processing failure | Upload corrupted PDF | Error state with "Retry" option | |

### Quality Metrics

| Metric | Target | How to Measure |
|--------|--------|----------------|
| Upload success rate | >95% | Successful uploads / attempts |
| Time to "Ready" | <30 sec | From click to green "Ready" status |
| Error clarity | 100% actionable | All errors tell user what to do next |

### Edge Cases to Test

- [ ] PDF with scanned images (OCR needed)
- [ ] PDF with complex tables
- [ ] PDF with handwritten annotations
- [ ] Very long PDF (100+ pages)
- [ ] Password-protected PDF
- [ ] PDF with non-English text

---

## 💬 TEST AREA 2: Text Chat

### User Story
> "As a superintendent, I want to ask questions about my documents and get accurate, cited answers."

### Test Cases

| ID | Test Case | Steps | Expected Result | Pass/Fail |
|----|-----------|-------|-----------------|-----------|
| T1 | Basic question | "What is RFI 87 about?" | Answer with specific doc content | |
| T2 | Cross-document | "Compare RFI 87 and RFI 128" | References both documents | |
| T3 | No docs uploaded | Ask question with empty Sources | Polite prompt to upload docs | |
| T4 | Out of scope | "What's the weather today?" | Graceful deflection to construction topics | |
| T5 | Follow-up question | Ask "Tell me more" after T1 | Contextual continuation | |
| T6 | Long query | Paste 1500+ character question | Handles or clear limit message | |
| T7 | Rate limit | Send 60+ queries in 1 hour | Clear rate limit message | |
| T8 | Construction jargon | "What's the CO status?" | Understands CO = Change Order | |

### Quality Metrics

| Metric | Target | How to Measure |
|--------|--------|----------------|
| Answer accuracy | >90% | Manual review of 20 test queries |
| Response time (first token) | <2 sec | Time from send to first text |
| Citation accuracy | 100% | Every [1] reference is correct |
| Hallucination rate | <5% | Made-up information not in docs |

### Prompt Testing Matrix

Test these query patterns with your uploaded documents:

| Pattern | Example Query |
|---------|---------------|
| **What is** | "What is RFI 87?" |
| **Where** | "Where is the lighting issue mentioned?" |
| **When** | "When is the response due?" |
| **Who** | "Who submitted this RFI?" |
| **Why** | "Why is this a problem?" |
| **How** | "How should we resolve this?" |
| **Compare** | "Compare RFI 87 and RFI 128" |
| **Summarize** | "Summarize all open RFIs" |
| **List** | "List all affected areas" |
| **Impact** | "What's the schedule impact?" |

---

## 🎤 TEST AREA 3: Voice Chat

### User Story
> "As a field worker with dirty hands, I want to ask questions by voice and hear the answer spoken back."

### Test Cases

| ID | Test Case | Steps | Expected Result | Pass/Fail |
|----|-----------|-------|-----------------|-----------|
| V1 | Basic voice query | Click mic, say "What is RFI 87?" | Correct spoken answer | |
| V2 | Construction jargon | Say "R-F-I eighty-seven" | Recognizes as RFI 87 | |
| V3 | Noisy environment | Test with background noise | Still recognizes query | |
| V4 | Stop speaking | Click stop mid-response | Audio stops immediately | |
| V5 | Quick follow-up | Ask second question after answer | Handles without overlap | |
| V6 | Long response | Ask complex question | Response doesn't cut off | |
| V7 | Connection loss | Disable WiFi mid-query | Graceful error, not stuck | |
| V8 | Mic permission denied | Block mic in browser | Clear permission request | |

### Quality Metrics

| Metric | Target | How to Measure |
|--------|--------|----------------|
| Speech recognition accuracy | >90% | Correct transcript / attempts |
| Voice response time | <4 sec | From speech end to audio start |
| Audio quality | Clear, natural | Subjective 1-5 rating |
| Term recognition | 100% | RFI, CO, HVAC recognized correctly |

### Voice-Specific Edge Cases

- [ ] Accented English (Southern, NYC, Hispanic, etc.)
- [ ] Fast speech
- [ ] Slow, deliberate speech
- [ ] Mumbling
- [ ] Background construction noise
- [ ] Echo-y room

---

## 🔄 Testing Workflow

### Daily Testing Ritual (10 min)

```
1. [ ] Upload one new document
2. [ ] Ask 3 text questions about it
3. [ ] Ask 1 voice question
4. [ ] Try one edge case from the lists above
5. [ ] Log any issues in GitHub Issues
```

### Weekly Deep Dive (30 min)

```
1. [ ] Run through ALL test cases for one area
2. [ ] Test on mobile device
3. [ ] Test on slow network (Chrome DevTools → Network → Slow 3G)
4. [ ] Review error messages for clarity
5. [ ] Check rate limiting is working
```

### Pre-Release Checklist

```
[ ] All U1-U6 upload tests pass
[ ] All T1-T8 text tests pass
[ ] All V1-V8 voice tests pass
[ ] Tested on Chrome, Safari, Firefox
[ ] Tested on mobile (iOS Safari, Android Chrome)
[ ] Tested with real construction documents
[ ] Tested with 3 different user accounts
[ ] Error handling verified for all failure modes
[ ] Rate limiting verified
[ ] Performance: <3 sec response times
```

---

## 📊 Issue Tracking Template

When you find a bug, log it with this format:

```markdown
## Bug: [Short description]

**Area:** Upload / Text / Voice
**Severity:** Critical / High / Medium / Low
**Steps to Reproduce:**
1. 
2. 
3. 

**Expected:** 
**Actual:** 
**Screenshot/Video:** [attach]
**Browser/Device:** 
**User Account:** 
```

---

## 🎯 Success Criteria

### MVP Launch Readiness

| Criteria | Target | Status |
|----------|--------|--------|
| Upload success rate | >95% | ⬜ |
| Text accuracy | >90% | ⬜ |
| Voice recognition | >85% | ⬜ |
| Response time | <3 sec | ⬜ |
| Error handling | 100% graceful | ⬜ |
| Mobile compatibility | iOS + Android | ⬜ |

---

## 📚 References

- [Google Conversational Design Guidelines](https://developers.google.com/assistant/conversation-design)
- [Nielsen Norman: Voice UI Best Practices](https://www.nngroup.com/articles/voice-first/)
- [Anthropic: Building Reliable AI Systems](https://www.anthropic.com/research)
- [OpenAI: GPT Best Practices](https://platform.openai.com/docs/guides/gpt-best-practices)

---

*Get Clarity. Go Build.* 🏗️

