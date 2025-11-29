import { useState, useRef, useEffect, useCallback } from 'react';
import { Message } from '@wheelpath/schemas';
import { useAuth } from '../lib/auth';

interface ChatInterfaceProps {
  documentId?: string;
  documentTitle?: string;
  signedUrl?: string;
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

/**
 * ============================================================================
 * COST PROTECTIONS FOR CHAT UI:
 * ============================================================================
 * 1. Query length limit: 2000 characters (enforced client-side)
 * 2. Rate limit display: Shows remaining queries
 * 3. Cooldown between messages: 2 seconds
 * 4. Error handling for rate limits
 * 5. Visual feedback when approaching limits
 */

const CHAT_LIMITS = {
  MAX_QUERY_LENGTH: 2000,
  COOLDOWN_MS: 2000, // 2 seconds between messages
};

export default function ChatInterface({ documentId, documentTitle, signedUrl }: ChatInterfaceProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [streaming, setStreaming] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const [citations, setCitations] = useState<Citation[]>([]);
  const [page, setPage] = useState(1);
  const [activePdfUrl, setActivePdfUrl] = useState<string | undefined>(signedUrl);
  const [activeTitle, setActiveTitle] = useState<string | undefined>(documentTitle);
  const [chatError, setChatError] = useState<string | null>(null);
  const [rateLimit, setRateLimit] = useState<RateLimitInfo | null>(null);
  const [inputLength, setInputLength] = useState(0);
  const [lastMessageTime, setLastMessageTime] = useState(0);
  const [cooldownRemaining, setCooldownRemaining] = useState(0);
  const bottomRef = useRef<HTMLDivElement>(null);
  const { user, loading } = useAuth();

  useEffect(() => {
    if (signedUrl) setActivePdfUrl(signedUrl);
    if (documentTitle) setActiveTitle(documentTitle);
  }, [signedUrl, documentTitle]);

  useEffect(() => {
    if (messages.length > 0) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  // Cooldown timer
  useEffect(() => {
    if (cooldownRemaining > 0) {
      const timer = setTimeout(() => {
        setCooldownRemaining((prev) => Math.max(0, prev - 100));
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [cooldownRemaining]);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    // Enforce max length
    if (value.length <= CHAT_LIMITS.MAX_QUERY_LENGTH) {
      setInputLength(value.length);
    } else {
      // Truncate to max length
      e.target.value = value.slice(0, CHAT_LIMITS.MAX_QUERY_LENGTH);
      setInputLength(CHAT_LIMITS.MAX_QUERY_LENGTH);
    }
  }, []);

  const handleCitationClick = async (citation: Citation) => {
    setPage(citation.pageNumber);

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

  const sendMessage = async () => {
    const inputValue = inputRef.current?.value || '';
    console.log('sendMessage called, input:', inputValue, 'user:', user?.uid);

    if (!inputValue.trim()) {
      console.log('Empty input, returning');
      return;
    }

    if (!user) {
      console.log('No user, showing error');
      setChatError('Authenticating... please wait and try again');
      return;
    }

    // Check cooldown
    const now = Date.now();
    const timeSinceLastMessage = now - lastMessageTime;
    if (timeSinceLastMessage < CHAT_LIMITS.COOLDOWN_MS) {
      const remaining = CHAT_LIMITS.COOLDOWN_MS - timeSinceLastMessage;
      setCooldownRemaining(remaining);
      return;
    }

    // Check query length
    if (inputValue.length > CHAT_LIMITS.MAX_QUERY_LENGTH) {
      setChatError(`Message too long. Maximum ${CHAT_LIMITS.MAX_QUERY_LENGTH} characters.`);
      return;
    }

    setChatError(null);
    setLastMessageTime(now);
    const userMsg: Message = { role: 'user', content: inputValue, createdAt: new Date().toISOString() };
    setMessages((prev) => [...prev, userMsg]);
    if (inputRef.current) {
      inputRef.current.value = '';
      setInputLength(0);
    }
    setStreaming(true);

    try {
      const token = await user.getIdToken();
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
      console.log('Sending to:', `${apiUrl}/chat/stream`);

      const res = await fetch(`${apiUrl}/chat/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          documentId: documentId || 'all',
          query: userMsg.content,
          history: messages.slice(-20), // Only send last 20 messages
        }),
      });

      console.log('Response status:', res.status);

      // Handle rate limiting
      if (res.status === 429) {
        const errorData = await res.json();
        setChatError(errorData.message || 'Rate limit reached. Please wait and try again.');
        setMessages((prev) => prev.slice(0, -1)); // Remove the user message
        setStreaming(false);
        return;
      }

      if (!res.ok) {
        const errorText = await res.text();
        console.error('API error:', res.status, errorText);
        throw new Error(`API error: ${res.status}`);
      }

      if (!res.body) throw new Error('No response body');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let aiMsg: Message = { role: 'model', content: '', createdAt: new Date().toISOString() };
      setMessages((prev) => [...prev, aiMsg]);

      let readerDone = false;
      while (!readerDone) {
        const { done, value } = await reader.read();
        if (done) {
          readerDone = true;
          break;
        }

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const dataStr = line.replace('data: ', '');
            if (dataStr === '[DONE]') break;

            try {
              const { text, citations: newCitations, rateLimit: newRateLimit, truncated } = JSON.parse(dataStr);
              if (newCitations) setCitations(newCitations);
              if (newRateLimit) setRateLimit(newRateLimit);
              if (text) {
                aiMsg = { ...aiMsg, content: aiMsg.content + text };
                setMessages((prev) => {
                  const newHistory = [...prev];
                  newHistory[newHistory.length - 1] = aiMsg;
                  return newHistory;
                });
              }
              if (truncated) {
                aiMsg = { ...aiMsg, content: aiMsg.content + '\n\n[Response truncated for length]' };
                setMessages((prev) => {
                  const newHistory = [...prev];
                  newHistory[newHistory.length - 1] = aiMsg;
                  return newHistory;
                });
              }
            } catch (parseErr) {
              console.error('Error parsing stream chunk:', parseErr);
            }
          }
        }
      }
    } catch (err: unknown) {
      console.error('Chat error:', err);
      const errorMessage = err instanceof Error ? err.message : 'Failed to send message';
      setChatError(errorMessage);
      setMessages((prev) => [
        ...prev,
        {
          role: 'model',
          content: 'Error: ' + errorMessage,
          createdAt: new Date().toISOString(),
        },
      ]);
    } finally {
      setStreaming(false);
    }
  };

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
              className="text-black font-bold hover:bg-gray-200 mx-0.5 px-1.5 py-0.5 rounded bg-gray-100 text-xs transition-colors border border-gray-200"
              title={`Go to Page ${citation.pageNumber}`}
            >
              {index}
            </button>
          );
        }
      }
      return part;
    });
  };

  // Determine if input should be enabled
  const inputEnabled = !streaming && !loading && cooldownRemaining === 0;
  const buttonEnabled = !streaming && !loading && cooldownRemaining === 0;

  // Character count color
  const getCharCountColor = () => {
    const ratio = inputLength / CHAT_LIMITS.MAX_QUERY_LENGTH;
    if (ratio > 0.9) return 'text-red-500';
    if (ratio > 0.7) return 'text-amber-500';
    return 'text-gray-400';
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 h-full min-h-[600px] gap-4 md:gap-6 p-4 md:p-6 bg-gray-50 overflow-hidden">
      {/* PDF Viewer / Citation Source (Top on mobile, Left on desktop) */}
      <div className="h-[250px] md:h-full bento-card p-0 flex flex-col overflow-hidden relative border-0">
        {activePdfUrl ? (
          <iframe
            src={`${activePdfUrl}#page=${page}`}
            className="w-full h-full rounded-3xl"
            title="PDF Viewer"
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-full p-4 md:p-8 text-center bg-gray-100">
            <div className="text-3xl md:text-4xl mb-2 md:mb-4 grayscale opacity-50">📄</div>
            <p className="text-gray-400 text-sm md:text-base">Select a citation to view source</p>
          </div>
        )}
        {activePdfUrl && (
          <div className="absolute bottom-4 md:bottom-6 left-1/2 transform -translate-x-1/2 bg-black text-white px-3 md:px-4 py-1 md:py-1.5 rounded-full text-xs font-medium backdrop-blur-md bg-opacity-90 shadow-lg">
            Page {page}
          </div>
        )}
      </div>

      {/* Chat (Bottom on mobile, Right on desktop) */}
      <div className="flex flex-col bento-card overflow-hidden p-0 min-h-[300px] md:min-h-0">
        <div className="bg-white p-4 md:p-6 border-b border-gray-100 flex justify-between items-center">
          <h2 className="font-medium text-gray-900 truncate pr-2 md:pr-4 text-sm md:text-base">
            {activeTitle || 'Notebook Chat'}
          </h2>
          <div className="flex items-center gap-1 md:gap-2 flex-shrink-0">
            {loading && <span className="text-xs text-gray-400">Connecting...</span>}
            {!loading && user && <span className="text-xs text-green-600">●</span>}
            {!loading && !user && <span className="text-xs text-amber-600">○</span>}
            {rateLimit && (
              <span
                className={`text-[10px] ${rateLimit.remaining < 10 ? 'text-amber-600' : 'text-gray-400'}`}
              >
                {rateLimit.remaining}/{rateLimit.limit}
              </span>
            )}
            <span className="text-[8px] md:text-[10px] uppercase tracking-widest text-gray-400 font-semibold hidden sm:inline">
              Gemini 2.0
            </span>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4 md:space-y-6 bg-white">
          {chatError && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-red-700 text-sm">
              {chatError}
            </div>
          )}
          {messages.length === 0 && (
            <div className="h-full flex flex-col items-center justify-center text-gray-400 space-y-2">
              <div className="w-12 h-12 bg-gray-50 rounded-xl flex items-center justify-center text-xl">
                ✨
              </div>
              {loading ? <p>Connecting...</p> : <p>Ask a question to start.</p>}
            </div>
          )}
          {messages.map((msg, i) => (
            <div
              key={i}
              className={`flex flex-col max-w-[90%] ${msg.role === 'user' ? 'ml-auto items-end' : 'mr-auto items-start'}`}
            >
              <div
                className={`p-4 rounded-2xl text-sm leading-relaxed ${
                  msg.role === 'user' ? 'bg-black text-white' : 'bg-gray-50 text-gray-800'
                }`}
              >
                {msg.role === 'user' ? msg.content : renderMessageContent(msg.content)}
              </div>
            </div>
          ))}
          {streaming && (
            <div className="flex items-center space-x-1.5 text-gray-300 text-sm ml-2">
              <div className="w-1.5 h-1.5 bg-gray-300 rounded-full animate-pulse"></div>
              <div className="w-1.5 h-1.5 bg-gray-300 rounded-full animate-pulse delay-75"></div>
              <div className="w-1.5 h-1.5 bg-gray-300 rounded-full animate-pulse delay-150"></div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        <div className="p-4 bg-white border-t border-gray-100">
          <div className="relative">
            <input
              ref={inputRef}
              onChange={handleInputChange}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  sendMessage();
                }
              }}
              placeholder={
                cooldownRemaining > 0
                  ? `Wait ${Math.ceil(cooldownRemaining / 1000)}s...`
                  : loading
                    ? 'Connecting...'
                    : 'Message WheelPath...'
              }
              className="w-full bg-gray-50 border-none rounded-full py-3.5 pl-5 pr-20 text-sm focus:ring-1 focus:ring-black transition-all disabled:opacity-50"
              disabled={!inputEnabled}
              maxLength={CHAT_LIMITS.MAX_QUERY_LENGTH}
            />
            {/* Character count */}
            {inputLength > 0 && (
              <span className={`absolute right-14 top-1/2 transform -translate-y-1/2 text-xs ${getCharCountColor()}`}>
                {inputLength}/{CHAT_LIMITS.MAX_QUERY_LENGTH}
              </span>
            )}
            <button
              type="button"
              disabled={!buttonEnabled}
              onClick={sendMessage}
              className="absolute right-2 top-1/2 transform -translate-y-1/2 p-1.5 bg-white rounded-full shadow-sm hover:bg-gray-100 disabled:opacity-50 transition-colors"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className="text-black"
              >
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
