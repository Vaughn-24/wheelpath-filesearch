import { Document } from '@wheelpath/schemas';
import { useState, useCallback } from 'react';

import ChatContainer from '../components/ChatContainer';
import DocumentList from '../components/DocumentList';
import DocumentUploader from '../components/DocumentUploader';
import PilotProgramModal from '../components/PilotProgramModal';
import UserMenu from '../components/UserMenu';
import { useAuth } from '../lib/auth';

interface ChatSession {
  id: string;
  title: string;
  createdAt: string;
  messageCount: number;
}

export default function Home() {
  const { user, loading, isDemo, signOut } = useAuth();
  const [selectedDoc, setSelectedDoc] = useState<(Document & { signedUrl?: string }) | null>(null);
  const [chatSessions, setChatSessions] = useState<ChatSession[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [chatKey, setChatKey] = useState(0); // Used to reset ChatContainer
  const [showPilotModal, setShowPilotModal] = useState(false);

  // Handler for sign-in button clicks - shows pilot program modal
  const handleSignInClick = useCallback(() => {
    setShowPilotModal(true);
  }, []);

  const handleSelect = async (doc: Document) => {
    if (!user) {
      handleSignInClick();
      return;
    }
    setSelectedDoc({ ...doc });

    if (isDemo) return;

    try {
      const token = await user.getIdToken();
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
      const res = await fetch(`${apiUrl}/documents/${doc.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const fullDoc = await res.json();
        setSelectedDoc(fullDoc);
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Start a new chat session
  const handleNewChat = useCallback(() => {
    setChatKey((prev) => prev + 1);
    setActiveChatId(null);
  }, []);

  // Save current chat to history
  const handleSaveChat = useCallback((title: string, messageCount: number) => {
    if (messageCount === 0) return;

    const newSession: ChatSession = {
      id: `chat-${Date.now()}`,
      title: title || 'New conversation',
      createdAt: new Date().toISOString(),
      messageCount,
    };
    setChatSessions((prev) => [newSession, ...prev]);
    setActiveChatId(newSession.id);
  }, []);

  // Delete a chat session
  const handleDeleteChat = useCallback(
    (chatId: string) => {
      setChatSessions((prev) => prev.filter((s) => s.id !== chatId));
      if (activeChatId === chatId) {
        setActiveChatId(null);
        setChatKey((prev) => prev + 1);
      }
    },
    [activeChatId],
  );

  // Select a chat from history
  const handleSelectChat = useCallback((chatId: string) => {
    setActiveChatId(chatId);
    // In a real app, this would load the chat messages
  }, []);

  return (
    <>
      {/* Pilot Program Modal */}
      <PilotProgramModal isOpen={showPilotModal} onClose={() => setShowPilotModal(false)} />

      {/* ============================================ */}
      {/* MOBILE LAYOUT (stacked) */}
      {/* ============================================ */}
      <main className="lg:hidden min-h-screen bg-background p-lg font-sans text-foreground">
        <div className="max-w-7xl mx-auto space-y-xl">
          {/* Demo Mode Banner */}
          {isDemo && (
            <div className="bg-terracotta-light border-2 border-terracotta/30 rounded-md p-md flex items-center gap-md">
              <div className="p-xs bg-terracotta rounded-sm">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="white">
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z" />
                </svg>
              </div>
              <div className="flex-1">
                <p className="text-foreground font-medium text-body-sm">Design Preview Mode</p>
              </div>
            </div>
          )}

          {/* Mobile Header */}
          <header className="flex items-center justify-between">
            <div>
              <h1 className="text-heading-lg font-semibold tracking-tight text-foreground">
                WheelPath
              </h1>
              <p className="text-foreground-muted text-body-sm mt-xs">Engineering intelligence</p>
            </div>
            <div className="flex items-center gap-sm">
              {user ? (
                <UserMenu user={user} onSignOut={signOut} size="md" />
              ) : (
                <button onClick={handleSignInClick} className="btn-primary text-body-sm py-sm">
                  Sign in
                </button>
              )}
            </div>
          </header>

          {/* Mobile Hero */}
          <div className="hero-card">
            <h2 className="text-heading font-semibold mb-xs">Project Intelligence Hub</h2>
            <p className="hero-card-secondary text-body-sm">
              Upload RFIs, submittals, and project documents. Get instant, grounded answers.
            </p>
          </div>

          {/* Mobile Upload */}
          <DocumentUploader />

          {/* Mobile Sources */}
          <DocumentList onSelect={handleSelect} />

          {/* Mobile Chat - Full height container with mode switcher */}
          <div className="bento-card h-[600px] p-0 overflow-hidden">
            <ChatContainer
              key={chatKey}
              documentId={selectedDoc?.id}
              documentTitle={selectedDoc?.title}
              signedUrl={selectedDoc?.signedUrl}
              onNewChat={handleNewChat}
              onSaveChat={handleSaveChat}
            />
          </div>
        </div>
      </main>

      {/* ============================================ */}
      {/* DESKTOP LAYOUT (NotebookLM style) */}
      {/* ============================================ */}
      <main className="hidden lg:flex h-screen bg-background font-sans text-foreground overflow-hidden">
        {/* LEFT SIDEBAR - Sources Panel */}
        <aside className="w-80 xl:w-96 h-full border-r border-border bg-background flex flex-col">
          {/* Sidebar Header */}
          <div className="p-xl border-b border-border">
            <div className="flex items-center justify-between mb-lg">
              <h1 className="text-heading-lg font-semibold text-foreground">WheelPath</h1>
              {user && <UserMenu user={user} onSignOut={signOut} size="sm" />}
            </div>
            <p className="text-foreground-muted text-body-sm">
              Engineering intelligence, grounded in your documents.
            </p>

            {isDemo && (
              <div className="mt-md px-md py-xs bg-terracotta-light rounded-sm inline-flex items-center gap-xs">
                <span className="w-2 h-2 bg-terracotta rounded-full"></span>
                <span className="text-terracotta text-caption font-medium">Demo Mode</span>
              </div>
            )}
          </div>

          {/* Upload Section */}
          <div className="p-lg border-b border-border">
            <DocumentUploader />
          </div>

          {/* Sources List */}
          <div className="flex-1 overflow-y-auto">
            <DocumentList onSelect={handleSelect} />
          </div>

          {/* Chat History Section */}
          <div className="border-t border-border">
            <div className="p-md flex items-center justify-between">
              <span className="text-caption font-medium text-foreground-muted uppercase tracking-wider">
                History
              </span>
              {/* New Chat Button */}
              <button
                onClick={handleNewChat}
                className="p-xs rounded hover:bg-terracotta-light text-foreground-muted hover:text-terracotta transition-all"
                title="New chat"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" />
                </svg>
              </button>
            </div>

            {/* Chat History List */}
            <div className="max-h-48 overflow-y-auto">
              {chatSessions.length === 0 ? (
                <p className="px-md pb-md text-foreground-subtle text-caption">
                  No conversations yet
                </p>
              ) : (
                <div className="space-y-xs px-md pb-md">
                  {chatSessions.map((session) => (
                    <div
                      key={session.id}
                      className={`group flex items-center gap-sm p-sm rounded cursor-pointer transition-all ${
                        activeChatId === session.id
                          ? 'bg-terracotta-light text-terracotta'
                          : 'hover:bg-background text-foreground-muted hover:text-foreground'
                      }`}
                      onClick={() => handleSelectChat(session.id)}
                    >
                      {/* Chat icon */}
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="currentColor"
                        className="shrink-0"
                      >
                        <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z" />
                      </svg>
                      <span className="flex-1 truncate text-caption">{session.title}</span>
                      {/* Delete button */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteChat(session.id);
                        }}
                        className="opacity-0 group-hover:opacity-100 p-xs rounded hover:bg-error/10 text-foreground-subtle hover:text-error transition-all"
                        title="Delete"
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Sign in prompt (if not logged in) */}
          {!user && !loading && (
            <div className="p-lg border-t border-border">
              <button
                onClick={handleSignInClick}
                className="w-full btn-primary flex items-center justify-center gap-sm"
              >
                Sign in with Google
              </button>
            </div>
          )}
        </aside>

        {/* MAIN CONTENT - Unified Chat/Voice Container */}
        <div className="flex-1 h-full flex flex-col">
          {/* Top Bar */}
          <header className="h-14 px-xl flex items-center justify-between border-b border-border bg-background shrink-0">
            <h2 className="text-heading font-medium text-foreground">
              {selectedDoc?.title || 'Project Chat'}
            </h2>
            <div className="flex items-center gap-sm">
              {/* New Chat icon */}
              <button
                onClick={handleNewChat}
                className="p-sm rounded hover:bg-terracotta-light text-foreground-muted hover:text-terracotta transition-all"
                title="New chat"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" />
                </svg>
              </button>
              {!user && !loading && (
                <button onClick={handleSignInClick} className="btn-primary text-body-sm">
                  Sign in with Google
                </button>
              )}
            </div>
          </header>

          {/* Chat/Voice Container (fills remaining space) */}
          <div className="flex-1 overflow-hidden">
            <ChatContainer
              key={chatKey}
              documentId={selectedDoc?.id}
              documentTitle={selectedDoc?.title}
              signedUrl={selectedDoc?.signedUrl}
              onNewChat={handleNewChat}
              onSaveChat={handleSaveChat}
            />
          </div>
        </div>
      </main>
    </>
  );
}
