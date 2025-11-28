import { useState, useEffect, useRef, useCallback } from 'react';

import { useAuth } from '../lib/auth';

type VoiceState = 'idle' | 'connecting' | 'listening' | 'processing' | 'speaking' | 'error';

interface AudioChunk {
  audio: string;
  index: number;
  text: string;
  isFinal?: boolean;
}

interface VoiceOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  documentId?: string;
  documentTitle?: string;
}

/**
 * VoiceOverlay - Full-screen voice interface with STREAMING AUDIO
 *
 * OPTIMIZED FOR LOW LATENCY:
 * - Receives audio chunks as they're generated (not waiting for full response)
 * - Uses audio queue for seamless playback
 * - Starts speaking within 1-2 seconds of asking
 *
 * Flow:
 * 1. User opens overlay -> WebSocket connects
 * 2. User speaks -> Browser Speech Recognition -> Text
 * 3. Text sent to server via WebSocket
 * 4. Server streams audio chunks as sentences complete
 * 5. Client plays audio chunks progressively
 */
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const socketRef = useRef<ReturnType<typeof import('socket.io-client').io> | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null);
  const synthRef = useRef<SpeechSynthesisUtterance | null>(null);

  // Audio queue for streaming playback
  const audioQueueRef = useRef<AudioChunk[]>([]);
  const isPlayingRef = useRef(false);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);

  // Connect to WebSocket when overlay opens
  useEffect(() => {
    if (!isOpen || !user) return;

    const connectSocket = async () => {
      setState('connecting');
      setError(null);

      try {
        // Dynamic import socket.io-client (only when needed)
        const { io } = await import('socket.io-client');
        const token = await user.getIdToken();
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

        const socket = io(`${apiUrl}/voice`, {
          auth: { token },
          transports: ['websocket'],
        });

        socket.on('connect', () => {
          console.log('Voice socket connected');
        });

        socket.on('authenticated', () => {
          setState('idle');
          // Set document context
          socket.emit('setDocument', { documentId: documentId || 'all' });
        });

        socket.on('voiceStart', () => {
          setState('processing');
          setResponse('');
          // Clear audio queue for new response
          audioQueueRef.current = [];
          isPlayingRef.current = false;
        });

        socket.on('voiceChunk', (data: { text: string }) => {
          setResponse((prev) => prev + data.text);
        });

        // NEW: Handle streaming audio chunks
        socket.on('voiceAudioChunk', (data: AudioChunk) => {
          // Add to queue and start playing if not already
          audioQueueRef.current.push(data);
          if (!isPlayingRef.current) {
            playNextAudioChunk();
          }
        });

        // Legacy: single audio response (fallback)
        socket.on('voiceAudio', (data: { audio: string; format: string; fullText: string }) => {
          setState('speaking');
          playAudioFromBase64(data.audio, data.format);
        });

        socket.on('voiceEnd', (data: { fullText: string; audioChunks?: number }) => {
          // If no audio chunks were sent, fall back to browser TTS
          if (!data.audioChunks || data.audioChunks === 0) {
            setState('speaking');
            speakResponse(data.fullText);
          }
          // Otherwise, audio queue will handle transition to idle
        });

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
    };
  }, [isOpen, user, documentId]);

  // Update document context when it changes
  useEffect(() => {
    if (socketRef.current && documentId) {
      socketRef.current.emit('setDocument', { documentId });
    }
  }, [documentId]);

  // Browser Speech Recognition
  const startListening = useCallback(() => {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
      setError('Speech recognition not supported in this browser');
      setState('error');
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
      setState('listening');
      setTranscript('');
      setResponse('');
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognition.onresult = (event: any) => {
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
        // Send final transcript to server
        socketRef.current.emit('voiceQuery', { text: finalTranscript });
      }
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognition.onerror = (event: any) => {
      console.error('Speech recognition error:', event.error);
      if (event.error !== 'no-speech') {
        setError(`Speech error: ${event.error}`);
        setState('error');
      } else {
        setState('idle');
      }
    };

    recognition.onend = () => {
      if (state === 'listening') {
        setState('idle');
      }
    };

    recognitionRef.current = recognition;
    recognition.start();
  }, [state]);

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
  }, []);

  // Play next audio chunk from queue (for streaming playback)
  const playNextAudioChunk = useCallback(() => {
    if (audioQueueRef.current.length === 0) {
      isPlayingRef.current = false;
      // Check if we should go back to idle
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
        // Play next chunk in queue
        playNextAudioChunk();
      };

      audio.onerror = () => {
        console.error('Audio chunk playback failed');
        URL.revokeObjectURL(audioUrl);
        currentAudioRef.current = null;
        // Try next chunk
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

  // Browser Text-to-Speech (fallback)
  const speakResponse = useCallback((text: string) => {
    if (!('speechSynthesis' in window)) {
      setState('idle');
      return;
    }

    // Cancel any ongoing speech
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
    // Clear audio queue
    audioQueueRef.current = [];
    isPlayingRef.current = false;

    // Stop current audio
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current = null;
    }
    // Stop browser TTS fallback
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    synthRef.current = null;
  }, []);

  // Handle main button press
  const handleMainAction = () => {
    if (state === 'listening') {
      stopListening();
    } else if (state === 'speaking') {
      stopSpeaking();
      setState('idle');
    } else if (state === 'idle') {
      startListening();
    } else if (state === 'error') {
      setState('idle');
      setError(null);
    }
  };

  // Handle close
  const handleClose = () => {
    stopListening();
    stopSpeaking();
    if (socketRef.current) {
      socketRef.current.emit('voiceCancel');
    }
    onClose();
  };

  if (!isOpen) return null;

  // State-based styling
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

      {/* Main Content */}
      <div className="flex-1 flex flex-col items-center justify-center px-6">
        {/* Orb Visualizer */}
        <button
          onClick={handleMainAction}
          disabled={state === 'connecting' || state === 'processing'}
          className={`w-32 h-32 md:w-40 md:h-40 rounded-full shadow-2xl transition-all duration-500 transform hover:scale-105 disabled:cursor-wait ${getOrbStyles()}`}
          aria-label={state === 'listening' ? 'Stop listening' : 'Start listening'}
        >
          {/* Inner glow effect */}
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
          className={`mt-8 text-xl font-medium ${state === 'error' ? 'text-red-600' : 'text-gray-900'}`}
        >
          {getStatusText()}
        </p>

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
