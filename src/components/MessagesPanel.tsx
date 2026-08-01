import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ApiRequestError,
  getConversations,
  getMessagesWith,
  markConversationRead,
  sendMessage,
} from '@/auth/client';
import type { AuthAccount, DirectConversation, DirectMessage } from '@/auth/types';
import { UserErrorPage } from '@/components/UserErrorPage';
import type { UserErrorKind } from '@/components/UserErrorPage';

interface MessagesPanelProps {
  account: AuthAccount;
}

function formatTime(ts: number): string {
  const now = Date.now();
  const diff = now - ts;
  if (diff < 60_000) return 'just now';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) {
    return new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit' }).format(new Date(ts));
  }
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(ts));
}

export function MessagesPanel({ account }: MessagesPanelProps) {
  const [conversations, setConversations] = useState<DirectConversation[]>([]);
  const [activePartnerId, setActivePartnerId] = useState<number | null>(null);
  const [activePartnerName, setActivePartnerName] = useState('');
  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');
  const [convsLoading, setConvsLoading] = useState(true);
  const [msgsLoading, setMsgsLoading] = useState(false);
  // New chat state
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [newChatInput, setNewChatInput] = useState('');
  const [newChatError, setNewChatError] = useState('');
  const [fatalError, setFatalError] = useState<UserErrorKind | null>(null);

  const bubblesRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const newChatRef = useRef<HTMLInputElement>(null);

  const loadConversations = useCallback(async () => {
    try {
      setConversations(await getConversations());
      setFatalError(null);
    } catch (error) {
      setFatalError(error instanceof ApiRequestError && error.status === 401
        ? 'sessionExpired'
        : 'serviceUnavailable');
    } finally {
      setConvsLoading(false);
    }
  }, []);

  useEffect(() => { void loadConversations(); }, [loadConversations]);

  const loadMessages = useCallback(async (partnerId: number) => {
    setMsgsLoading(true);
    try {
      const msgs = await getMessagesWith(partnerId);
      setFatalError(null);
      setMessages(msgs);
      await markConversationRead(partnerId);
      setConversations((prev) =>
        prev.map((c) => (c.partnerId === partnerId ? { ...c, unreadCount: 0 } : c)),
      );
    } catch (error) {
      setFatalError(error instanceof ApiRequestError && error.status === 401
        ? 'sessionExpired'
        : 'serviceUnavailable');
    } finally {
      setMsgsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activePartnerId === null || activePartnerId < 0) return;
    void loadMessages(activePartnerId);
  }, [activePartnerId, loadMessages]);

  // Scroll to bottom when messages change
  useEffect(() => {
    if (bubblesRef.current) {
      bubblesRef.current.scrollTop = bubblesRef.current.scrollHeight;
    }
  }, [messages]);

  // Poll active conversation every 5s
  useEffect(() => {
    if (activePartnerId === null || activePartnerId < 0) return;
    const id = setInterval(() => {
      void loadMessages(activePartnerId);
      void loadConversations();
    }, 5000);
    return () => clearInterval(id);
  }, [activePartnerId, loadMessages, loadConversations]);

  const openConversation = (partnerId: number, partnerUsername: string) => {
    setActivePartnerId(partnerId);
    setActivePartnerName(partnerUsername);
    setInputText('');
    setSendError('');
    setNewChatOpen(false);
    setNewChatInput('');
    setNewChatError('');
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const openNewChatPanel = () => {
    setNewChatOpen(true);
    setNewChatInput('');
    setNewChatError('');
    setTimeout(() => newChatRef.current?.focus(), 50);
  };

  const handleStartChat = (e: React.FormEvent) => {
    e.preventDefault();
    const username = newChatInput.trim();
    if (!username) return;
    if (username.toLowerCase() === account.username.toLowerCase()) {
      setNewChatError('Cannot message yourself.');
      return;
    }
    // If conversation already exists, open it
    const existing = conversations.find(
      (c) => c.partnerUsername.toLowerCase() === username.toLowerCase(),
    );
    if (existing) {
      openConversation(existing.partnerId, existing.partnerUsername);
      return;
    }
    // New chat — open empty thread; username will be validated on first send
    setActivePartnerId(-1);
    setActivePartnerName(username);
    setMessages([]);
    setInputText('');
    setSendError('');
    setNewChatOpen(false);
    setNewChatInput('');
    setNewChatError('');
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const handleSend = async () => {
    const text = inputText.trim();
    if (!text || !activePartnerName || sending) return;
    setSending(true);
    setSendError('');
    try {
      const msg = await sendMessage(activePartnerName, text);
      setMessages((prev) => [...prev, msg]);
      setInputText('');
      // Resolve the real partner ID if this was a new chat
      if (activePartnerId === -1) {
        setActivePartnerId(msg.recipientId);
      }
      // Refresh conversations
      void loadConversations();
    } catch (err) {
      setSendError(err instanceof Error ? err.message : 'Failed to send');
    } finally {
      setSending(false);
    }
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  const hasThread = activePartnerId !== null;

  if (fatalError) {
    return (
      <UserErrorPage
        kind={fatalError}
        variant="compact"
        title={fatalError === 'sessionExpired' ? undefined : 'Messages unavailable'}
        message={fatalError === 'sessionExpired'
          ? undefined
          : 'Messages cannot be loaded right now. Please try again shortly.'}
        primaryLabel={fatalError === 'sessionExpired' ? 'Sign In' : 'Try Again'}
        onPrimary={() => {
          if (fatalError === 'sessionExpired') {
            window.location.assign('/');
            return;
          }
          setFatalError(null);
          void loadConversations();
          if (activePartnerId !== null && activePartnerId >= 0) void loadMessages(activePartnerId);
        }}
      />
    );
  }

  return (
    <div className="home-messages-view">
      {/* ── Sidebar ── */}
      <aside className="home-messages-sidebar">
        <div className="home-messages-sidebar-header">
          <span className="home-messages-sidebar-title">Messages</span>
          <button
            type="button"
            className="home-messages-new-btn"
            onClick={openNewChatPanel}
            title="New message"
          >
            +
          </button>
        </div>

        {newChatOpen && (
          <form className="home-messages-new-form" onSubmit={handleStartChat}>
            <input
              ref={newChatRef}
              className="home-messages-new-input"
              placeholder="Enter username…"
              value={newChatInput}
              onChange={(e) => { setNewChatInput(e.target.value); setNewChatError(''); }}
              autoComplete="off"
              spellCheck={false}
            />
            {newChatError && <div className="home-messages-new-error">{newChatError}</div>}
            <div className="home-messages-new-actions">
              <button type="submit" className="home-messages-new-confirm">Open Chat</button>
              <button type="button" className="home-messages-new-cancel" onClick={() => setNewChatOpen(false)}>Cancel</button>
            </div>
          </form>
        )}

        <div className="home-messages-conv-list">
          {convsLoading && (
            <div className="home-messages-empty">Loading…</div>
          )}
          {!convsLoading && conversations.length === 0 && !newChatOpen && (
            <div className="home-messages-empty">
              No messages yet.<br />Click + to start a conversation.
            </div>
          )}
          {conversations.map((conv) => (
            <button
              key={conv.partnerId}
              type="button"
              className={`home-messages-conv-item ${activePartnerId === conv.partnerId ? 'is-active' : ''}`}
              onClick={() => openConversation(conv.partnerId, conv.partnerUsername)}
            >
              <div className="home-messages-conv-row">
                <span className="home-messages-conv-name">{conv.partnerUsername}</span>
                <span className="home-messages-conv-time">{formatTime(conv.lastMessage.sentAt)}</span>
                {conv.unreadCount > 0 && (
                  <span className="home-messages-unread">{conv.unreadCount}</span>
                )}
              </div>
              <div className="home-messages-conv-preview">
                {conv.lastMessage.senderId === account.id ? 'You: ' : ''}
                {conv.lastMessage.body}
              </div>
            </button>
          ))}
        </div>
      </aside>

      {/* ── Thread ── */}
      <div className="home-messages-thread">
        {!hasThread ? (
          <div className="home-messages-placeholder">
            <div className="home-messages-placeholder-icon">✉</div>
            <div className="home-messages-placeholder-text">Select a conversation or start a new one</div>
          </div>
        ) : (
          <>
            <div className="home-messages-thread-header">
              <span className="home-messages-thread-name">{activePartnerName}</span>
            </div>

            <div className="home-messages-bubbles" ref={bubblesRef}>
              {msgsLoading && <div className="home-messages-loading">Loading…</div>}
              {!msgsLoading && messages.length === 0 && (
                <div className="home-messages-no-msgs">No messages yet. Say hello!</div>
              )}
              {messages.map((msg) => {
                const mine = msg.senderId === account.id;
                return (
                  <div key={msg.id} className={`home-messages-bubble-wrap ${mine ? 'is-mine' : 'is-theirs'}`}>
                    <div className={`home-messages-bubble ${mine ? 'is-mine' : 'is-theirs'}`}>
                      <div className="home-messages-bubble-body">{msg.body}</div>
                      <div className="home-messages-bubble-time">{formatTime(msg.sentAt)}</div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="home-messages-input-bar">
              <textarea
                ref={inputRef}
                className="home-messages-input"
                placeholder={`Message ${activePartnerName}…`}
                value={inputText}
                rows={1}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={handleInputKeyDown}
                disabled={sending}
              />
              <button
                type="button"
                className="home-messages-send-btn"
                onClick={() => void handleSend()}
                disabled={!inputText.trim() || sending}
              >
                {sending ? '…' : 'Send'}
              </button>
            </div>
            {sendError && <div className="home-messages-send-error">{sendError}</div>}
          </>
        )}
      </div>
    </div>
  );
}
