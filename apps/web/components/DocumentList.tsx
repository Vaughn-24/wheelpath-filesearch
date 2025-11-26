import { useEffect, useState } from 'react';
import { collection, query, where, onSnapshot, orderBy } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../lib/auth';
import { Document } from '@wheelpath/schemas';

interface DocumentListProps {
  onSelect?: (doc: Document) => void;
}

export default function DocumentList({ onSelect }: DocumentListProps) {
  const [docs, setDocs] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const { user } = useAuth();

  useEffect(() => {
    if (!user) return;

    const q = query(
      collection(db, 'documents'), 
      where('tenantId', '==', user.uid),
      orderBy('createdAt', 'desc')
    );
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const documents: Document[] = [];
      snapshot.forEach((doc) => {
        documents.push({ id: doc.id, ...doc.data() } as Document);
      });
      setDocs(documents);
      setLoading(false);
    }, (error) => {
      console.error("Firestore error:", error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [user]);

  const handleDelete = async (e: React.MouseEvent, docId: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm('Are you sure you want to delete this document?')) return;

    try {
        const token = await user?.getIdToken();
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
        const res = await fetch(`${apiUrl}/documents/${docId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) throw new Error('Delete failed');
    } catch (err) {
        console.error('Failed to delete', err);
        alert('Failed to delete document');
    }
  };

  if (loading) return <div className="p-4 text-gray-400">Loading sources...</div>;

  return (
    <div className="bento-card">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-xl font-medium text-gray-900">Sources</h3>
        <span className="text-xs bg-gray-100 text-gray-500 px-2 py-1 rounded-md font-medium">{docs.length} FILES</span>
      </div>
      
      {docs.length === 0 ? (
        <div className="text-center py-12 border-2 border-dashed border-gray-100 rounded-2xl">
            <p className="text-gray-400">No sources yet.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {docs.map(doc => (
            <div 
                key={doc.id} 
                onClick={() => onSelect?.(doc)}
                className="group block cursor-pointer"
            >
                <div className="border border-gray-200 rounded-2xl p-4 hover:border-black transition-colors h-full flex flex-col justify-between bg-gray-50/50 hover:bg-white">
                    <div className="flex items-start justify-between mb-4">
                        <div className="bg-white border border-gray-200 p-2 rounded-lg text-gray-400 group-hover:text-black transition-colors">
                            📄
                        </div>
                        <div className="flex items-center space-x-2">
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide ${
                              doc.status === 'ready' ? 'bg-gray-200 text-black' :
                              'bg-gray-100 text-gray-400'
                            }`}>
                              {doc.status}
                            </span>
                            <button 
                                onClick={(e) => handleDelete(e, doc.id)}
                                className="p-1.5 rounded-full hover:bg-red-100 text-gray-400 hover:text-red-600 transition-colors"
                                title="Delete Document"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M3 6h18"></path>
                                    <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path>
                                    <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path>
                                </svg>
                            </button>
                        </div>
                    </div>
                    <div>
                        <p className="font-medium text-gray-900 truncate" title={doc.title}>{doc.title}</p>
                        <p className="text-xs text-gray-400 mt-1">{new Date(doc.createdAt as string).toLocaleDateString()}</p>
                    </div>
                </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
