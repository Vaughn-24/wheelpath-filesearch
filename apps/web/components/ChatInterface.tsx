import { useState, useRef, useEffect } from 'react';
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

export default function ChatInterface({ documentId, documentTitle, signedUrl }: ChatInterfaceProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [citations, setCitations] = useState<Citation[]>([]);
  const [page, setPage] = useState(1);
  const [activePdfUrl, setActivePdfUrl] = useState<string | undefined>(signedUrl);
  const [activeTitle, setActiveTitle] = useState<string | undefined>(documentTitle);
  const [chatError, setChatError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const { user, loading, signInWithGoogle } = useAuth();

  useEffect(() => {
    if (signedUrl) setActivePdfUrl(signedUrl);
    if (documentTitle) setActiveTitle(documentTitle);
  }, [signedUrl, documentTitle]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleCitationClick = async (citation: Citation) => {
    setPage(citation.pageNumber);
    
    // If citation is from a different doc, fetch and switch
    if (citation.documentId && citation.documentId !== documentId) {
        try {
            const token = await user?.getIdToken();
            const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
            const res = await fetch(`${apiUrl}/documents/${citation.documentId}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) {
                const doc = await res.json();
                setActivePdfUrl(doc.signedUrl);
                setActiveTitle(doc.title);
            }
        } catch (e) {
            console.error("Failed to load citation source", e);
        }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    
    // If no user, prompt sign-in
    if (!user) {
      setChatError('Please sign in to chat');
      signInWithGoogle();
      return;
    }

    setChatError(null);
    const userMsg: Message = { role: 'user', content: input, createdAt: new Date().toISOString() };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setStreaming(true);

    try {
        const token = await user.getIdToken();
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
        console.log('Sending chat request to:', `${apiUrl}/chat/stream`);
        
        const res = await fetch(`${apiUrl}/chat/stream`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ 
                documentId: documentId || 'all', 
                query: userMsg.content, 
                history: messages 
            })
        });

        if (!res.ok) {
            const errorText = await res.text();
            console.error('Chat API error:', res.status, errorText);
            throw new Error(`API error: ${res.status}`);
        }

        if (!res.body) throw new Error('No response body');

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let aiMsg: Message = { role: 'model', content: '', createdAt: new Date().toISOString() };
        setMessages(prev => [...prev, aiMsg]);

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            
            const chunk = decoder.decode(value);
            const lines = chunk.split('\n\n');
            
            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const dataStr = line.replace('data: ', '');
                    if (dataStr === '[DONE]') break;
                    
                    try {
                        const { text, citations: newCitations } = JSON.parse(dataStr);
                        if (newCitations) setCitations(newCitations);
                        if (text) {
                            aiMsg = { ...aiMsg, content: aiMsg.content + text };
                            setMessages(prev => {
                                const newHistory = [...prev];
                                newHistory[newHistory.length - 1] = aiMsg;
                                return newHistory;
                            });
                        }
                    } catch (e) { console.error('Error parsing stream', e); }
                }
            }
        }
    } catch (err: any) {
        console.error('Chat error:', err);
        setChatError(err.message || 'Failed to send message');
        setMessages(prev => [...prev, { role: 'model', content: 'Error generating response. Please try again.', createdAt: new Date().toISOString() }]);
    } finally {
        setStreaming(false);
    }
  };

  const renderMessageContent = (content: string) => {
    const parts = content.split(/(\[\d+\])/g);
    return parts.map((part, i) => {
        if (part.match(/^\[\d+\]$/)) {
            const index = parseInt(part.replace('[', '').replace(']', ''));
            const citation = citations.find(c => c.index === index);
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

  return (
    <div className="flex h-[calc(100vh-2rem)] gap-6 p-4 lg:p-6 bg-gray-50 overflow-hidden">
      {/* PDF Viewer (Left) */}
      <div className="w-1/2 bento-card p-0 flex flex-col overflow-hidden relative border-0">
         {activePdfUrl ? (
             <iframe 
                src={`${activePdfUrl}#page=${page}`} 
                className="w-full h-full rounded-3xl" 
                title="PDF Viewer"
             />
         ) : (
             <div className="flex flex-col items-center justify-center h-full p-8 text-center bg-gray-100">
                <div className="text-4xl mb-4 grayscale opacity-50">📄</div>
                <p className="text-gray-400">Select a citation to view source</p>
             </div>
         )}
         {activePdfUrl && (
            <div className="absolute bottom-6 left-1/2 transform -translate-x-1/2 bg-black text-white px-4 py-1.5 rounded-full text-xs font-medium backdrop-blur-md bg-opacity-90 shadow-lg">
                Page {page}
            </div>
         )}
      </div>

      {/* Chat (Right) */}
      <div className="w-1/2 flex flex-col bento-card overflow-hidden p-0">
        <div className="bg-white p-6 border-b border-gray-100 flex justify-between items-center">
            <h2 className="font-medium text-gray-900 truncate pr-4">
                {activeTitle || 'Notebook Chat'}
            </h2>
            <div className="text-[10px] uppercase tracking-widest text-gray-400 font-semibold">Gemini 1.5 Pro</div>
        </div>
        
        <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-white">
            {chatError && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-red-700 text-sm">
                    {chatError}
                </div>
            )}
            {messages.length === 0 && (
                <div className="h-full flex flex-col items-center justify-center text-gray-400 space-y-2">
                    <div className="w-12 h-12 bg-gray-50 rounded-xl flex items-center justify-center text-xl">✨</div>
                    {loading ? (
                        <p>Connecting...</p>
                    ) : !user ? (
                        <div className="text-center space-y-2">
                            <p>Sign in to start chatting</p>
                            <button
                                onClick={signInWithGoogle}
                                className="bg-black text-white px-4 py-2 rounded-full text-sm font-medium hover:bg-gray-800 transition-colors"
                            >
                                Sign in with Google
                            </button>
                        </div>
                    ) : (
                        <p>Ask a question to start.</p>
                    )}
                </div>
            )}
            {messages.map((msg, i) => (
                <div key={i} className={`flex flex-col max-w-[90%] ${msg.role === 'user' ? 'ml-auto items-end' : 'mr-auto items-start'}`}>
                    <div className={`p-4 rounded-2xl text-sm leading-relaxed ${
                        msg.role === 'user' 
                        ? 'bg-black text-white' 
                        : 'bg-gray-50 text-gray-800'
                    }`}>
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
            <form onSubmit={handleSubmit} className="relative">
                <input 
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    placeholder="Message WheelPath..."
                    className="w-full bg-gray-50 border-none rounded-full py-3.5 pl-5 pr-12 text-sm focus:ring-1 focus:ring-black transition-all"
                    disabled={streaming || !user}
                />
                <button 
                    type="submit"
                    disabled={streaming || !input.trim() || !user}
                    className="absolute right-2 top-1/2 transform -translate-y-1/2 p-1.5 bg-white rounded-full shadow-sm hover:bg-gray-100 disabled:opacity-50 transition-colors"
                >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-black">
                        <path d="M5 12h14M12 5l7 7-7 7"/>
                    </svg>
                </button>
            </form>
        </div>
      </div>
    </div>
  );
}
