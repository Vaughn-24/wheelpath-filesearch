import { useState } from 'react';
import DocumentUploader from '../components/DocumentUploader';
import DocumentList from '../components/DocumentList';
import ChatInterface from '../components/ChatInterface';
import { useAuth } from '../lib/auth';
import { Document } from '@wheelpath/schemas';

export default function Home() {
  const { user } = useAuth();
  const [selectedDoc, setSelectedDoc] = useState<(Document & { signedUrl?: string }) | null>(null);

  const handleChatAll = () => {
    if (!user) return;
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
    if (!user) return;
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
             <div className="h-10 w-10 rounded-full bg-gray-200 flex items-center justify-center text-gray-500 font-medium">
                U
             </div>
          </div>
        </header>
        
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
                    <span>Start Notebook Chat</span>
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
            <div className="bento-card bg-white border border-gray-200 shadow-sm min-h-[600px] p-0 overflow-hidden">
                <ChatInterface 
                    documentId={selectedDoc?.id} 
                    documentTitle={selectedDoc?.title}
                    signedUrl={selectedDoc?.signedUrl}
                />
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
