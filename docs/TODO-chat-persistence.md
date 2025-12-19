# TODO: Chat Persistence Backend

> **Status:** Pending - Requires GCP billing to be re-enabled  
> **Priority:** High  
> **Created:** December 2024

## Overview

The chat management UI (new chat, clear conversation, delete from history) is currently **frontend-only**. All chat sessions are stored in React state and lost on page refresh. This document outlines the backend implementation needed for full CRUD persistence.

---

## Current State

### What Works (Frontend)

- ✅ New chat button resets the chat interface
- ✅ Clear conversation clears messages and saves to local history
- ✅ Chat history displays in sidebar
- ✅ Delete removes from history list
- ✅ Clicking history item highlights it

### What's Missing (Backend)

- ❌ No Firestore collection for conversations
- ❌ No API endpoints for CRUD operations
- ❌ No persistence across page refreshes
- ❌ No sync between devices

---

## Implementation Plan

### 1. Firestore Schema

```typescript
// Collection: conversations
interface Conversation {
  id: string; // Auto-generated
  userId: string; // Firebase Auth UID
  documentId?: string; // Optional - linked source document
  title: string; // Auto-generated from first message
  status: 'active' | 'archived'; // Soft delete support
  createdAt: Timestamp;
  updatedAt: Timestamp;
  messageCount: number;
}

// Subcollection: conversations/{id}/messages
interface Message {
  id: string;
  role: 'user' | 'model';
  content: string;
  createdAt: Timestamp;
  citations?: Citation[];
}

interface Citation {
  index: number;
  pageNumber: number;
  text: string;
  documentId: string;
}
```

### 2. API Endpoints

Add to `apps/api/src/routes/`:

```typescript
// conversations.ts

// CREATE - Start new conversation
POST /conversations
Body: { documentId?: string }
Response: { id: string, createdAt: string }

// READ - List user's conversations
GET /conversations
Query: { status?: 'active' | 'archived', limit?: number }
Response: { conversations: Conversation[] }

// READ - Get single conversation with messages
GET /conversations/:id
Response: { conversation: Conversation, messages: Message[] }

// UPDATE - Add message to conversation
POST /conversations/:id/messages
Body: { role: 'user' | 'model', content: string, citations?: Citation[] }
Response: { message: Message }

// UPDATE - Update conversation metadata
PATCH /conversations/:id
Body: { title?: string, status?: 'active' | 'archived' }
Response: { conversation: Conversation }

// DELETE - Soft delete (archive) conversation
DELETE /conversations/:id
Response: { success: true }
```

### 3. Frontend Integration

#### Files to Update:

**`apps/web/pages/index.tsx`**

```typescript
// Replace local state with API calls
const [chatSessions, setChatSessions] = useState<ChatSession[]>([]);

// On mount - fetch conversations
useEffect(() => {
  if (user) {
    fetchConversations();
  }
}, [user]);

const fetchConversations = async () => {
  const token = await user.getIdToken();
  const res = await fetch(`${API_URL}/conversations`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  setChatSessions(data.conversations);
};

// Update handlers to call API
const handleNewChat = async () => {
  const token = await user.getIdToken();
  const res = await fetch(`${API_URL}/conversations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ documentId: selectedDoc?.id }),
  });
  const { id } = await res.json();
  setActiveChatId(id);
  setChatKey((prev) => prev + 1);
};

const handleDeleteChat = async (chatId: string) => {
  const token = await user.getIdToken();
  await fetch(`${API_URL}/conversations/${chatId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  setChatSessions((prev) => prev.filter((s) => s.id !== chatId));
};
```

**`apps/web/components/ChatContainer.tsx`**

```typescript
// Load messages when conversation selected
useEffect(() => {
  if (conversationId) {
    loadConversation(conversationId);
  }
}, [conversationId]);

// Save messages to backend instead of just local state
const processQuery = async (query: string) => {
  // ... existing logic ...

  // After getting response, save to backend
  await fetch(`${API_URL}/conversations/${conversationId}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      role: 'user',
      content: query,
    }),
  });

  // Save AI response
  await fetch(`${API_URL}/conversations/${conversationId}/messages`, {
    method: 'POST',
    body: JSON.stringify({
      role: 'model',
      content: aiResponse,
      citations,
    }),
  });
};
```

### 4. Firestore Security Rules

```javascript
// firestore.rules
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // Conversations - user can only access their own
    match /conversations/{conversationId} {
      allow read, write: if request.auth != null
        && request.auth.uid == resource.data.userId;
      allow create: if request.auth != null
        && request.auth.uid == request.resource.data.userId;

      // Messages subcollection
      match /messages/{messageId} {
        allow read, write: if request.auth != null
          && get(/databases/$(database)/documents/conversations/$(conversationId)).data.userId == request.auth.uid;
      }
    }
  }
}
```

---

## Testing Checklist

- [ ] Create new conversation → appears in Firestore
- [ ] Send message → saved to messages subcollection
- [ ] Page refresh → conversations persist
- [ ] Delete conversation → soft deleted (status: 'archived')
- [ ] Load conversation → messages load correctly
- [ ] Multi-device → conversations sync

---

## Dependencies

- GCP Billing enabled
- Firebase Firestore
- Firebase Auth (already implemented)

---

## Estimated Effort

| Task                   | Time           |
| ---------------------- | -------------- |
| Firestore schema setup | 30 min         |
| API endpoints          | 2-3 hours      |
| Frontend integration   | 2-3 hours      |
| Testing & debugging    | 1-2 hours      |
| **Total**              | **~6-8 hours** |

---

## Notes

- Consider adding pagination for conversations list
- May want to add search/filter functionality later
- Could add "favorite" or "pin" feature for important conversations
- Voice conversations should be saved the same way as text
