import { useState } from 'react';
import DocumentUploader from '../components/DocumentUploader';
import DocumentList from '../components/DocumentList';
import ChatInterface from '../components/ChatInterface';
import VoiceOverlay from '../components/VoiceOverlay';
import { useAuth } from '../lib/auth';
import { Document } from '@wheelpath/schemas';

export default function Home() {
  const { user, loading, error, signInWithGoogle } = useAuth();
  const [selectedDoc, setSelectedDoc] = useState<(Document & { signedUrl?: string }) | null>(null);
  const [voiceOpen, setVoiceOpen] = useState(false);

  const handleChatAll = () => {
    if (!user) {
      // If not authenticated, trigger Google sign-in
      signInWithGoogle();
      return;
    }
    setSelectedDoc({
        id: 'all',
        title: 'All Documents',
        tenantId: user.uid,
        status: 'ready',
        gcsPath: '',
        mimeType: 'application/pdf',
        createdAt: new Date().toISOString()
    } as Document);
    
    setTimeout(() => {
        document.getElementById('chat-view')?.scrollIntoView({ behavior: 'smooth' });
    }, 100);
  };

  const handleSelect = async (doc: Document) => {
    if (!user) {
      signInWithGoogle();
      return;
    }
    setSelectedDoc({ ...doc }); // Show immediately while fetching details

    try {
        const token = await user.getIdToken();
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
        const res = await fetch(`${apiUrl}/documents/${doc.id}`, {
             headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) {
            const fullDoc = await res.json();
            setSelectedDoc(fullDoc);
            // Scroll to chat
            setTimeout(() => {
                document.getElementById('chat-view')?.scrollIntoView({ behavior: 'smooth' });
            }, 100);
        }
    } catch (e) {
        console.error(e);
    }
  };

  return (
    <main className="min-h-screen bg-gray-50 p-6 lg:p-12 font-sans text-gray-900">
      <div className="max-w-7xl mx-auto space-y-8">
        {/* Header */}
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-black">WheelPath AI</h1>
            <p className="text-gray-500 mt-1">Your knowledge base, grounded in truth.</p>
          </div>
          <div className="flex items-center gap-4">
            {loading ? (
              <div className="text-sm text-gray-400">Loading...</div>
            ) : user ? (
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-500">{user.email || 'Anonymous'}</span>
                <div className="h-10 w-10 rounded-full bg-black flex items-center justify-center text-white font-medium">
                  {user.email ? user.email[0].toUpperCase() : 'A'}
                </div>
              </div>
            ) : (
              <button
                onClick={signInWithGoogle}
                className="bg-black text-white px-4 py-2 rounded-full text-sm font-medium hover:bg-gray-800 transition-colors"
              >
                Sign in with Google
              </button>
            )}
          </div>
        </header>

        {/* Auth Error Banner */}
        {error && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-amber-600">⚠️</span>
              <span className="text-amber-800 text-sm">{error}</span>
            </div>
            <button
              onClick={signInWithGoogle}
              className="bg-amber-600 text-white px-4 py-1.5 rounded-full text-sm font-medium hover:bg-amber-700 transition-colors"
            >
              Sign in with Google
            </button>
          </div>
        )}
        
        {/* Bento Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          
          {/* 1. Hero / Stats (Top Left - 8 cols) */}
          <div className="lg:col-span-8 bento-card bg-black text-white border-none flex flex-col justify-between relative overflow-hidden group">
             <div className="absolute top-0 right-0 -mt-10 -mr-10 w-64 h-64 bg-gray-800 rounded-full blur-3xl opacity-50 group-hover:opacity-70 transition-opacity"></div>
             <div className="relative z-10">
                <h2 className="text-2xl font-medium mb-2">Notebook Overview</h2>
                <p className="text-gray-400 max-w-md mb-6">
                   Upload your documents to start a conversation. WheelPath uses RAG to ground every answer in your source material.
                </p>
                <button 
                    onClick={handleChatAll}
                    className="bg-white text-black px-5 py-2.5 rounded-full font-medium hover:bg-gray-100 transition-colors flex items-center gap-2 text-sm"
                >
                    <span>{user ? 'Start Notebook Chat' : 'Sign in to Chat'}</span>
                    <span>→</span>
                </button>
             </div>
             <div className="flex gap-8 mt-8 relative z-10">
                <div>
                    <div className="text-3xl font-bold">Gemini</div>
                    <div className="text-xs text-gray-500 uppercase tracking-wider mt-1">Model</div>
                </div>
                <div>
                    <div className="text-3xl font-bold">Secure</div>
                    <div className="text-xs text-gray-500 uppercase tracking-wider mt-1">Storage</div>
                </div>
             </div>
          </div>

          {/* 2. Upload Action (Top Right - 4 cols) */}
          <div className="lg:col-span-4">
             <DocumentUploader />
          </div>

          {/* 3. Sources List (Bottom - Full Width) */}
          <div className="lg:col-span-12">
             <DocumentList onSelect={handleSelect} />
          </div>

          {/* 4. Chat Interface (Global) */}
          <div className="lg:col-span-12 mt-6" id="chat-view">
            <div className="bento-card bg-white border border-gray-200 shadow-sm h-[600px] md:h-[700px] p-0 overflow-hidden">
                <ChatInterface 
                    documentId={selectedDoc?.id} 
                    documentTitle={selectedDoc?.title}
                    signedUrl={selectedDoc?.signedUrl}
                />
            </div>
          </div>
        </div>
      </div>

      {/* Voice Mode FAB - Floating Action Button */}
      {user && (
        <button
          onClick={() => setVoiceOpen(true)}
          className="fixed bottom-6 right-6 z-40 w-14 h-14 bg-black text-white rounded-full shadow-lg hover:bg-gray-800 hover:scale-105 transition-all duration-200 flex items-center justify-center group"
          aria-label="Open voice mode"
          title="Voice Mode"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" className="group-hover:scale-110 transition-transform">
            <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>
            <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
          </svg>
        </button>
      )}

      {/* Voice Overlay - Completely isolated from ChatInterface */}
      <VoiceOverlay
        isOpen={voiceOpen}
        onClose={() => setVoiceOpen(false)}
        documentId={selectedDoc?.id}
        documentTitle={selectedDoc?.title}
      />
    </main>
  );
}
