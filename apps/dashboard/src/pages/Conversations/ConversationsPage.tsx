/**
 * @CLAUDE_CONTEXT
 * Package : apps/dashboard
 * File    : src/pages/Conversations/ConversationsPage.tsx
 * Role    : Live conversation list + full chat view with message history and reply input.
 *           Left panel = conversation list (5s polling). Right panel = chat log + composer.
 * Exports : ConversationsPage
 */
import { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, aiApi } from '../../lib/api';
import type { ConvState, Conversation } from '../../lib/api';

interface Message {
  id: string;
  direction: 'inbound' | 'outbound';
  messageType: string;
  textContent: string | null;
  mediaUrl: string | null;
  createdAt: string;
}

interface ConversationDetail extends Conversation {
  messages: Message[];
}

type Filter = 'all' | 'escalated' | 'active';

const STATE_COLOR: Record<string, string> = {
  ESCALATED: 'bg-red-600/20 text-red-400 border-red-600/30',
  HARD_STOP: 'bg-red-600/20 text-red-400 border-red-600/30',
  AWAITING_PAYMENT: 'bg-yellow-600/20 text-yellow-400 border-yellow-600/30',
  CLOSED_WON: 'bg-green-600/20 text-green-400 border-green-600/30',
  CLOSED_LOST: 'bg-slate-600/20 text-slate-400 border-slate-600/30',
};

function stateColor(state: string): string {
  return STATE_COLOR[state] ?? 'bg-blue-600/20 text-blue-400 border-blue-600/30';
}

function timeAgo(s: string): string {
  const secs = Math.floor((Date.now() - new Date(s).getTime()) / 1000);
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

function formatTime(s: string): string {
  return new Date(s).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDate(s: string): string {
  const d = new Date(s);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return 'Today';
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function groupByDate(msgs: Message[]): { date: string; messages: Message[] }[] {
  const groups: { date: string; messages: Message[] }[] = [];
  let currentDate = '';
  for (const msg of msgs) {
    const date = formatDate(msg.createdAt);
    if (date !== currentDate) {
      currentDate = date;
      groups.push({ date, messages: [] });
    }
    groups[groups.length - 1].messages.push(msg);
  }
  return groups;
}

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'escalated', label: 'Escalated' },
];

export function ConversationsPage() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<Filter>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Conversation list — poll every 5s
  const { data: listData, isLoading: listLoading } = useQuery<{ items: Conversation[]; total: number }>({
    queryKey: ['conversations', filter],
    queryFn: () => api.get('/conversations', {
      params: {
        ...(filter === 'escalated' ? { state: 'ESCALATED' } : {}),
        ...(filter === 'active' ? { isActive: 'true' } : {}),
        limit: 50,
      },
    }).then(r => r.data),
    refetchInterval: 5000,
  });

  const conversations = listData?.items ?? [];

  // Conversation detail (messages) — poll every 3s when selected
  const { data: detail } = useQuery<ConversationDetail>({
    queryKey: ['conversation', selectedId],
    queryFn: () => api.get(`/conversations/${selectedId}`).then(r => r.data),
    enabled: !!selectedId,
    refetchInterval: 3000,
    retry: false,
    // If the conversation 404s (e.g. belongs to another tenant), clear selection
    onError: () => setSelectedId(null),
  });

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [detail?.messages?.length]);

  const takeover = useMutation({
    mutationFn: (id: string) => api.post(`/conversations/${id}/takeover`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['conversations'] });
      qc.invalidateQueries({ queryKey: ['conversation', selectedId] });
    },
  });

  const returnToBot = useMutation({
    mutationFn: (id: string) => api.post(`/conversations/${id}/return-to-bot`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['conversations'] });
      qc.invalidateQueries({ queryKey: ['conversation', selectedId] });
    },
  });

  const sendMessage = useMutation({
    mutationFn: ({ id, text }: { id: string; text: string }) =>
      api.post(`/conversations/${id}/send-message`, { text }),
    onSuccess: () => {
      setReplyText('');
      qc.invalidateQueries({ queryKey: ['conversation', selectedId] });
    },
  });

  const handleAiSuggest = async () => {
    if (!detail?.messages?.length || aiLoading) return;
    setAiLoading(true);
    try {
      const recent = detail.messages.slice(-10).map(m => ({
        role: m.direction === 'inbound' ? 'user' as const : 'assistant' as const,
        content: m.textContent ?? `[${m.messageType}]`,
      }));
      const res = await aiApi.suggestReply({ messages: recent });
      setReplyText(res.data.reply);
      textareaRef.current?.focus();
    } catch {
      // silently ignore — operator can still type manually
    } finally {
      setAiLoading(false);
    }
  };

  const handleSend = () => {
    if (!selectedId || !replyText.trim() || sendMessage.isPending) return;
    sendMessage.mutate({ id: selectedId, text: replyText });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const selected = conversations.find(c => c.id === selectedId) ?? null;
  const isEscalated = detail?.state === 'ESCALATED' || selected?.state === 'ESCALATED';
  const canReply = isEscalated;

  return (
    <div className="flex h-[calc(100vh-130px)] gap-4">
      {/* ─── Left panel: conversation list ─── */}
      <div className="w-72 flex-shrink-0 flex flex-col">
        <div className="mb-3">
          <h1 className="text-xl font-bold text-white">Conversations</h1>
          <p className="text-slate-400 text-xs mt-0.5">{listData?.total ?? 0} total · live</p>
        </div>

        {/* Filter tabs */}
        <div className="flex gap-1 mb-3 bg-[#1E293B] border border-[#334155] rounded-lg p-1">
          {FILTERS.map(f => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`flex-1 py-1 rounded text-xs font-medium transition-colors ${
                filter === f.key ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto space-y-1">
          {listLoading && (
            [...Array(5)].map((_, i) => (
              <div key={i} className="h-16 bg-[#1E293B] rounded-lg animate-pulse" />
            ))
          )}
          {!listLoading && conversations.length === 0 && (
            <div className="text-center py-12 text-slate-500 text-sm">No conversations found.</div>
          )}
          {conversations.map(conv => (
            <button
              key={conv.id}
              onClick={() => setSelectedId(conv.id)}
              className={`w-full text-left px-3 py-2.5 rounded-lg border transition-all ${
                selectedId === conv.id
                  ? 'bg-indigo-900/30 border-indigo-500'
                  : 'bg-[#1E293B] border-[#334155] hover:border-slate-500'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-white text-sm font-medium truncate">
                      {conv.buyer?.displayName || conv.buyer?.waPhone || 'Unknown'}
                    </span>
                    {conv.state === 'ESCALATED' && (
                      <span className="text-[10px] bg-red-600/20 text-red-400 px-1 py-0.5 rounded flex-shrink-0">
                        Human
                      </span>
                    )}
                  </div>
                  <span className={`mt-1 inline-block text-[10px] px-1.5 py-0.5 rounded border ${stateColor(conv.state)}`}>
                    {conv.state.replace(/_/g, ' ')}
                  </span>
                </div>
                <div className="text-[10px] text-slate-500 flex-shrink-0 mt-0.5">
                  {timeAgo(conv.lastMessageAt)}
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* ─── Right panel: chat view ─── */}
      <div className="flex-1 bg-[#1E293B] border border-[#334155] rounded-xl flex flex-col overflow-hidden">
        {!selectedId ? (
          <div className="flex items-center justify-center h-full text-slate-500">
            <div className="text-center">
              <div className="text-5xl mb-3">💬</div>
              <p className="text-sm">Select a conversation to view the chat</p>
            </div>
          </div>
        ) : (
          <>
            {/* Chat header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#334155] flex-shrink-0">
              <div>
                <p className="text-white font-semibold text-sm">
                  {detail?.buyer?.displayName || detail?.buyer?.waPhone || selected?.buyer?.displayName || selected?.buyer?.waPhone || '—'}
                </p>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded border ${stateColor(detail?.state ?? selected?.state ?? 'BROWSING')}`}>
                    {(detail?.state ?? selected?.state ?? '').replace(/_/g, ' ')}
                  </span>
                  {detail?.buyer?.waPhone && (
                    <span className="text-slate-500 text-[10px]">{detail.buyer.waPhone}</span>
                  )}
                </div>
              </div>
              <div className="flex gap-2">
                {!isEscalated ? (
                  <button
                    onClick={() => takeover.mutate(selectedId)}
                    disabled={takeover.isPending}
                    className="px-3 py-1.5 text-xs bg-orange-600/20 text-orange-400 hover:bg-orange-600/30 rounded-lg transition-colors disabled:opacity-50 border border-orange-600/30"
                  >
                    {takeover.isPending ? 'Taking over…' : '👤 Take Over'}
                  </button>
                ) : (
                  <button
                    onClick={() => returnToBot.mutate(selectedId)}
                    disabled={returnToBot.isPending}
                    className="px-3 py-1.5 text-xs bg-indigo-600/20 text-indigo-400 hover:bg-indigo-600/30 rounded-lg transition-colors disabled:opacity-50 border border-indigo-600/30"
                  >
                    {returnToBot.isPending ? 'Switching…' : '🤖 Return to Bot'}
                  </button>
                )}
              </div>
            </div>

            {/* Message log */}
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
              {!detail && (
                <div className="flex justify-center pt-8">
                  <div className="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                </div>
              )}
              {detail?.messages?.length === 0 && (
                <div className="text-center text-slate-500 text-sm pt-8">No messages yet.</div>
              )}
              {detail && groupByDate(detail.messages).map(group => (
                <div key={group.date}>
                  {/* Date divider */}
                  <div className="flex items-center gap-3 my-3">
                    <div className="flex-1 h-px bg-[#334155]" />
                    <span className="text-[10px] text-slate-500 flex-shrink-0">{group.date}</span>
                    <div className="flex-1 h-px bg-[#334155]" />
                  </div>

                  <div className="space-y-1.5">
                    {group.messages.map(msg => {
                      const isOut = msg.direction === 'outbound';
                      return (
                        <div key={msg.id} className={`flex ${isOut ? 'justify-end' : 'justify-start'}`}>
                          <div className={`max-w-[72%] group relative`}>
                            <div
                              className={`px-3 py-2 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap break-words ${
                                isOut
                                  ? 'bg-indigo-600 text-white rounded-br-sm'
                                  : 'bg-[#0F172A] text-slate-100 rounded-bl-sm border border-[#334155]'
                              }`}
                            >
                              {msg.textContent || (
                                <span className="italic text-slate-400 text-xs">
                                  [{msg.messageType} message]
                                </span>
                              )}
                            </div>
                            <p className={`text-[10px] text-slate-500 mt-0.5 ${isOut ? 'text-right' : 'text-left'}`}>
                              {formatTime(msg.createdAt)}
                              {isOut && <span className="ml-1">✓</span>}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>

            {/* Reply composer */}
            <div className="flex-shrink-0 border-t border-[#334155] p-3">
              {!canReply ? (
                <div className="flex items-center justify-center gap-2 py-2 text-slate-500 text-xs">
                  <span>🤖</span>
                  <span>Bot is in control — click <strong className="text-slate-400">Take Over</strong> to reply</span>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-end gap-2">
                    <textarea
                      ref={textareaRef}
                      value={replyText}
                      onChange={e => setReplyText(e.target.value)}
                      onKeyDown={handleKeyDown}
                      placeholder="Type a message… (Enter to send, Shift+Enter for new line)"
                      rows={2}
                      className="flex-1 bg-[#0F172A] border border-[#334155] rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-500 resize-none focus:outline-none focus:border-indigo-500 transition-colors"
                    />
                    <div className="flex flex-col gap-1.5">
                      <button
                        onClick={handleAiSuggest}
                        disabled={aiLoading || !detail?.messages?.length}
                        title="AI suggest reply"
                        className="flex-shrink-0 px-3 py-2 bg-violet-600/20 text-violet-400 hover:bg-violet-600/30 text-xs font-medium rounded-xl border border-violet-600/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      >
                        {aiLoading ? '…' : '✨ AI'}
                      </button>
                      <button
                        onClick={handleSend}
                        disabled={!replyText.trim() || sendMessage.isPending}
                        className="flex-shrink-0 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-xl hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      >
                        {sendMessage.isPending ? '…' : 'Send'}
                      </button>
                    </div>
                  </div>
                  {aiLoading && (
                    <p className="text-violet-400 text-xs">AI is drafting a reply…</p>
                  )}
                </div>
              )}
              {sendMessage.isError && (
                <p className="text-red-400 text-xs mt-1.5">
                  {(sendMessage.error as any)?.response?.data?.error ?? 'Failed to send message'}
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
