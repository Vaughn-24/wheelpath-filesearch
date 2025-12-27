import { useState, useEffect, useRef, useCallback } from 'react';

import { useAuth } from '../lib/auth';
import {
  getUserMedia,
  createAudioContext,
  audioBufferToPCM16,
  pcm16ToBase64,
  base64ToPCM16,
  pcm24ToAudioBuffer,
} from '../lib/audio-utils';

type VoiceState =
  | 'idle'
  | 'connecting'
  | 'listening'
  | 'processing'
  | 'speaking'
  | 'error'
  | 'rateLimited';

interface AudioChunk {
  audio: string;
  index: number;
  text: string;
  isFinal?: boolean;
}

interface SessionLimits {
  maxQueriesPerMinute: number;
  queryCooldownMs: number;
  maxSessionMinutes: number;
  idleTimeoutMinutes: number;
}

interface VoiceOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  documentId?: string;
  documentTitle?: string;
}

const FRONTEND_LIMITS = {
  SILENCE_TIMEOUT_MS: 15000,
  MAX_LISTENING_DURATION_MS: 60000,
  IDLE_WARNING_MS: 240000,
  AUTO_CLOSE_IDLE_MS: 300000,
};

export default function VoiceOverlay({
  isOpen,
  onClose,
  documentId,
  documentTitle,
}: VoiceOverlayProps) {
  const { user } = useAuth();
  const [state, setState] = useState<VoiceState>('idle');
  const [transcript, setTranscript] = useState('');
  const [response, setResponse] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sessionLimits, setSessionLimits] = useState<SessionLimits | null>(null);
  const [showIdleWarning, setShowIdleWarning] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<
    'connected' | 'disconnected' | 'connecting'
  >('disconnected');
  const [rateLimitMessage, setRateLimitMessage] = useState<string | null>(null);
  const [useLiveAPI] = useState(
    process.env.NEXT_PUBLIC_USE_LIVE_API === 'true' || false
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const socketRef = useRef<ReturnType<typeof import('socket.io-client').io> | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null);
  const synthRef = useRef<SpeechSynthesisUtterance | null>(null);

  // Live API audio capture refs
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const isLiveSessionActiveRef = useRef(false);

  const audioQueueRef = useRef<AudioChunk[]>([]);
  const isPlayingRef = useRef(false);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);

  const silenceTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const listeningTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const idleWarningTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const autoCloseTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastActivityRef = useRef<number>(Date.now());

  const resetIdleTimers = useCallback(() => {
    lastActivityRef.current = Date.now();
    setShowIdleWarning(false);

    if (idleWarningTimeoutRef.current) {
      clearTimeout(idleWarningTimeoutRef.current);
    }
    if (autoCloseTimeoutRef.current) {
      clearTimeout(autoCloseTimeoutRef.current);
    }

    idleWarningTimeoutRef.current = setTimeout(() => {
      setShowIdleWarning(true);
    }, FRONTEND_LIMITS.IDLE_WARNING_MS);

    autoCloseTimeoutRef.current = setTimeout(() => {
      console.log('Auto-closing voice overlay due to inactivity');
      onClose();
    }, FRONTEND_LIMITS.AUTO_CLOSE_IDLE_MS);
  }, [onClose]);

  useEffect(() => {
    if (!isOpen || !user) return;

    const connectSocket = async () => {
      setState('connecting');
      setConnectionStatus('connecting');
      setError(null);

      try {
        const { io } = await import('socket.io-client');
        const token = await user.getIdToken();
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

        const socket = io(`${apiUrl}/voice`, {
          auth: { token },
          transports: ['websocket', 'polling'], // Allow fallback to polling if websocket fails
        });

        socket.on('connect', () => {
          console.log('Voice socket connected');
          setConnectionStatus('connected');
          resetIdleTimers();
        });

        socket.on('connect_error', (err) => {
          console.error('Voice socket connection error:', err);
          setError('Failed to connect to voice service');
          setState('error');
          setConnectionStatus('disconnected');
        });

        socket.on('authenticated', (data: { tenantId: string; limits?: SessionLimits }) => {
          setState('idle');
          if (data.limits) {
            setSessionLimits(data.limits);
          }
          socket.emit('setDocument', { documentId: documentId || 'all' });
        });

        socket.on('heartbeat', () => {
          socket.emit('heartbeatAck');
        });

        socket.on('sessionTimeout', (data: { reason: string; message: string }) => {
          setError(data.message);
          setState('error');
          setTimeout(() => onClose(), 3000);
        });

        socket.on('rateLimited', (data: { message: string }) => {
          setRateLimitMessage(data.message);
          setState('rateLimited');
          setTimeout(() => {
            setRateLimitMessage(null);
            setState('idle');
          }, 3000);
        });

        socket.on('voiceStart', () => {
          setState('processing');
          setResponse('');
          resetIdleTimers();
          audioQueueRef.current = [];
          isPlayingRef.current = false;
        });

        socket.on('voiceChunk', (data: { text: string; truncated?: boolean }) => {
          setResponse((prev) => prev + data.text);
          if (data.truncated) {
            setResponse((prev) => prev + '... [truncated]');
          }
        });

        socket.on('voiceAudioChunk', (data: AudioChunk) => {
          audioQueueRef.current.push(data);
          if (!isPlayingRef.current) {
            playNextAudioChunk();
          }
        });

        socket.on('voiceBrowserTTS', (data: { text: string; index: number; isFinal?: boolean }) => {
          speakWithBrowserTTS(data.text);
        });

        socket.on('voiceAudio', (data: { audio: string; format: string; fullText: string }) => {
          setState('speaking');
          playAudioFromBase64(data.audio, data.format);
        });

        socket.on(
          'voiceEnd',
          (data: { fullText: string; audioChunks?: number; truncated?: boolean }) => {
            resetIdleTimers();
            if (!data.audioChunks || data.audioChunks === 0) {
              setState('speaking');
              speakWithBrowserTTS(data.fullText);
            }
          },
        );

        socket.on('voiceError', (data: { message: string }) => {
          setError(data.message);
          setState('error');
        });

        socket.on('error', (data: { message: string }) => {
          setError(data.message);
          setState('error');
        });

        socket.on('disconnect', () => {
          console.log('Voice socket disconnected');
          setConnectionStatus('disconnected');
          if (isOpen) {
            setState('error');
            setError('Connection lost');
          }
        });

        // Live API event handlers
        socket.on('liveSessionReady', (data: { documentId: string }) => {
          console.log('[Live API] Session ready', data);
          setState('listening');
          if (useLiveAPI) {
            startMicrophoneCapture();
          }
        });

        socket.on('liveAudio', async (data: { audio: string; format: string; sampleRate?: number }) => {
          console.log('[Live API] Received audio chunk');
          setState('speaking');
          await playPCMAudio(data.audio, data.sampleRate || 24000);
        });

        socket.on('liveFunctionCall', (data: { name: string; args: any }) => {
          console.log('[Live API] Function call:', data.name, data.args);
          setState('processing');
        });

        socket.on('liveError', (data: { message: string }) => {
          console.error('[Live API] Error:', data.message);
          setError(data.message);
          setState('error');
          stopMicrophoneCapture();
        });

        socket.on('liveDisconnected', () => {
          console.log('[Live API] Disconnected');
          stopMicrophoneCapture();
          setState('idle');
        });

        socket.on('liveSessionStopped', () => {
          console.log('[Live API] Session stopped');
          stopMicrophoneCapture();
          setState('idle');
        });

        socketRef.current = socket;
      } catch (err: unknown) {
        console.error('Socket connection failed:', err);
        setError('Failed to connect');
        setState('error');
        setConnectionStatus('disconnected');
      }
    };

    connectSocket();

    return () => {
      if (socketRef.current) {
        if (useLiveAPI && isLiveSessionActiveRef.current) {
          socketRef.current.emit('stopLiveSession');
        }
        socketRef.current.disconnect();
        socketRef.current = null;
      }
      stopListening();
      stopMicrophoneCapture();
      stopSpeaking();
      if (silenceTimeoutRef.current) clearTimeout(silenceTimeoutRef.current);
      if (listeningTimeoutRef.current) clearTimeout(listeningTimeoutRef.current);
      if (idleWarningTimeoutRef.current) clearTimeout(idleWarningTimeoutRef.current);
      if (autoCloseTimeoutRef.current) clearTimeout(autoCloseTimeoutRef.current);
    };
  }, [isOpen, user, documentId, onClose, resetIdleTimers, useLiveAPI]);

  useEffect(() => {
    if (socketRef.current && documentId) {
      if (useLiveAPI && isLiveSessionActiveRef.current) {
        // Restart Live API session with new document
        socketRef.current.emit('stopLiveSession');
        setTimeout(() => {
          socketRef.current?.emit('startLiveSession', { documentId });
        }, 100);
      } else {
        socketRef.current.emit('setDocument', { documentId });
      }
    }
  }, [documentId, useLiveAPI]);

  // Start Live API session when authenticated
  useEffect(() => {
    if (
      useLiveAPI &&
      socketRef.current &&
      connectionStatus === 'connected' &&
      state === 'idle' &&
      !isLiveSessionActiveRef.current
    ) {
      console.log('[Live API] Starting session...');
      socketRef.current.emit('startLiveSession', { documentId: documentId || 'all' });
      isLiveSessionActiveRef.current = true;
    }
  }, [useLiveAPI, connectionStatus, state, documentId]);

  /**
   * Start microphone capture for Live API
   */
  const startMicrophoneCapture = useCallback(async () => {
    if (!useLiveAPI || !socketRef.current) return;

    try {
      const stream = await getUserMedia();
      if (!stream) {
        setError('Failed to access microphone');
        setState('error');
        return;
      }

      const audioContext = createAudioContext();
      if (!audioContext) {
        setError('Failed to create audio context');
        setState('error');
        return;
      }

      audioContextRef.current = audioContext;
      mediaStreamRef.current = stream;

      const source = audioContext.createMediaStreamSource(stream);
      // Use ScriptProcessorNode for audio processing (deprecated but widely supported)
      // For production, consider using AudioWorkletNode
      const processor = audioContext.createScriptProcessor(4096, 1, 1);

      processor.onaudioprocess = async (e) => {
        if (!isLiveSessionActiveRef.current || !socketRef.current) return;

        try {
          const audioBuffer = e.inputBuffer;
          const pcm16 = await audioBufferToPCM16(audioBuffer, 16000);
          const base64 = pcm16ToBase64(pcm16);

          socketRef.current.emit('sendLiveAudio', { audio: base64 });
        } catch (err) {
          console.error('[Live API] Error processing audio:', err);
        }
      };

      source.connect(processor);
      processor.connect(audioContext.destination);
      audioProcessorRef.current = processor;

      console.log('[Live API] Microphone capture started');
    } catch (err: any) {
      console.error('[Live API] Failed to start microphone:', err);
      setError('Failed to start microphone');
      setState('error');
    }
  }, [useLiveAPI]);

  /**
   * Stop microphone capture
   */
  const stopMicrophoneCapture = useCallback(() => {
    if (audioProcessorRef.current) {
      audioProcessorRef.current.disconnect();
      audioProcessorRef.current = null;
    }

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }

    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close().catch(console.error);
      audioContextRef.current = null;
    }

    isLiveSessionActiveRef.current = false;
    console.log('[Live API] Microphone capture stopped');
  }, []);

  /**
   * Play PCM audio from Live API
   */
  const playPCMAudio = useCallback(async (base64Audio: string, sampleRate: number = 24000) => {
    try {
      const pcm24 = base64ToPCM16(base64Audio);
      const audioBuffer = pcm24ToAudioBuffer(pcm24, sampleRate);
      const audioContext = new AudioContext({ sampleRate });

      const source = audioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioContext.destination);

      source.onended = () => {
        audioContext.close();
        if (state === 'speaking') {
          setState('idle');
        }
      };

      source.start(0);
    } catch (err) {
      console.error('[Live API] Failed to play PCM audio:', err);
      setState('idle');
    }
  }, [state]);

  const startListening = useCallback(() => {
    // If using Live API, microphone is already capturing
    if (useLiveAPI) {
      setState('listening');
      resetIdleTimers();
      return;
    }

    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
      setError('Speech recognition not supported in this browser');
      setState('error');
      return;
    }

    resetIdleTimers();

    /* eslint-disable @typescript-eslint/no-explicit-any */
    const SpeechRecognitionAPI =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    /* eslint-enable @typescript-eslint/no-explicit-any */
    const recognition = new SpeechRecognitionAPI();

    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onstart = () => {
      setState('listening');
      setTranscript('');
      setResponse('');

      silenceTimeoutRef.current = setTimeout(() => {
        console.log('Silence timeout - stopping listening');
        recognition.stop();
        setState('idle');
      }, FRONTEND_LIMITS.SILENCE_TIMEOUT_MS);

      listeningTimeoutRef.current = setTimeout(() => {
        console.log('Max listening duration reached');
        recognition.stop();
        setState('idle');
      }, FRONTEND_LIMITS.MAX_LISTENING_DURATION_MS);
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognition.onresult = (event: any) => {
      if (silenceTimeoutRef.current) {
        clearTimeout(silenceTimeoutRef.current);
        silenceTimeoutRef.current = setTimeout(() => {
          console.log('Silence timeout - stopping listening');
          recognition.stop();
        }, FRONTEND_LIMITS.SILENCE_TIMEOUT_MS);
      }

      let finalTranscript = '';
      let interimTranscript = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += transcript;
        } else {
          interimTranscript += transcript;
        }
      }

      setTranscript(finalTranscript || interimTranscript);

      if (finalTranscript && socketRef.current) {
        if (silenceTimeoutRef.current) clearTimeout(silenceTimeoutRef.current);
        if (listeningTimeoutRef.current) clearTimeout(listeningTimeoutRef.current);
        socketRef.current.emit('voiceQuery', { text: finalTranscript });
      }
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognition.onerror = (event: any) => {
      console.error('Speech recognition error:', event.error);
      if (silenceTimeoutRef.current) clearTimeout(silenceTimeoutRef.current);
      if (listeningTimeoutRef.current) clearTimeout(listeningTimeoutRef.current);

      if (event.error !== 'no-speech') {
        setError(`Speech error: ${event.error}`);
        setState('error');
      } else {
        setState('idle');
      }
    };

    recognition.onend = () => {
      if (silenceTimeoutRef.current) clearTimeout(silenceTimeoutRef.current);
      if (listeningTimeoutRef.current) clearTimeout(listeningTimeoutRef.current);

      if (state === 'listening') {
        setState('idle');
      }
    };

    recognitionRef.current = recognition;
    recognition.start();
  }, [state, resetIdleTimers, useLiveAPI]);

  const stopListening = useCallback(() => {
    if (silenceTimeoutRef.current) clearTimeout(silenceTimeoutRef.current);
    if (listeningTimeoutRef.current) clearTimeout(listeningTimeoutRef.current);

    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
  }, []);

  const playNextAudioChunk = useCallback(() => {
    if (audioQueueRef.current.length === 0) {
      isPlayingRef.current = false;
      if (state === 'speaking') {
        setState('idle');
      }
      return;
    }

    isPlayingRef.current = true;
    setState('speaking');

    const chunk = audioQueueRef.current.shift()!;

    try {
      const audioBlob = new Blob([Uint8Array.from(atob(chunk.audio), (c) => c.charCodeAt(0))], {
        type: 'audio/mp3',
      });
      const audioUrl = URL.createObjectURL(audioBlob);
      const audio = new Audio(audioUrl);

      audio.onended = () => {
        URL.revokeObjectURL(audioUrl);
        currentAudioRef.current = null;
        playNextAudioChunk();
      };

      audio.onerror = () => {
        console.error('Audio chunk playback failed');
        URL.revokeObjectURL(audioUrl);
        currentAudioRef.current = null;
        playNextAudioChunk();
      };

      currentAudioRef.current = audio;
      audio.play().catch((err) => {
        console.error('Audio play failed:', err);
        playNextAudioChunk();
      });
    } catch (err) {
      console.error('Failed to create audio:', err);
      playNextAudioChunk();
    }
  }, [state]);

  const playAudioFromBase64 = useCallback((base64Audio: string, format: string) => {
    try {
      if (currentAudioRef.current) {
        currentAudioRef.current.pause();
        currentAudioRef.current = null;
      }

      const audioBlob = new Blob([Uint8Array.from(atob(base64Audio), (c) => c.charCodeAt(0))], {
        type: `audio/${format}`,
      });
      const audioUrl = URL.createObjectURL(audioBlob);
      const audio = new Audio(audioUrl);

      audio.onended = () => {
        setState('idle');
        URL.revokeObjectURL(audioUrl);
        currentAudioRef.current = null;
      };

      audio.onerror = () => {
        console.error('Audio playback failed');
        setState('idle');
        URL.revokeObjectURL(audioUrl);
        currentAudioRef.current = null;
      };

      currentAudioRef.current = audio;
      audio.play();
    } catch (err) {
      console.error('Failed to play audio:', err);
      setState('idle');
    }
  }, []);

  const speakWithBrowserTTS = useCallback((text: string) => {
    if (!('speechSynthesis' in window)) {
      setState('idle');
      return;
    }

    setState('speaking');
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.0;
    utterance.pitch = 1.0;

    utterance.onend = () => {
      setState('idle');
      synthRef.current = null;
    };

    utterance.onerror = () => {
      setState('idle');
      synthRef.current = null;
    };

    synthRef.current = utterance;
    window.speechSynthesis.speak(utterance);
  }, []);

  const stopSpeaking = useCallback(() => {
    audioQueueRef.current = [];
    isPlayingRef.current = false;

    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current = null;
    }
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    synthRef.current = null;
  }, []);

  const handleMainAction = () => {
    resetIdleTimers();

    if (useLiveAPI) {
      // Live API mode: toggle listening/speaking
      if (state === 'listening') {
        stopMicrophoneCapture();
        setState('idle');
      } else if (state === 'speaking') {
        stopSpeaking();
        setState('idle');
      } else if (state === 'idle') {
        startMicrophoneCapture();
        setState('listening');
      } else if (state === 'error' || state === 'rateLimited') {
        setState('idle');
        setError(null);
        setRateLimitMessage(null);
      }
    } else {
      // Legacy mode
      if (state === 'listening') {
        stopListening();
      } else if (state === 'speaking') {
        stopSpeaking();
        setState('idle');
      } else if (state === 'idle') {
        startListening();
      } else if (state === 'error' || state === 'rateLimited') {
        setState('idle');
        setError(null);
        setRateLimitMessage(null);
      }
    }
  };

  const handleClose = () => {
    stopListening();
    stopMicrophoneCapture();
    stopSpeaking();
    if (socketRef.current) {
      if (useLiveAPI && isLiveSessionActiveRef.current) {
        socketRef.current.emit('stopLiveSession');
      } else {
        socketRef.current.emit('voiceCancel');
      }
    }
    onClose();
  };

  if (!isOpen) return null;

  const getOrbClass = () => {
    switch (state) {
      case 'connecting':
        return 'voice-orb-idle animate-pulse';
      case 'listening':
        return 'voice-orb-listening';
      case 'processing':
        return 'voice-orb-processing';
      case 'speaking':
        return 'voice-orb-speaking';
      case 'error':
        return 'voice-orb-error';
      case 'rateLimited':
        return 'bg-amber';
      default:
        return 'voice-orb-idle';
    }
  };

  const getStatusText = () => {
    switch (state) {
      case 'connecting':
        return 'Connecting...';
      case 'listening':
        return 'Listening...';
      case 'processing':
        return 'Thinking...';
      case 'speaking':
        return 'Speaking...';
      case 'error':
        return error || 'Error occurred';
      case 'rateLimited':
        return rateLimitMessage || 'Please wait...';
      default:
        return 'Tap to speak';
    }
  };

  return (
    <div className="voice-overlay animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between p-xl">
        <div>
          <div className="flex items-center gap-sm">
            <h2 className="text-heading font-medium text-voice-text">Voice Mode</h2>
            {useLiveAPI && (
              <span className="px-sm py-xs bg-terracotta/20 text-terracotta text-caption rounded">
                Live API
              </span>
            )}
          </div>
          <p className="text-body-sm text-voice-muted truncate max-w-[200px]">
            {documentTitle || 'All Documents'}
          </p>
        </div>
        <div className="flex items-center gap-md">
          {/* Connection Status */}
          <div className="flex items-center gap-sm">
            <div
              className={`w-2 h-2 rounded-full ${
                connectionStatus === 'connected'
                  ? 'bg-success'
                  : connectionStatus === 'connecting'
                    ? 'bg-amber animate-pulse'
                    : 'bg-error'
              }`}
            />
            <span className="text-caption text-voice-muted hidden sm:inline">
              {connectionStatus === 'connected'
                ? 'Connected'
                : connectionStatus === 'connecting'
                  ? 'Connecting'
                  : 'Disconnected'}
            </span>
          </div>
          <button
            onClick={handleClose}
            className="p-md bg-voice-surface rounded-md text-voice-text hover:bg-voice-muted/20 transition-all duration-base
                       focus:ring-2 focus:ring-terracotta focus:ring-offset-2 focus:ring-offset-voice-bg"
            aria-label="Close voice mode"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
            </svg>
          </button>
        </div>
      </div>

      {/* Idle Warning Banner */}
      {showIdleWarning && (
        <div className="mx-xl mb-lg p-md bg-amber/20 border border-amber/30 rounded-md text-center">
          <p className="text-amber text-body-sm">
            Session will close soon due to inactivity.{' '}
            <button
              onClick={resetIdleTimers}
              className="underline font-medium hover:text-amber-light"
            >
              Stay connected
            </button>
          </p>
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 flex flex-col items-center justify-center px-xl">
        {/* Orb */}
        <button
          onClick={handleMainAction}
          disabled={state === 'connecting' || state === 'processing'}
          className={`voice-orb ${getOrbClass()} hover:scale-105 disabled:cursor-wait
                      focus:ring-4 focus:ring-terracotta/50 focus:ring-offset-4 focus:ring-offset-voice-bg`}
          aria-label={state === 'listening' ? 'Stop listening' : 'Start listening'}
        >
          <div className="w-full h-full rounded-full bg-white/10 flex items-center justify-center">
            {state === 'listening' && (
              <svg width="48" height="48" viewBox="0 0 24 24" fill="white">
                <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
                <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
              </svg>
            )}
            {state === 'speaking' && (
              <svg width="48" height="48" viewBox="0 0 24 24" fill="white">
                <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
              </svg>
            )}
            {state === 'rateLimited' && (
              <svg width="48" height="48" viewBox="0 0 24 24" fill="white">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" />
              </svg>
            )}
            {(state === 'idle' ||
              state === 'error' ||
              state === 'connecting' ||
              state === 'processing') && (
              <svg width="48" height="48" viewBox="0 0 24 24" fill="white">
                <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
                <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
              </svg>
            )}
          </div>
        </button>

        {/* Status Text */}
        <p
          className={`mt-2xl text-heading font-medium ${
            state === 'error'
              ? 'text-error'
              : state === 'rateLimited'
                ? 'text-amber'
                : 'text-voice-text'
          }`}
        >
          {getStatusText()}
        </p>

        {/* Session Limits */}
        {sessionLimits && state === 'idle' && (
          <p className="mt-sm text-caption text-voice-muted">
            {sessionLimits.maxQueriesPerMinute} queries/min • {sessionLimits.maxSessionMinutes} min
            max
          </p>
        )}

        {/* Transcript/Response */}
        <div className="mt-xl w-full max-w-md text-center min-h-[80px]">
          {transcript && state === 'listening' && (
            <p className="text-voice-muted italic text-body">&ldquo;{transcript}&rdquo;</p>
          )}
          {response && (state === 'processing' || state === 'speaking') && (
            <p className="text-voice-text text-body">{response}</p>
          )}
        </div>
      </div>

      {/* Footer Controls */}
      <div className="p-xl flex justify-center gap-lg">
        {state === 'speaking' && (
          <button
            onClick={() => {
              stopSpeaking();
              setState('idle');
            }}
            className="btn-secondary border-voice-muted text-voice-text hover:border-terracotta hover:bg-voice-surface"
          >
            Stop Speaking
          </button>
        )}
        {state === 'listening' && (
          <button
            onClick={stopListening}
            className="px-xl py-md bg-error/20 text-error rounded-md font-medium hover:bg-error/30 transition-all duration-base"
          >
            Cancel
          </button>
        )}
      </div>

      {/* Browser Support Warning */}
      {typeof window !== 'undefined' &&
        !('webkitSpeechRecognition' in window) &&
        !('SpeechRecognition' in window) && (
          <div className="absolute bottom-24 left-xl right-xl">
            <div className="bg-amber/20 border border-amber/30 rounded-md p-lg text-center">
              <p className="text-amber text-body-sm">
                Voice recognition requires Chrome, Edge, or Safari.
              </p>
            </div>
          </div>
        )}
    </div>
  );
}
