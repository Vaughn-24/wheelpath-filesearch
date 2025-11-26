import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import ChatInterface from '../../components/ChatInterface';
import { Document } from '@wheelpath/schemas';
import { useAuth } from '../../lib/auth';

export default function ChatPage() {
  const router = useRouter();
  const { id } = router.query;
  const { user } = useAuth();
  const [document, setDocument] = useState<(Document & { signedUrl?: string }) | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id || typeof id !== 'string' || !user) return;

    const fetchDoc = async () => {
      try {
        const token = await user.getIdToken();
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
        
        const res = await fetch(`${apiUrl}/documents/${id}`, {
             headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!res.ok) throw new Error('Failed to load document');
        const data = await res.json();
        setDocument(data);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    };
    
    fetchDoc();
  }, [id, user]);

  if (loading) return <div className="p-8">Loading workspace...</div>;
  if (!document) return <div className="p-8">Document not found.</div>;

  return (
    <div className="bg-gray-50 min-h-screen flex flex-col">
        <header className="bg-white border-b px-6 py-4 flex items-center justify-between shadow-sm z-10">
            <h1 className="font-bold text-xl tracking-tight">WheelPath AI</h1>
            <button onClick={() => router.push('/')} className="text-sm font-medium text-gray-500 hover:text-gray-900 transition-colors">
                &larr; Back to Library
            </button>
        </header>
        <div className="flex-1">
            <ChatInterface 
                documentId={document.id} 
                documentTitle={document.title} 
                signedUrl={document.signedUrl}
            />
        </div>
    </div>
  );
}
