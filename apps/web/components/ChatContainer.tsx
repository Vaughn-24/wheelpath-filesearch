import { Message } from '@wheelpath/schemas';
import { useState, useRef, useEffect, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';

import { useAuth } from '../lib/auth';
import { isDemoMode } from '../lib/firebase';

interface ChatContainerProps {
  documentId?: string;
  documentTitle?: string;
  signedUrl?: string;
  onNewChat?: () => void;
  onSaveChat?: (title: string, messageCount: number) => void;
}

interface Citation {
  index: number;
  pageNumber: number;
  text: string;
  documentId: string;
}

interface RateLimitInfo {
  remaining: number;
  limit: number;
}

type InputMode = 'text' | 'voice';
type VoiceState = 'idle' | 'connecting' | 'listening' | 'processing' | 'speaking' | 'error';

const CHAT_LIMITS = {
  MAX_QUERY_LENGTH: 2000,
  COOLDOWN_MS: 2000,
  REQUEST_TIMEOUT_MS: 30000, // 30 second timeout for API requests
  MIC_TIMEOUT_MS: 30000, // 30 second timeout for microphone listening
};

const DEMO_RESPONSES = [
  'Based on the Project Specifications document [1], the foundation requirements specify a minimum depth of 4 feet below grade with reinforced concrete footings. The structural engineer has approved a load-bearing capacity of 3,000 PSF [2].',
  'According to RFI-2024-0142 [1], the foundation review identified three areas requiring additional soil compaction testing. The geotechnical report recommends dynamic compaction in zones A, B, and C [2].',
  'The Structural Engineering Report indicates that the steel beam connections at grid lines 3 and 7 require special inspection per IBC Section 1705 [1]. Welding procedures must comply with AWS D1.1 specifications [2].',
];

/**
 * Normalize construction terminology that speech recognition commonly mishears.
 * Converts spoken abbreviations like "R5" to "RFI", "see oh" to "CO", etc.
 */
const normalizeConstructionTerms = (text: string): string => {
  const corrections: Record<string, string> = {
    // === DOCUMENT TYPES (most commonly misheard) ===
    // RFI - Request for Information
    'r5': 'RFI', 'r 5': 'RFI', 'r f i': 'RFI', 'r.f.i.': 'RFI', 'our fi': 'RFI',
    'are fi': 'RFI', 'rfr': 'RFI', 'our fy': 'RFI', 'rf i': 'RFI', 'rfi': 'RFI',
    
    // CO - Change Order
    'c.o.': 'CO', 'c o': 'CO', 'see oh': 'CO', 'seal': 'CO',
    
    // PCO - Potential/Proposed Change Order
    'p.c.o.': 'PCO', 'p c o': 'PCO',
    
    // ASI - Architect's Supplemental Instruction
    'a.s.i.': 'ASI', 'a s i': 'ASI', 'as i': 'ASI',
    
    // CCD - Construction Change Directive
    'c.c.d.': 'CCD', 'c c d': 'CCD',
    
    // SOW - Scope of Work
    's.o.w.': 'SOW', 's o w': 'SOW', 'so w': 'SOW',
    
    // NTP - Notice to Proceed
    'n.t.p.': 'NTP', 'n t p': 'NTP',
    
    // TCO - Temporary Certificate of Occupancy
    't.c.o.': 'TCO', 't c o': 'TCO',
    
    // GMP - Guaranteed Maximum Price
    'g.m.p.': 'GMP', 'g m p': 'GMP',
    
    // T&M - Time and Materials
    't and m': 'T&M', 't&m': 'T&M', 'time and material': 'T&M',
    
    // === DESIGN PHASES ===
    's.d.': 'SD', 's d': 'SD',
    'd.d.': 'DD', 'd d': 'DD',
    'c.d.': 'CD', 'c d': 'CD', 'cds': 'CDs',
    'c.a.': 'CA', 'c a': 'CA',
    't.i.': 'TI', 't i': 'TI', 'tee i': 'TI',
    
    // === ROLES/PEOPLE ===
    'g.c.': 'GC', 'g c': 'GC', 'gee see': 'GC',
    'p.m.': 'PM', 'p m': 'PM',
    'p.e.': 'PE', 'p e': 'PE',
    'supe': 'superintendent',
    
    // === MEP TRADES ===
    'm.e.p.': 'MEP', 'm e p': 'MEP',
    'h.v.a.c.': 'HVAC', 'h vac': 'HVAC', 'h back': 'HVAC', 'h vack': 'HVAC',
    'b.i.m.': 'BIM', 'b i m': 'BIM',
    'v.d.c.': 'VDC', 'v d c': 'VDC',
    
    // === SAFETY/COMPLIANCE ===
    'o.s.h.a.': 'OSHA', 'o sha': 'OSHA',
    'p.p.e.': 'PPE', 'p p e': 'PPE',
    'a.d.a.': 'ADA', 'a d a': 'ADA',
    'l.e.e.d.': 'LEED', 'l e e d': 'LEED',
    
    // === COMMON SITE TERMS ===
    'submit all': 'submittal', 'submit al': 'submittal',
    'transmit all': 'transmittal', 'transmit al': 'transmittal',
    'f f and e': 'FF&E', 'ff&e': 'FF&E', 'ffe': 'FF&E', 'ff and e': 'FF&E',
    'o and m': 'O&M', 'o&m': 'O&M',
    
    // === CARPENTRY TERMS ===
    'joy st': 'joist', 'joyce': 'joist',
    'heater': 'header',
    'rough in': 'rough-in', 'roughin': 'rough-in',
    'dry wall': 'drywall',
    'sheet rock': 'sheetrock',
    'ply wood': 'plywood',
    'o.s.b.': 'OSB',
    'l.v.l.': 'LVL',
    'glue lam': 'glulam',
  };

  let normalized = text;
  for (const [wrong, right] of Object.entries(corrections)) {
    const regex = new RegExp(`\\b${wrong}\\b`, 'gi');
    normalized = normalized.replace(regex, right);
  }
  return normalized;
};

export default function ChatContainer({
  documentId,
  documentTitle,
  signedUrl,
  onNewChat,
  onSaveChat,
}: ChatContainerProps) {
  // Shared state
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputMode, setInputMode] = useState<InputMode>('text');
  const [citations, setCitations] = useState<Citation[]>([]);
  const [rateLimit, setRateLimit] = useState<RateLimitInfo | null>(null);
  const [chatError, setChatError] = useState<string | null>(null);
  const [streaming, setStreaming] = useState(false);

  // Clear current conversation
  const handleClearChat = useCallback(() => {
    // Save current chat before clearing if it has messages
    if (messages.length > 0 && onSaveChat) {
      const firstUserMsg = messages.find((m) => m.role === 'user');
      const title = firstUserMsg?.content.slice(0, 40) || 'Conversation';
      onSaveChat(title, messages.length);
    }
    setMessages([]);
    setCitations([]);
    setChatError(null);
    setTranscript('');
    setVoiceResponse('');
    if (onNewChat) onNewChat();
  }, [messages, onNewChat, onSaveChat]);

  // Text mode state
  const inputRef = useRef<HTMLInputElement>(null);
  const [inputLength, setInputLength] = useState(0);
  const [lastMessageTime, setLastMessageTime] = useState(0);
  const [cooldownRemaining, setCooldownRemaining] = useState(0);

  // Voice mode state
  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const [transcript, setTranscript] = useState('');
  const [voiceResponse, setVoiceResponse] = useState('');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null);
  const synthRef = useRef<SpeechSynthesisUtterance | null>(null);
  const micTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const voiceSocketRef = useRef<Socket | null>(null);
  const audioQueueRef = useRef<Array<{ audio: string; format: string; index: number }>>([]);
  const isPlayingAudioRef = useRef(false);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);

  // PDF state
  const [page, setPage] = useState(1);
  const [showPdf, setShowPdf] = useState(false);
  const [activePdfUrl, setActivePdfUrl] = useState<string | undefined>(signedUrl);
  const [activeTitle, setActiveTitle] = useState<string | undefined>(documentTitle);

  const bottomRef = useRef<HTMLDivElement>(null);
  const { user, loading, isDemo } = useAuth();

  // Determine if we have an active conversation
  const hasConversation = messages.length > 0;

  // Effects
  useEffect(() => {
    if (signedUrl) setActivePdfUrl(signedUrl);
    if (documentTitle) setActiveTitle(documentTitle);
  }, [signedUrl, documentTitle]);

  useEffect(() => {
    if (messages.length > 0) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  useEffect(() => {
    if (cooldownRemaining > 0) {
      const timer = setTimeout(() => setCooldownRemaining((prev) => Math.max(0, prev - 100)), 100);
      return () => clearTimeout(timer);
    }
  }, [cooldownRemaining]);

  // Connect to voice WebSocket when in voice mode
  useEffect(() => {
    if (inputMode === 'voice' && user && !voiceSocketRef.current) {
      const connectVoiceSocket = async () => {
        try {
          // [Checkpoint 1] Voice WebSocket - User check
          console.log('[ChatContainer] Connecting voice WebSocket', {
            hasUser: !!user,
            userId: user?.uid || 'none',
            inputMode,
          });

          const token = await user.getIdToken();
          const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
          const socketUrl = `${apiUrl}/voice`;
          
          console.log('[ChatContainer] Voice WebSocket - Token retrieved', {
            apiUrl,
            socketUrl,
            hasToken: !!token,
            tokenLength: token?.length || 0,
          });

          const socket = io(socketUrl, {
            auth: { token },
            transports: ['websocket', 'polling'], // Allow fallback to polling if websocket fails
          });

          socket.on('connect', () => {
            console.log('[ChatContainer] Voice socket connected', {
              socketId: socket.id,
              connected: socket.connected,
            });
            setVoiceState('idle');
          });

          socket.on('connect_error', (err) => {
            console.error('[ChatContainer] Voice socket connection error:', err);
            setChatError('Failed to connect to voice service');
            setVoiceState('error');
          });

          socket.on('authenticated', (data) => {
            console.log('[ChatContainer] Voice socket authenticated', data);
            socket.emit('setDocument', { documentId: documentId || 'all' });
          });

          socket.on('voiceStart', (data) => {
            console.log('[ChatContainer] Voice query started', data);
            setVoiceState('processing');
            setVoiceResponse('');
            audioQueueRef.current = [];
            isPlayingAudioRef.current = false;
          });

          socket.on('voiceChunk', (data: { text: string }) => {
            setVoiceResponse((prev) => prev + data.text);
          });

          socket.on('voiceAudioChunk', (data: { audio: string; format: string; index: number }) => {
            audioQueueRef.current.push(data);
            if (!isPlayingAudioRef.current) {
              playNextAudioChunk();
            }
          });

          socket.on('voiceBrowserTTS', (data: { text: string; index: number; isFinal?: boolean }) => {
            speakResponse(data.text);
          });

          socket.on('voiceEnd', (data: { fullText: string; audioChunks?: number }) => {
            if (!data.audioChunks || data.audioChunks === 0) {
              speakResponse(data.fullText);
            } else {
              setVoiceState('speaking');
            }
          });

          socket.on('voiceError', (data: { message: string }) => {
            console.error('[ChatContainer] Voice error received', data);
            setChatError(data.message);
            setVoiceState('error');
          });

          socket.on('disconnect', (reason) => {
            console.warn('[ChatContainer] Voice socket disconnected', {
              reason,
              socketId: socket.id,
            });
            setVoiceState('error');
          });

          socket.on('error', (error) => {
            console.error('[ChatContainer] Voice socket error event', error);
          });

          voiceSocketRef.current = socket;
        } catch (err) {
          console.error('[ChatContainer] Failed to connect voice socket', {
            error: err,
            errorMessage: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined,
          });
          setVoiceState('error');
        }
      };

      connectVoiceSocket();
    }

    return () => {
      if (inputMode !== 'voice' && voiceSocketRef.current) {
        voiceSocketRef.current.disconnect();
        voiceSocketRef.current = null;
      }
    };
  }, [inputMode, user, documentId]);

  // Play audio chunks from queue
  const playNextAudioChunk = useCallback(() => {
    if (audioQueueRef.current.length === 0) {
      isPlayingAudioRef.current = false;
      setVoiceState('idle');
      return;
    }

    isPlayingAudioRef.current = true;
    setVoiceState('speaking');
    const chunk = audioQueueRef.current.shift()!;
    const audio = new Audio(`data:audio/${chunk.format};base64,${chunk.audio}`);
    currentAudioRef.current = audio;
    
    audio.onended = () => {
      currentAudioRef.current = null;
      playNextAudioChunk();
    };

    audio.onerror = () => {
      currentAudioRef.current = null;
      playNextAudioChunk();
    };

    audio.play().catch((err) => {
      console.error('Audio play failed:', err);
      currentAudioRef.current = null;
      playNextAudioChunk();
    });
  }, []);

  // Cleanup voice on mode switch
  useEffect(() => {
    if (inputMode === 'text') {
      stopListening();
      stopSpeaking();
      if (voiceSocketRef.current) {
        voiceSocketRef.current.disconnect();
        voiceSocketRef.current = null;
      }
    }
  }, [inputMode]);

  // Text input handlers
  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (value.length <= CHAT_LIMITS.MAX_QUERY_LENGTH) {
      setInputLength(value.length);
    } else {
      e.target.value = value.slice(0, CHAT_LIMITS.MAX_QUERY_LENGTH);
      setInputLength(CHAT_LIMITS.MAX_QUERY_LENGTH);
    }
  }, []);

  const handleCitationClick = async (citation: Citation) => {
    setPage(citation.pageNumber);
    setShowPdf(true);
    if (isDemo || isDemoMode) return;

    if (citation.documentId && citation.documentId !== documentId && user) {
      try {
        const token = await user.getIdToken();
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
        const res = await fetch(`${apiUrl}/documents/${citation.documentId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const doc = await res.json();
          setActivePdfUrl(doc.signedUrl);
          setActiveTitle(doc.title);
        }
      } catch (e) {
        console.error('Failed to load citation source', e);
      }
    }
  };

  // Shared message sending logic
  const processQuery = async (query: string, isVoice: boolean = false) => {
    // [Checkpoint 1] User authentication check
    console.log('[ChatContainer] processQuery called', {
      queryLength: query?.trim()?.length || 0,
      hasUser: !!user,
      userId: user?.uid || 'none',
      isVoice,
      isDemo: isDemo || isDemoMode,
    });

    if (!query.trim() || !user) {
      console.warn('[ChatContainer] processQuery early return:', {
        reason: !query.trim() ? 'empty_query' : 'no_user',
        hasUser: !!user,
      });
      return;
    }

    const now = Date.now();
    if (now - lastMessageTime < CHAT_LIMITS.COOLDOWN_MS) {
      setCooldownRemaining(CHAT_LIMITS.COOLDOWN_MS - (now - lastMessageTime));
      console.log('[ChatContainer] Cooldown active, skipping request');
      return;
    }

    setChatError(null);
    setLastMessageTime(now);

    const userMsg: Message = { role: 'user', content: query, createdAt: new Date().toISOString() };
    setMessages((prev) => [...prev, userMsg]);
    setStreaming(true);

    if (isVoice) {
      setVoiceState('processing');
      setVoiceResponse('');
    }

    // Demo mode
    if (isDemo || isDemoMode) {
      console.log('[ChatContainer] Running in demo mode - skipping API call');
      setCitations([
        { index: 1, pageNumber: 3, text: 'Section 4.2.1', documentId: 'demo-1' },
        { index: 2, pageNumber: 7, text: 'Appendix B', documentId: 'demo-2' },
      ]);

      const demoResponse = DEMO_RESPONSES[Math.floor(Math.random() * DEMO_RESPONSES.length)];
      let aiMsg: Message = { role: 'model', content: '', createdAt: new Date().toISOString() };
      setMessages((prev) => [...prev, aiMsg]);

      const words = demoResponse.split(' ');
      for (let i = 0; i < words.length; i++) {
        await new Promise((resolve) => setTimeout(resolve, 50 + Math.random() * 50));
        aiMsg = { ...aiMsg, content: words.slice(0, i + 1).join(' ') };
        setMessages((prev) => {
          const newHistory = [...prev];
          newHistory[newHistory.length - 1] = aiMsg;
          return newHistory;
        });
        if (isVoice) setVoiceResponse(aiMsg.content);
      }

      setStreaming(false);
      setRateLimit({ remaining: 47, limit: 50 });

      if (isVoice) {
        speakResponse(demoResponse);
      }
      return;
    }

    // Real API call with timeout protection
    try {
      // [Checkpoint 2] Token retrieval
      console.log('[ChatContainer] Retrieving auth token...');
      const token = await user.getIdToken();
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
      
      console.log('[ChatContainer] Token retrieved, constructing request', {
        apiUrl,
        hasToken: !!token,
        tokenLength: token?.length || 0,
        tokenPrefix: token?.substring(0, 20) || 'none',
        documentId: documentId || 'all',
        queryLength: query.length,
        historyLength: messages.slice(-20).length,
      });

      // AbortController for request timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), CHAT_LIMITS.REQUEST_TIMEOUT_MS);

      // [Checkpoint 3] Request construction
      const requestUrl = `${apiUrl}/chat/stream`;
      const requestBody = JSON.stringify({
          documentId: documentId || 'all',
          query,
          history: messages.slice(-20),
      });
      
      console.log('[ChatContainer] Sending request', {
        url: requestUrl,
        method: 'POST',
        bodyLength: requestBody.length,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token.substring(0, 20)}...`,
        },
      });

      const res = await fetch(requestUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: requestBody,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // [Checkpoint 4] Response received
      console.log('[ChatContainer] Response received', {
        status: res.status,
        statusText: res.statusText,
        ok: res.ok,
        headers: Object.fromEntries(res.headers.entries()),
      });

      if (res.status === 429) {
        const errorData = await res.json();
        console.warn('[ChatContainer] Rate limit hit', errorData);
        setChatError(errorData.message || 'Rate limit reached.');
        setMessages((prev) => prev.slice(0, -1));
        setStreaming(false);
        if (isVoice) setVoiceState('error');
        return;
      }

      if (!res.ok || !res.body) {
        console.error('[ChatContainer] Request failed', {
          status: res.status,
          statusText: res.statusText,
          hasBody: !!res.body,
        });
        throw new Error(`API error: ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let aiMsg: Message = { role: 'model', content: '', createdAt: new Date().toISOString() };
      setMessages((prev) => [...prev, aiMsg]);

      let fullResponse = '';
      let readerDone = false;
      let lastChunkTime = Date.now();
      const STREAM_TIMEOUT_MS = 15000; // 15 second stream timeout

      while (!readerDone) {
        // Check for stream timeout (no data received)
        if (Date.now() - lastChunkTime > STREAM_TIMEOUT_MS) {
          reader.cancel();
          throw new Error('Stream timeout - no response received');
        }

        const { done, value } = await reader.read();
        lastChunkTime = Date.now();
        if (done) {
          readerDone = true;
          break;
        }

        const chunk = decoder.decode(value);
        for (const line of chunk.split('\n\n')) {
          if (line.startsWith('data: ')) {
            const dataStr = line.replace('data: ', '');
            if (dataStr === '[DONE]') break;
            try {
              const {
                text,
                citations: newCitations,
                rateLimit: newRateLimit,
              } = JSON.parse(dataStr);
              if (newCitations) setCitations(newCitations);
              if (newRateLimit) setRateLimit(newRateLimit);
              if (text) {
                fullResponse += text;
                aiMsg = { ...aiMsg, content: fullResponse };
                setMessages((prev) => {
                  const newHistory = [...prev];
                  newHistory[newHistory.length - 1] = aiMsg;
                  return newHistory;
                });
                if (isVoice) setVoiceResponse(fullResponse);
              }
            } catch {
              /* ignore parse errors */
            }
          }
        }
      }

      if (isVoice && fullResponse) {
        speakResponse(fullResponse);
      }
    } catch (err: unknown) {
      // [Checkpoint 5] Error handling
      console.error('[ChatContainer] processQuery error', {
        error: err,
        errorName: err instanceof Error ? err.name : 'Unknown',
        errorMessage: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      
      let errorMessage = 'Failed to send message';
      if (err instanceof Error) {
        if (err.name === 'AbortError') {
          errorMessage = 'Request timed out. Please try again.';
        } else {
          errorMessage = err.message;
        }
      }
      setChatError(errorMessage);
      if (isVoice) setVoiceState('error');
    } finally {
      setStreaming(false);
      console.log('[ChatContainer] processQuery completed');
    }
  };

  // Text mode send
  const sendTextMessage = async () => {
    const inputValue = inputRef.current?.value || '';
    if (inputRef.current) {
      inputRef.current.value = '';
      setInputLength(0);
    }
    // Normalize construction terms for text input (fixes "r5" -> "RFI", etc.)
    const normalizedInput = normalizeConstructionTerms(inputValue);
    await processQuery(normalizedInput, false);
  };

  // Voice mode functions
  const startListening = useCallback(() => {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
      setChatError('Speech recognition not supported');
      setVoiceState('error');
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SpeechRecognitionAPI =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const recognition = new SpeechRecognitionAPI();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onstart = () => {
      setVoiceState('listening');
      setTranscript('');
      setVoiceResponse('');

      // Safety timeout: stop listening after max duration
      if (micTimeoutRef.current) clearTimeout(micTimeoutRef.current);
      micTimeoutRef.current = setTimeout(() => {
        if (recognitionRef.current) {
          recognitionRef.current.stop();
          setChatError('Listening timed out. Please try again.');
          setVoiceState('idle');
        }
      }, CHAT_LIMITS.MIC_TIMEOUT_MS);
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognition.onresult = (event: any) => {
      let finalTranscript = '';
      let interimTranscript = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const t = event.results[i][0].transcript;
        if (event.results[i].isFinal) finalTranscript += t;
        else interimTranscript += t;
      }
      
      // Normalize construction terms (fixes "R5" -> "RFI", etc.)
      const normalizedFinal = normalizeConstructionTerms(finalTranscript);
      const normalizedInterim = normalizeConstructionTerms(interimTranscript);
      
      setTranscript(normalizedFinal || normalizedInterim);
      if (normalizedFinal && voiceSocketRef.current) {
        // Use WebSocket for voice queries
        console.log('[ChatContainer] Emitting voiceQuery via WebSocket', {
          original: finalTranscript,
          normalized: normalizedFinal,
          socketConnected: voiceSocketRef.current.connected,
          socketId: voiceSocketRef.current.id,
        });
        setVoiceState('processing');
        voiceSocketRef.current.emit('voiceQuery', { text: normalizedFinal });
      } else if (normalizedFinal) {
        // Fallback to HTTP if WebSocket not available
        console.log('[ChatContainer] WebSocket not available, falling back to HTTP', {
          original: finalTranscript,
          normalized: normalizedFinal,
          hasSocket: !!voiceSocketRef.current,
        });
        processQuery(normalizedFinal, true);
      }
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognition.onerror = (event: any) => {
      if (event.error !== 'no-speech') {
        setChatError(`Speech error: ${event.error}`);
        setVoiceState('error');
      } else {
        setVoiceState('idle');
      }
    };

    recognition.onend = () => {
      if (micTimeoutRef.current) {
        clearTimeout(micTimeoutRef.current);
        micTimeoutRef.current = null;
      }
      if (voiceState === 'listening') setVoiceState('idle');
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch (err: unknown) {
      console.error('Failed to start recognition:', err);
      const errorMessage = err instanceof Error ? err.message : String(err);
      setChatError(`Failed to start: ${errorMessage}`);
      setVoiceState('error');
    }
  }, [voiceState]);

  const stopListening = useCallback(() => {
    if (micTimeoutRef.current) {
      clearTimeout(micTimeoutRef.current);
      micTimeoutRef.current = null;
    }
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
  }, []);

  const speakResponse = useCallback((text: string) => {
    if (!('speechSynthesis' in window)) {
      setVoiceState('idle');
      return;
    }
    setVoiceState('speaking');
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text.replace(/\[\d+\]/g, '')); // Remove citations
    utterance.rate = 1.0;
    utterance.onend = () => {
      setVoiceState('idle');
      synthRef.current = null;
    };
    utterance.onerror = () => {
      setVoiceState('idle');
      synthRef.current = null;
    };
    synthRef.current = utterance;
    window.speechSynthesis.speak(utterance);
  }, []);

  const stopSpeaking = useCallback(() => {
    // Stop browser TTS
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    synthRef.current = null;
    
    // Stop current Gemini TTS audio
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current = null;
    }
    
    // Clear audio queue
    audioQueueRef.current = [];
    isPlayingAudioRef.current = false;
    
    // Tell server to stop sending more audio
    if (voiceSocketRef.current?.connected) {
      voiceSocketRef.current.emit('voiceCancel');
    }
    
    if (voiceState === 'speaking') setVoiceState('idle');
  }, [voiceState]);

  const handleVoiceAction = () => {
    if (voiceState === 'listening') stopListening();
    else if (voiceState === 'speaking') {
      stopSpeaking();
      setVoiceState('idle');
    } else if (voiceState === 'idle' || voiceState === 'error') {
      startListening();
    }
  };

  // Render helpers
  const renderMessageContent = (content: string) => {
    const parts = content.split(/(\[\d+\])/g);
    return parts.map((part, i) => {
      if (part.match(/^\[\d+\]$/)) {
        const index = parseInt(part.replace('[', '').replace(']', ''));
        const citation = citations.find((c) => c.index === index);
        if (citation) {
          return (
            <button
              key={i}
              onClick={() => handleCitationClick(citation)}
              className="citation-btn mx-0.5"
              title={`Page ${citation.pageNumber}`}
            >
              {index}
            </button>
          );
        }
      }
      return part;
    });
  };

  const inputEnabled = !streaming && !loading && cooldownRemaining === 0 && inputMode === 'text';
  const getCharCountColor = () => {
    const ratio = inputLength / CHAT_LIMITS.MAX_QUERY_LENGTH;
    if (ratio > 0.9) return 'text-error';
    if (ratio > 0.7) return 'text-amber';
    return 'text-foreground-subtle';
  };

  // Light theme orb styles
  const getVoiceOrbLightClass = () => {
    switch (voiceState) {
      case 'listening':
        return 'voice-orb-light-listening';
      case 'processing':
        return 'voice-orb-light-processing';
      case 'speaking':
        return 'voice-orb-light-speaking';
      case 'error':
        return 'voice-orb-light-error';
      default:
        return 'voice-orb-light-idle';
    }
  };

  const getVoiceStatusText = (isDesktop: boolean = true) => {
    switch (voiceState) {
      case 'listening':
        return 'Listening...';
      case 'processing':
        return 'Thinking...';
      case 'speaking':
        return 'Speaking...';
      case 'error':
        return isDesktop ? 'Click to retry' : 'Press to retry';
      default:
        return isDesktop ? 'Click to Speak with WheelPath' : 'Press to Speak with WheelPath';
    }
  };

  // Shared input component (used in both centered and bottom positions)
  const renderTextInput = (centered: boolean = false) => (
    <div className={`relative w-full ${centered ? 'max-w-xl' : ''}`}>
      <input
        ref={inputRef}
        onChange={handleInputChange}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendTextMessage();
          }
        }}
        placeholder={centered ? 'Text with WheelPath' : 'Text with WheelPath'}
        className={`w-full bg-surface border-2 border-border text-body text-foreground
                   placeholder:text-foreground-subtle transition-all duration-base
                   focus:border-terracotta focus:outline-none focus:ring-0
                   ${centered ? 'rounded-sm py-lg px-xl pr-14' : 'rounded-sm py-md px-lg pr-14'}`}
        disabled={!inputEnabled}
        maxLength={CHAT_LIMITS.MAX_QUERY_LENGTH}
      />
      {inputLength > 0 && !centered && (
        <span
          className={`absolute right-14 top-1/2 transform -translate-y-1/2 text-micro ${getCharCountColor()}`}
        >
          {inputLength}/{CHAT_LIMITS.MAX_QUERY_LENGTH}
        </span>
      )}
      <button
        type="button"
        disabled={!inputEnabled}
        onClick={sendTextMessage}
        className={`absolute right-sm top-1/2 transform -translate-y-1/2 bg-foreground text-white 
                   hover:bg-[#3D3225] disabled:opacity-50 transition-all rounded-sm
                   ${centered ? 'p-md' : 'p-sm'}`}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
          <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
        </svg>
      </button>
    </div>
  );

  return (
    <div className="h-full flex bg-background">
      {/* PDF Viewer (toggleable) */}
      {showPdf && (
        <div className="hidden lg:flex w-1/2 h-full border-r border-border bg-surface flex-col">
          <div className="h-12 px-lg flex items-center justify-between border-b border-border shrink-0">
            <span className="text-body-sm font-medium text-foreground truncate">
              {activeTitle || 'Document'}
            </span>
            <button
              onClick={() => setShowPdf(false)}
              className="p-xs rounded hover:bg-terracotta-light text-foreground-muted hover:text-terracotta transition-all"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
              </svg>
            </button>
          </div>
          {activePdfUrl && !isDemo ? (
            <iframe
              src={`${activePdfUrl}#page=${page}`}
              className="flex-1 w-full"
              title="PDF Viewer"
            />
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-xl text-center">
              <div className="w-16 h-16 bg-terracotta-light rounded-md flex items-center justify-center mb-lg">
                <svg
                  width="32"
                  height="32"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  className="text-terracotta"
                >
                  <path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z" />
                </svg>
              </div>
              <p className="text-foreground-muted text-body-sm">PDF preview unavailable</p>
              {page > 1 && <p className="text-terracotta text-caption mt-sm">Page {page}</p>}
            </div>
          )}
        </div>
      )}

      {/* Main Chat/Voice Container */}
      <div className={`flex-1 h-full flex flex-col ${showPdf ? 'lg:w-1/2' : ''}`}>
        {/* MODE SWITCHER - Toggle with sliding indicator */}
        <div className="shrink-0 p-lg border-b border-border bg-background">
          <div className="flex items-center justify-between">
            {/* Left spacer for centering */}
            <div className="w-10" />

            {/* Mode Toggle */}
            <div className="relative inline-flex bg-background rounded-sm p-xs">
              {/* Sliding background indicator */}
              <div
                className={`absolute top-xs bottom-xs rounded-sm transition-all duration-300 ease-out ${
                  inputMode === 'text'
                    ? 'left-xs bg-foreground shadow-md'
                    : 'bg-terracotta shadow-md'
                }`}
                style={{
                  width: 'calc(50% - 4px)',
                  transform:
                    inputMode === 'voice' ? 'translateX(calc(100% + 4px))' : 'translateX(0)',
                }}
              />

              {/* Text button */}
              <button
                onClick={() => setInputMode('text')}
                className={`relative z-10 flex items-center gap-sm px-xl py-md rounded-sm font-medium text-body-sm transition-colors duration-300 ${
                  inputMode === 'text'
                    ? 'text-white'
                    : 'text-foreground-muted hover:text-foreground'
                }`}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M20 2H4c-1.1 0-1.99.9-1.99 2L2 22l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-2 12H6v-2h12v2zm0-3H6V9h12v2zm0-3H6V6h12v2z" />
                </svg>
                <span>Text</span>
              </button>

              {/* Voice button */}
              <button
                onClick={() => setInputMode('voice')}
                className={`relative z-10 flex items-center gap-sm px-xl py-md rounded-sm font-medium text-body-sm transition-colors duration-300 ${
                  inputMode === 'voice'
                    ? 'text-white'
                    : 'text-foreground-muted hover:text-foreground'
                }`}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
                  <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
                </svg>
                <span>Voice</span>
              </button>
            </div>

            {/* Clear/End Chat Button */}
            <button
              onClick={handleClearChat}
              disabled={messages.length === 0}
              className="p-sm rounded hover:bg-terracotta-light text-foreground-muted hover:text-terracotta transition-all disabled:opacity-30 disabled:cursor-not-allowed"
              title="Clear conversation"
            >
              {/* Trash icon */}
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" />
              </svg>
            </button>
          </div>
        </div>

        {/* CONTENT AREA - Switches based on mode with slide animation */}
        <div className="flex-1 overflow-hidden flex flex-col relative">
          {/* TEXT MODE */}
          <div
            className={`absolute inset-0 flex flex-col transition-all duration-300 ease-out ${
              inputMode === 'text'
                ? 'opacity-100 translate-x-0 z-10'
                : 'opacity-0 -translate-x-8 pointer-events-none z-0'
            }`}
          >
            {/* Empty state - centered input */}
            {!hasConversation && (
              <div className="flex-1 flex flex-col items-center justify-center p-xl bg-background relative overflow-hidden">
                {/* Warm terracotta vignette glow */}
                <div
                  className="absolute inset-0 pointer-events-none"
                  style={{
                    boxShadow:
                      'inset 0 0 120px 50px rgba(194, 112, 62, 0.08), inset 0 0 250px 100px rgba(212, 160, 48, 0.04)',
                  }}
                />

                {chatError && (
                  <div className="relative z-10 alert-error mb-lg max-w-xl w-full">{chatError}</div>
                )}

                <div className="relative z-10 w-32 h-32 md:w-40 md:h-40 bg-gradient-to-br from-terracotta-light to-amber-light rounded-full flex items-center justify-center mb-xl shadow-lg border-2 border-terracotta/20">
                  <svg
                    width="48"
                    height="48"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    className="text-terracotta"
                  >
                    <path d="M20 2H4c-1.1 0-1.99.9-1.99 2L2 22l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-2 12H6v-2h12v2zm0-3H6V9h12v2zm0-3H6V6h12v2z" />
                  </svg>
                </div>

                {/* Centered input - same elevation as voice orb */}
                <div className="relative z-10 w-full flex justify-center">
                  {renderTextInput(true)}
                </div>
              </div>
            )}

            {/* Active conversation - messages with bottom input */}
            {hasConversation && (
              <>
                {/* Messages */}
                <div className="flex-1 overflow-y-auto p-lg lg:p-xl bg-background">
                  {chatError && <div className="alert-error mb-lg">{chatError}</div>}
                  <div className="space-y-lg">
                    {messages.map((msg, i) => (
                      <div
                        key={i}
                        className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                      >
                        <div
                          className={`max-w-[80%] lg:max-w-[70%] ${msg.role === 'user' ? 'chat-bubble-user' : 'chat-bubble-ai'}`}
                        >
                          {msg.role === 'user' ? msg.content : renderMessageContent(msg.content)}
                        </div>
                      </div>
                    ))}
                    {streaming && (
                      <div className="flex items-center gap-sm text-foreground-muted text-body-sm">
                        <div className="flex gap-xs">
                          <div className="w-2 h-2 bg-terracotta rounded-full animate-pulse"></div>
                          <div
                            className="w-2 h-2 bg-terracotta rounded-full animate-pulse"
                            style={{ animationDelay: '150ms' }}
                          ></div>
                          <div
                            className="w-2 h-2 bg-terracotta rounded-full animate-pulse"
                            style={{ animationDelay: '300ms' }}
                          ></div>
                        </div>
                        <span>Thinking...</span>
                      </div>
                    )}
                  </div>
                  <div ref={bottomRef} />
                </div>

                {/* Bottom input - slides in with animation */}
                <div className="p-lg border-t border-border bg-background shrink-0 animate-slide-up">
                  {renderTextInput(false)}
                  {rateLimit && (
                    <div className="mt-sm flex items-center justify-end">
                      <span
                        className={`text-micro ${rateLimit.remaining < 10 ? 'text-amber' : 'text-foreground-subtle'}`}
                      >
                        {rateLimit.remaining}/{rateLimit.limit} queries remaining
                      </span>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>

          {/* VOICE MODE */}
          <div
            className={`absolute inset-0 flex flex-col transition-all duration-300 ease-out ${
              inputMode === 'voice'
                ? 'opacity-100 translate-x-0 z-10'
                : 'opacity-0 translate-x-8 pointer-events-none z-0'
            }`}
          >
            <div className="flex-1 flex flex-col items-center justify-center p-xl bg-background text-foreground relative overflow-hidden">
              {/* Dark glow vignette effect around edges */}
              <div
                className="absolute inset-0 pointer-events-none"
                style={{
                  boxShadow:
                    'inset 0 0 100px 40px rgba(44, 36, 25, 0.15), inset 0 0 200px 80px rgba(44, 36, 25, 0.08)',
                }}
              />

              {/* Conversation history (scrollable, above the orb) */}
              {messages.length > 0 && (
                <div className="relative z-10 w-full max-w-md mb-xl max-h-[30vh] overflow-y-auto">
                  <div className="space-y-md">
                    {messages.slice(-4).map((msg, i) => (
                      <div
                        key={i}
                        className={`text-body-sm ${msg.role === 'user' ? 'text-foreground-muted italic' : 'text-foreground'}`}
                      >
                        {msg.role === 'user'
                          ? `"${msg.content}"`
                          : renderMessageContent(msg.content)}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Voice Orb */}
              <button
                onClick={handleVoiceAction}
                disabled={voiceState === 'processing'}
                className={`relative z-10 voice-orb-light ${getVoiceOrbLightClass()} hover:scale-105 disabled:cursor-wait focus:ring-4 focus:ring-terracotta/30`}
              >
                <div className="w-full h-full rounded-full flex items-center justify-center">
                  {voiceState === 'listening' && (
                    <svg
                      width="48"
                      height="48"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                      className="text-white"
                    >
                      <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
                      <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
                    </svg>
                  )}
                  {voiceState === 'speaking' && (
                    <svg
                      width="48"
                      height="48"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                      className="text-white"
                    >
                      <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
                    </svg>
                  )}
                  {(voiceState === 'idle' ||
                    voiceState === 'error' ||
                    voiceState === 'processing' ||
                    voiceState === 'connecting') && (
                    <svg
                      width="48"
                      height="48"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                      className="text-terracotta"
                    >
                      <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
                      <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
                    </svg>
                  )}
                </div>
              </button>

              {/* Status - responsive text */}
              <p
                className={`relative z-10 mt-xl text-heading font-medium ${voiceState === 'error' ? 'text-error' : 'text-foreground'}`}
              >
                <span className="hidden lg:inline">{getVoiceStatusText(true)}</span>
                <span className="lg:hidden">{getVoiceStatusText(false)}</span>
              </p>

              {/* Live transcript */}
              {transcript && voiceState === 'listening' && (
                <p className="relative z-10 mt-lg text-foreground-muted italic text-body max-w-md text-center">
                  "{transcript}"
                </p>
              )}

              {/* Current response */}
              {voiceResponse && (voiceState === 'processing' || voiceState === 'speaking') && (
                <p className="relative z-10 mt-lg text-foreground text-body max-w-md text-center">
                  {voiceResponse}
                </p>
              )}

              {/* Stop button when speaking */}
              {voiceState === 'speaking' && (
                <button
                  onClick={() => {
                    stopSpeaking();
                    setVoiceState('idle');
                  }}
                  className="relative z-10 mt-xl px-xl py-md bg-foreground text-white rounded-sm font-medium hover:bg-[#3D3225] transition-all"
                >
                  Stop Speaking
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
