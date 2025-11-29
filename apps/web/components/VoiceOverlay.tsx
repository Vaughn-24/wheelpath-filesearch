import { useState, useEffect, useRef, useCallback } from 'react';

import { useAuth } from '../lib/auth';

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

/**
 * VoiceOverlay - Full-screen voice interface with COST PROTECTIONS
 *
 * COST PROTECTION FEATURES:
 * - Auto-close on idle timeout (server-side enforced)
 * - Rate limiting display and handling
 * - Session timeout warnings
 * - Silence detection timeout (15 seconds)
 * - Connection status indicator
 * - Browser TTS fallback for cost savings
 *
 * Flow:
 * 1. User opens overlay -> WebSocket connects
 * 2. User speaks -> Browser Speech Recognition -> Text
 * 3. Text sent to server via WebSocket (rate limited)
 * 4. Server streams audio chunks as sentences complete
 * 5. Client plays audio chunks progressively
 */

// Frontend cost protection settings
const FRONTEND_LIMITS = {
  SILENCE_TIMEOUT_MS: 15000, // 15 seconds of silence before stopping
  MAX_LISTENING_DURATION_MS: 60000, // 60 seconds max continuous listening
  IDLE_WARNING_MS: 240000, // Show warning after 4 minutes idle
  AUTO_CLOSE_IDLE_MS: 300000, // Auto-close after 5 minutes idle
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const socketRef = useRef<ReturnType<typeof import('socket.io-client').io> | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null);
  const synthRef = useRef<SpeechSynthesisUtterance | null>(null);

  // Audio queue for streaming playback
  const audioQueueRef = useRef<AudioChunk[]>([]);
  const isPlayingRef = useRef(false);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);

  // Timeout refs for cost protection
  const silenceTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const listeningTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const idleWarningTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const autoCloseTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastActivityRef = useRef<number>(Date.now());

  // Reset idle timers on activity
  const resetIdleTimers = useCallback(() => {
    lastActivityRef.current = Date.now();
    setShowIdleWarning(false);

    if (idleWarningTimeoutRef.current) {
      clearTimeout(idleWarningTimeoutRef.current);
    }
    if (autoCloseTimeoutRef.current) {
      clearTimeout(autoCloseTimeoutRef.current);
    }

    // Set idle warning
    idleWarningTimeoutRef.current = setTimeout(() => {
      setShowIdleWarning(true);
    }, FRONTEND_LIMITS.IDLE_WARNING_MS);

    // Set auto-close
    autoCloseTimeoutRef.current = setTimeout(() => {
      console.log('Auto-closing voice overlay due to inactivity');
      onClose();
    }, FRONTEND_LIMITS.AUTO_CLOSE_IDLE_MS);
  }, [onClose]);

  // Connect to WebSocket when overlay opens
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
          transports: ['websocket'],
        });

        socket.on('connect', () => {
          console.log('Voice socket connected');
          setConnectionStatus('connected');
          resetIdleTimers();
        });

        socket.on('authenticated', (data: { tenantId: string; limits?: SessionLimits }) => {
          setState('idle');
          if (data.limits) {
            setSessionLimits(data.limits);
          }
          socket.emit('setDocument', { documentId: documentId || 'all' });
        });

        // Heartbeat handling
        socket.on('heartbeat', () => {
          socket.emit('heartbeatAck');
        });

        // Session timeout from server
        socket.on('sessionTimeout', (data: { reason: string; message: string }) => {
          setError(data.message);
          setState('error');
          setTimeout(() => onClose(), 3000);
        });

        // Rate limiting
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
            setResponse((prev) => prev + '... [truncated for cost control]');
          }
        });

        socket.on('voiceAudioChunk', (data: AudioChunk) => {
          audioQueueRef.current.push(data);
          if (!isPlayingRef.current) {
            playNextAudioChunk();
          }
        });

        // Browser TTS fallback (cost savings)
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
        socketRef.current.disconnect();
        socketRef.current = null;
      }
      stopListening();
      stopSpeaking();
      // Clear all timeouts
      if (silenceTimeoutRef.current) clearTimeout(silenceTimeoutRef.current);
      if (listeningTimeoutRef.current) clearTimeout(listeningTimeoutRef.current);
      if (idleWarningTimeoutRef.current) clearTimeout(idleWarningTimeoutRef.current);
      if (autoCloseTimeoutRef.current) clearTimeout(autoCloseTimeoutRef.current);
    };
  }, [isOpen, user, documentId, onClose, resetIdleTimers]);

  // Update document context when it changes
  useEffect(() => {
    if (socketRef.current && documentId) {
      socketRef.current.emit('setDocument', { documentId });
    }
  }, [documentId]);

  // Browser Speech Recognition with silence detection
  const startListening = useCallback(() => {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
      setError('Speech recognition not supported in this browser');
      setState('error');
      return;
    }

    resetIdleTimers();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SpeechRecognitionAPI =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const recognition = new SpeechRecognitionAPI();

    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onstart = () => {
      setState('listening');
      setTranscript('');
      setResponse('');

      // Set silence timeout
      silenceTimeoutRef.current = setTimeout(() => {
        console.log('Silence timeout - stopping listening');
        recognition.stop();
        setState('idle');
      }, FRONTEND_LIMITS.SILENCE_TIMEOUT_MS);

      // Set max listening duration
      listeningTimeoutRef.current = setTimeout(() => {
        console.log('Max listening duration reached');
        recognition.stop();
        setState('idle');
      }, FRONTEND_LIMITS.MAX_LISTENING_DURATION_MS);
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognition.onresult = (event: any) => {
      // Reset silence timeout on speech detected
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
        // Clear timeouts
        if (silenceTimeoutRef.current) clearTimeout(silenceTimeoutRef.current);
        if (listeningTimeoutRef.current) clearTimeout(listeningTimeoutRef.current);
        // Send final transcript to server
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
  }, [state, resetIdleTimers]);

  const stopListening = useCallback(() => {
    if (silenceTimeoutRef.current) clearTimeout(silenceTimeoutRef.current);
    if (listeningTimeoutRef.current) clearTimeout(listeningTimeoutRef.current);

    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
  }, []);

  // Play next audio chunk from queue
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

  // Play single audio (legacy/fallback)
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

  // Browser Text-to-Speech (cost-saving fallback)
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
  };

  const handleClose = () => {
    stopListening();
    stopSpeaking();
    if (socketRef.current) {
      socketRef.current.emit('voiceCancel');
    }
    onClose();
  };

  if (!isOpen) return null;

  const getOrbStyles = () => {
    switch (state) {
      case 'connecting':
        return 'bg-gray-400 animate-pulse';
      case 'listening':
        return 'bg-gradient-to-tr from-blue-500 to-cyan-400 animate-pulse scale-110';
      case 'processing':
        return 'bg-gradient-to-tr from-amber-500 to-orange-400 animate-spin-slow';
      case 'speaking':
        return 'bg-gradient-to-tr from-emerald-500 to-green-400 animate-pulse';
      case 'error':
        return 'bg-red-500';
      case 'rateLimited':
        return 'bg-yellow-500';
      default:
        return 'bg-gradient-to-tr from-gray-700 to-gray-600';
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
    <div className="fixed inset-0 z-50 flex flex-col bg-white/98 backdrop-blur-xl transition-all duration-300 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between p-6">
        <div>
          <h2 className="text-lg font-medium text-gray-900">Voice Mode</h2>
          <p className="text-sm text-gray-500 truncate max-w-[200px]">
            {documentTitle || 'All Documents'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Connection Status Indicator */}
          <div className="flex items-center gap-2">
            <div
              className={`w-2 h-2 rounded-full ${
                connectionStatus === 'connected'
                  ? 'bg-green-500'
                  : connectionStatus === 'connecting'
                    ? 'bg-yellow-500 animate-pulse'
                    : 'bg-red-500'
              }`}
            />
            <span className="text-xs text-gray-500 hidden sm:inline">
              {connectionStatus === 'connected'
                ? 'Connected'
                : connectionStatus === 'connecting'
                  ? 'Connecting'
                  : 'Disconnected'}
            </span>
          </div>
          <button
            onClick={handleClose}
            className="p-3 bg-gray-100 rounded-full hover:bg-gray-200 transition-colors"
            aria-label="Close voice mode"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Idle Warning Banner */}
      {showIdleWarning && (
        <div className="mx-6 mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg text-center">
          <p className="text-amber-800 text-sm">
            Session will close soon due to inactivity.{' '}
            <button onClick={resetIdleTimers} className="underline font-medium">
              Stay connected
            </button>
          </p>
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 flex flex-col items-center justify-center px-6">
        {/* Orb Visualizer */}
        <button
          onClick={handleMainAction}
          disabled={state === 'connecting' || state === 'processing'}
          className={`w-32 h-32 md:w-40 md:h-40 rounded-full shadow-2xl transition-all duration-500 transform hover:scale-105 disabled:cursor-wait ${getOrbStyles()}`}
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
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
              </svg>
            )}
            {(state === 'idle' || state === 'error') && (
              <svg width="48" height="48" viewBox="0 0 24 24" fill="white">
                <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
                <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
              </svg>
            )}
          </div>
        </button>

        {/* Status Text */}
        <p
          className={`mt-8 text-xl font-medium ${
            state === 'error'
              ? 'text-red-600'
              : state === 'rateLimited'
                ? 'text-yellow-600'
                : 'text-gray-900'
          }`}
        >
          {getStatusText()}
        </p>

        {/* Session Limits Info */}
        {sessionLimits && state === 'idle' && (
          <p className="mt-2 text-xs text-gray-400">
            {sessionLimits.maxQueriesPerMinute} queries/min • {sessionLimits.maxSessionMinutes} min
            max session
          </p>
        )}

        {/* Transcript/Response Display */}
        <div className="mt-6 w-full max-w-md text-center min-h-[80px]">
          {transcript && state === 'listening' && (
            <p className="text-gray-600 italic">&ldquo;{transcript}&rdquo;</p>
          )}
          {response && (state === 'processing' || state === 'speaking') && (
            <p className="text-gray-800">{response}</p>
          )}
        </div>
      </div>

      {/* Footer Controls */}
      <div className="p-6 flex justify-center gap-6">
        {state === 'speaking' && (
          <button
            onClick={() => {
              stopSpeaking();
              setState('idle');
            }}
            className="px-6 py-3 bg-gray-100 text-gray-700 rounded-full font-medium hover:bg-gray-200 transition-colors"
          >
            Stop Speaking
          </button>
        )}
        {state === 'listening' && (
          <button
            onClick={stopListening}
            className="px-6 py-3 bg-red-100 text-red-700 rounded-full font-medium hover:bg-red-200 transition-colors"
          >
            Cancel
          </button>
        )}
      </div>

      {/* Browser Support Warning */}
      {typeof window !== 'undefined' &&
        !('webkitSpeechRecognition' in window) &&
        !('SpeechRecognition' in window) && (
          <div className="absolute bottom-20 left-0 right-0 px-6">
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-center">
              <p className="text-amber-800 text-sm">
                Voice recognition requires Chrome, Edge, or Safari.
              </p>
            </div>
          </div>
        )}
    </div>
  );
}
