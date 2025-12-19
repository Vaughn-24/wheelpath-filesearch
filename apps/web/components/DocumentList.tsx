import { Document } from '@wheelpath/schemas';
import { collection, query, where, onSnapshot, orderBy } from 'firebase/firestore';
import { useEffect, useState } from 'react';

import { useAuth } from '../lib/auth';
import { db, isDemoMode } from '../lib/firebase';

interface DocumentListProps {
  onSelect?: (doc: Document) => void;
}

// Demo documents for preview mode
const DEMO_DOCUMENTS: Document[] = [
  {
    id: 'demo-1',
    title: 'Project Specifications v2.3.pdf',
    tenantId: 'demo-user-123',
    status: 'ready',
    gcsPath: 'demo/spec.pdf',
    mimeType: 'application/pdf',
    createdAt: new Date(Date.now() - 86400000).toISOString(),
  },
  {
    id: 'demo-2',
    title: 'RFI-2024-0142 Foundation Review.pdf',
    tenantId: 'demo-user-123',
    status: 'ready',
    gcsPath: 'demo/rfi.pdf',
    mimeType: 'application/pdf',
    createdAt: new Date(Date.now() - 172800000).toISOString(),
  },
  {
    id: 'demo-3',
    title: 'Structural Engineering Report.pdf',
    tenantId: 'demo-user-123',
    status: 'processing',
    gcsPath: 'demo/structural.pdf',
    mimeType: 'application/pdf',
    createdAt: new Date(Date.now() - 259200000).toISOString(),
  },
  {
    id: 'demo-4',
    title: 'Site Survey Results Q4.pdf',
    tenantId: 'demo-user-123',
    status: 'ready',
    gcsPath: 'demo/survey.pdf',
    mimeType: 'application/pdf',
    createdAt: new Date(Date.now() - 604800000).toISOString(),
  },
];

export default function DocumentList({ onSelect }: DocumentListProps) {
  const [docs, setDocs] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const { user } = useAuth();

  useEffect(() => {
    if (!user) return;

    // If in demo mode, use mock data
    if (isDemoMode || !db) {
      console.log('Demo mode: using mock documents');
      setDocs(DEMO_DOCUMENTS);
      setLoading(false);
      return;
    }

    const q = query(
      collection(db, 'documents'),
      where('tenantId', '==', user.uid),
      orderBy('createdAt', 'desc'),
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const documents: Document[] = [];
        snapshot.forEach((doc) => {
          documents.push({ id: doc.id, ...doc.data() } as Document);
        });
        setDocs(documents);
        setLoading(false);
      },
      (error) => {
        console.error('Firestore error:', error);
        // On error, fall back to demo data
        setDocs(DEMO_DOCUMENTS);
        setLoading(false);
      },
    );

    return () => unsubscribe();
  }, [user]);

  const handleDelete = async (e: React.MouseEvent, docId: string) => {
    e.preventDefault();
    e.stopPropagation();

    if (isDemoMode) {
      setDocs(docs.filter((d) => d.id !== docId));
      return;
    }

    if (!confirm('Are you sure you want to delete this document?')) return;

    try {
      const token = await user?.getIdToken();
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
      const res = await fetch(`${apiUrl}/documents/${docId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Delete failed');
    } catch (err) {
      console.error('Failed to delete', err);
      alert('Failed to delete document');
    }
  };

  const getStatusStyle = (status: string) => {
    switch (status) {
      case 'ready':
        return 'status-ready';
      case 'processing':
      case 'indexing':
        return 'status-processing';
      case 'error':
        return 'status-error';
      default:
        return 'status-ready';
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'ready':
        return 'Ready';
      case 'processing':
        return 'Processing...';
      case 'indexing':
        return 'Indexing...';
      case 'error':
        return 'Error';
      default:
        return status;
    }
  };

  if (loading) {
    return (
      <div className="p-lg lg:p-md">
        <div className="flex items-center gap-sm text-foreground-muted">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="animate-spin"
          >
            <path d="M21 12a9 9 0 11-6.219-8.56" />
          </svg>
          <span className="text-body-sm">Loading...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="p-lg lg:p-0">
      {/* Mobile: Card style with header */}
      <div className="lg:hidden bento-card">
        <div className="flex items-center justify-between mb-lg">
          <h3 className="text-heading font-semibold text-foreground">Sources</h3>
          <span className="text-caption text-foreground-muted">{docs.length} files</span>
        </div>

        {docs.length === 0 ? (
          <div className="text-center py-xl border-2 border-dashed border-border rounded-md">
            <p className="text-foreground-muted text-body-sm">No sources uploaded yet</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-md">
            {docs.map((doc) => (
              <div key={doc.id} onClick={() => onSelect?.(doc)} className="doc-card group">
                <div className="flex items-start justify-between mb-md">
                  <div className="p-xs bg-terracotta-light rounded-sm text-terracotta group-hover:bg-terracotta group-hover:text-white transition-all">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z" />
                    </svg>
                  </div>
                  <div className="flex items-center gap-xs">
                    <span className={getStatusStyle(doc.status)}>{getStatusText(doc.status)}</span>
                    <button
                      onClick={(e) => handleDelete(e, doc.id)}
                      className="p-xs rounded-sm text-foreground-subtle hover:bg-error/10 hover:text-error transition-all opacity-0 group-hover:opacity-100"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" />
                      </svg>
                    </button>
                  </div>
                </div>
                <p className="font-medium text-foreground truncate text-body-sm">{doc.title}</p>
                <p className="text-caption text-foreground-subtle mt-xs">
                  {new Date(doc.createdAt as string).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                  })}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Desktop: Compact list style for sidebar */}
      <div className="hidden lg:block">
        <div className="px-lg py-md border-b border-border flex items-center justify-between">
          <h3 className="text-body-sm font-semibold text-foreground uppercase tracking-wider">
            Sources
          </h3>
          <span className="text-caption text-foreground-muted">{docs.length}</span>
        </div>

        {docs.length === 0 ? (
          <div className="p-lg text-center">
            <p className="text-foreground-muted text-body-sm">No sources yet</p>
            <p className="text-foreground-subtle text-caption mt-xs">Upload PDFs above</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {docs.map((doc) => (
              <div
                key={doc.id}
                onClick={() => onSelect?.(doc)}
                className="px-lg py-md hover:bg-terracotta-light/50 cursor-pointer transition-all group flex items-start gap-md"
              >
                {/* Icon */}
                <div className="p-xs bg-terracotta-light rounded-sm text-terracotta group-hover:bg-terracotta group-hover:text-white transition-all shrink-0 mt-0.5">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z" />
                  </svg>
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <p
                    className="font-medium text-foreground truncate text-body-sm leading-tight"
                    title={doc.title}
                  >
                    {doc.title}
                  </p>
                  <div className="flex items-center gap-md mt-xs">
                    <span className={getStatusStyle(doc.status)}>{getStatusText(doc.status)}</span>
                    <span className="text-micro text-foreground-subtle">
                      {new Date(doc.createdAt as string).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                      })}
                    </span>
                  </div>
                </div>

                {/* Delete */}
                <button
                  onClick={(e) => handleDelete(e, doc.id)}
                  className="p-xs rounded-sm text-foreground-subtle hover:bg-error/10 hover:text-error transition-all opacity-0 group-hover:opacity-100 shrink-0"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
