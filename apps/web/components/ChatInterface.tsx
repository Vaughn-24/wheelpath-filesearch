import { Message } from '@wheelpath/schemas';
import { useState, useRef, useEffect, useCallback } from 'react';

import { useAuth } from '../lib/auth';
import { isDemoMode } from '../lib/firebase';

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

const CHAT_LIMITS = {
  MAX_QUERY_LENGTH: 2000,
  COOLDOWN_MS: 2000,
};

// Demo responses for preview mode
const DEMO_RESPONSES = [
  'Based on the Project Specifications document [1], the foundation requirements specify a minimum depth of 4 feet below grade with reinforced concrete footings. The structural engineer has approved a load-bearing capacity of 3,000 PSF [2].',
  'According to RFI-2024-0142 [1], the foundation review identified three areas requiring additional soil compaction testing. The geotechnical report recommends dynamic compaction in zones A, B, and C before proceeding with foundation work [2].',
  'The Structural Engineering Report indicates that the steel beam connections at grid lines 3 and 7 require special inspection per IBC Section 1705 [1]. Welding procedures must comply with AWS D1.1 specifications [2].',
  'From the Site Survey Results [1], the existing grade elevations show a 2.3% slope from north to south across the project site. Drainage design should account for this natural runoff pattern [2].',
];

export default function ChatInterface({
  documentId,
  documentTitle,
  signedUrl,
}: ChatInterfaceProps) {
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
  const [showPdf, setShowPdf] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const { user, loading, isDemo } = useAuth();

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
      const timer = setTimeout(() => {
        setCooldownRemaining((prev) => Math.max(0, prev - 100));
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [cooldownRemaining]);

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

    if (isDemo || isDemoMode) {
      return;
    }

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

  // Demo mode: simulate streaming response
  const sendDemoMessage = async (userMessage: string) => {
    const userMsg: Message = {
      role: 'user',
      content: userMessage,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);
    if (inputRef.current) {
      inputRef.current.value = '';
      setInputLength(0);
    }
    setStreaming(true);

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
    }

    setStreaming(false);
    setRateLimit({ remaining: 47, limit: 50 });
  };

  const sendMessage = async () => {
    const inputValue = inputRef.current?.value || '';

    if (!inputValue.trim()) return;

    if (!user) {
      setChatError('Authenticating... please wait and try again');
      return;
    }

    const now = Date.now();
    const timeSinceLastMessage = now - lastMessageTime;
    if (timeSinceLastMessage < CHAT_LIMITS.COOLDOWN_MS) {
      const remaining = CHAT_LIMITS.COOLDOWN_MS - timeSinceLastMessage;
      setCooldownRemaining(remaining);
      return;
    }

    if (inputValue.length > CHAT_LIMITS.MAX_QUERY_LENGTH) {
      setChatError(`Message too long. Maximum ${CHAT_LIMITS.MAX_QUERY_LENGTH} characters.`);
      return;
    }

    setChatError(null);
    setLastMessageTime(now);

    if (isDemo || isDemoMode) {
      await sendDemoMessage(inputValue);
      return;
    }

    const userMsg: Message = {
      role: 'user',
      content: inputValue,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);
    if (inputRef.current) {
      inputRef.current.value = '';
      setInputLength(0);
    }
    setStreaming(true);

    try {
      const token = await user.getIdToken();
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

      const res = await fetch(`${apiUrl}/chat/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          documentId: documentId || 'all',
          query: userMsg.content,
          history: messages.slice(-20),
        }),
      });

      if (res.status === 429) {
        const errorData = await res.json();
        setChatError(errorData.message || 'Rate limit reached.');
        setMessages((prev) => prev.slice(0, -1));
        setStreaming(false);
        return;
      }

      if (!res.ok) {
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
              const {
                text,
                citations: newCitations,
                rateLimit: newRateLimit,
                truncated,
              } = JSON.parse(dataStr);
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
                aiMsg = { ...aiMsg, content: aiMsg.content + '\n\n[Response truncated]' };
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
        { role: 'model', content: 'Error: ' + errorMessage, createdAt: new Date().toISOString() },
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
              className="citation-btn mx-0.5"
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

  const inputEnabled = !streaming && !loading && cooldownRemaining === 0;
  const buttonEnabled = !streaming && !loading && cooldownRemaining === 0;

  const getCharCountColor = () => {
    const ratio = inputLength / CHAT_LIMITS.MAX_QUERY_LENGTH;
    if (ratio > 0.9) return 'text-error';
    if (ratio > 0.7) return 'text-amber';
    return 'text-foreground-subtle';
  };

  return (
    <div className="h-full flex bg-background">
      {/* PDF Viewer - toggleable on desktop, hidden on mobile in this context */}
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
          {(activePdfUrl || page > 1) && (
            <div className="h-10 px-lg flex items-center justify-center border-t border-border bg-surface shrink-0">
              <span className="text-caption text-foreground-muted">Page {page}</span>
            </div>
          )}
        </div>
      )}

      {/* Chat Panel */}
      <div className={`flex-1 h-full flex flex-col ${showPdf ? 'lg:w-1/2' : ''}`}>
        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-lg lg:p-xl">
          {chatError && <div className="alert-error mb-lg">{chatError}</div>}
          {messages.length === 0 && (
            <div className="h-full flex flex-col items-center justify-center text-center">
              <div className="w-16 h-16 bg-terracotta-light rounded-md flex items-center justify-center mb-lg">
                <svg
                  width="32"
                  height="32"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  className="text-terracotta"
                >
                  <path d="M20 2H4c-1.1 0-1.99.9-1.99 2L2 22l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-2 12H6v-2h12v2zm0-3H6V9h12v2zm0-3H6V6h12v2z" />
                </svg>
              </div>
              {loading ? (
                <p className="text-foreground-muted text-body-sm">Connecting...</p>
              ) : (
                <>
                  <p className="text-foreground text-body font-medium">Ask a question</p>
                  <p className="text-foreground-muted text-body-sm mt-xs">
                    {isDemo
                      ? 'Try asking about project specs or RFIs'
                      : 'Get answers grounded in your documents'}
                  </p>
                </>
              )}
            </div>
          )}
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

        {/* Input */}
        <div className="p-lg border-t border-border bg-surface shrink-0">
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
                    : isDemo
                      ? 'Try: "What are the foundation requirements?"'
                      : 'Ask about your documents...'
              }
              className="input-modern pr-24"
              disabled={!inputEnabled}
              maxLength={CHAT_LIMITS.MAX_QUERY_LENGTH}
            />
            {inputLength > 0 && (
              <span
                className={`absolute right-16 top-1/2 transform -translate-y-1/2 text-micro ${getCharCountColor()}`}
              >
                {inputLength}/{CHAT_LIMITS.MAX_QUERY_LENGTH}
              </span>
            )}
            <button
              type="button"
              disabled={!buttonEnabled}
              onClick={sendMessage}
              className="absolute right-sm top-1/2 transform -translate-y-1/2 p-sm bg-foreground text-white rounded-sm
                         hover:bg-[#3D3225] disabled:opacity-50 transition-all duration-base
                         focus:ring-2 focus:ring-terracotta focus:ring-offset-2"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
              </svg>
            </button>
          </div>
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
      </div>
    </div>
  );
}
