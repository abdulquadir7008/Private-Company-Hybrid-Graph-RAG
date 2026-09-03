"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch, type ApiError } from "@/lib/api";
import { useAuth, useRequireAuth } from "@/components/AuthProvider";
import { useToast } from "@/components/Toast";
import ChatSidebar from "@/components/ChatSidebar";
import MessageView from "@/components/MessageView";
import { EmptyState, Alert, Spinner } from "@/components/ui";
import type { ChatMessage, ChatResponse, Conversation } from "@/lib/types";

function ChatContextPanel() {
  return (
    <aside className="hidden w-[325px] shrink-0 space-y-3 border-l border-rose-100 bg-white/45 p-4 xl:block">
      <section className="rounded-2xl border border-rose-100 bg-white/85 p-4 shadow-[0_8px_26px_rgba(190,24,93,.05)]">
        <h2 className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Answer summary</h2>
        <p className="mt-3 text-sm leading-5 text-slate-600">Answers are grounded in the connected knowledge graph and your authorized documents.</p>
        <h3 className="mt-3 text-xs font-semibold text-slate-800">Top departments</h3>
        <div className="mt-2 space-y-1.5 text-[11px]"><ContextRow label="Engineering" value="14 people" tone="violet"/><ContextRow label="Human Resources" value="7 people" tone="rose"/><ContextRow label="IT Operations" value="6 people" tone="amber"/><ContextRow label="Finance" value="5 people" tone="green"/></div>
      </section>
      <section className="rounded-2xl border border-rose-100 bg-white/85 p-4 shadow-[0_8px_26px_rgba(190,24,93,.05)]">
        <h2 className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Knowledge graph preview</h2>
        <div className="relative mx-auto mt-3 h-48 max-w-[255px] overflow-hidden rounded-xl bg-[radial-gradient(circle_at_center,rgba(244,63,117,.12),transparent_37%)]">
          <svg viewBox="0 0 255 190" className="absolute inset-0 h-full w-full" fill="none" stroke="#e9d5ff" strokeWidth="1.2"><path d="M39 55 128 27l89 28m-178 0 41 93 96 18 41-111M80 148l48-121 48 139" strokeDasharray="3 3"/></svg>
          <span className="absolute left-1/2 top-20 flex h-16 w-16 -translate-x-1/2 items-center justify-center rounded-full bg-gradient-to-br from-rose-500 to-pink-600 text-center text-[10px] font-semibold text-white shadow-lg shadow-rose-200">Remote<br/>Work Policy</span>
          <span className="absolute left-[8px] top-[63px] rounded-full bg-emerald-50 px-2 py-1 text-[9px] text-emerald-600 ring-1 ring-emerald-200">Finance<br/>5 people</span><span className="absolute right-[1px] top-[64px] rounded-full bg-orange-50 px-2 py-1 text-[9px] text-orange-600 ring-1 ring-orange-200">IT Operations<br/>6 people</span><span className="absolute left-[90px] top-[2px] rounded-full bg-violet-50 px-2 py-1 text-[9px] text-violet-600 ring-1 ring-violet-200">Engineering<br/>14 people</span><span className="absolute left-[96px] bottom-[3px] rounded-full bg-rose-50 px-2 py-1 text-[9px] text-rose-600 ring-1 ring-rose-200">Human Resources<br/>7 people</span>
        </div>
        <button className="mt-2 w-full rounded-lg border border-rose-200 py-1.5 text-xs font-medium text-rose-500">⌘ Open in Graph Explorer</button>
      </section>
      <section className="rounded-2xl border border-rose-100 bg-white/85 p-4 shadow-[0_8px_26px_rgba(190,24,93,.05)]"><h2 className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Top sources</h2><div className="mt-3 space-y-3 text-xs text-slate-600"><p>▧ <span className="font-medium text-slate-800">Remote Work Policy</span><br/><span className="ml-4 text-[10px] text-slate-400">Policy Document · Updated recently</span></p><p>▧ <span className="font-medium text-slate-800">HR Policies Handbook</span><br/><span className="ml-4 text-[10px] text-slate-400">Document · Authorized source</span></p><p>▧ <span className="font-medium text-slate-800">Employee Guidelines</span><br/><span className="ml-4 text-[10px] text-slate-400">Document · Authorized source</span></p></div><button className="mt-3 text-xs font-medium text-rose-500">View all sources →</button></section>
    </aside>
  );
}

function ContextRow({ label, value, tone }: { label: string; value: string; tone: "violet" | "rose" | "amber" | "green" }) {
  const tones = { violet: "bg-violet-50 text-violet-600", rose: "bg-rose-50 text-rose-600", amber: "bg-amber-50 text-amber-600", green: "bg-emerald-50 text-emerald-600" };
  return <div className="flex items-center justify-between"><span className={`rounded-md px-2 py-1 ${tones[tone]}`}>{label}</span><span className="rounded-full border border-slate-100 px-2 py-0.5 text-slate-500">{value}</span></div>;
}

export default function ChatPage() {
  useRequireAuth();
  const auth = useAuth();
  const { toast } = useToast();

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [suggested, setSuggested] = useState<string[]>([]);
  const [loadingConv, setLoadingConv] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const loadingRef = useRef(false);

  const loadConversations = useCallback(async () => {
    try {
      const list = await apiFetch<Conversation[]>("/chat/conversations", { token: auth.token });
      setConversations(list);
      if (list.length > 0 && !activeId) {
        setActiveId(list[0].id);
        setLoadingConv(true);
        const full = await apiFetch<Conversation>(`/chat/conversations/${list[0].id}`, { token: auth.token });
        setMessages(full.messages ?? []);
        setLoadingConv(false);
      } else {
        setLoadingConv(false);
      }
    } catch (err) {
      setError((err as Error).message);
      setLoadingConv(false);
    }
  }, [auth.token, activeId]);

  useEffect(() => {
    if (!auth.token) return;
    void loadConversations();
    apiFetch<string[]>("/chat/suggested", { token: auth.token })
      .then(setSuggested)
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.token]);

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, sending]);

  async function openConversation(id: string) {
    setActiveId(id);
    setLoadingConv(true);
    try {
      const full = await apiFetch<Conversation>(`/chat/conversations/${id}`, { token: auth.token });
      setMessages(full.messages ?? []);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoadingConv(false);
    }
  }

  function newChat() {
    setActiveId(null);
    setMessages([]);
    setError(null);
    setInput("");
  }

  async function deleteConversation(id: string) {
    const conversation = conversations.find((item) => item.id === id);
    if (!window.confirm(`Delete “${conversation?.title || "this conversation"}”? This cannot be undone.`)) return;
    try {
      await apiFetch(`/chat/conversations/${id}`, { method: "DELETE", token: auth.token });
      const remaining = conversations.filter((item) => item.id !== id);
      setConversations(remaining);
      if (activeId === id) {
        newChat();
        if (remaining[0]) await openConversation(remaining[0].id);
      }
    } catch (err) {
      toast({ type: "error", message: (err as ApiError).message ?? "Could not delete conversation" });
    }
  }

  function editQuestion(question: string) {
    setInput(question);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  async function send(text?: string) {
    const q = (text ?? input).trim();
    if (!q || sending || loadingRef.current) return;
    setInput("");
    setError(null);
    setSending(true);
    loadingRef.current = true;
    try {
      const res = await apiFetch<ChatResponse>("/chat", {
        method: "POST",
        token: auth.token,
        body: { question: q, conversationId: activeId ?? undefined }
      });
      setActiveId(res.conversationId);
      setMessages((prev) => [
        ...prev,
        { id: res.messageId + "-q", role: "user", content: q },
        {
          id: res.messageId,
          role: "assistant",
          content: res.answer,
          citations: res.sources,
          graphEvidence: { relationships: res.graphEvidence, paths: res.paths },
          retrievalMeta: { grounded: res.grounded, confidence: res.confidence },
          explanation: res.explanation ?? null,
          explanationId: res.explanationId ?? null,
          createdAt: new Date().toISOString()
        }
      ]);
      setConversations((prev) => {
        const exists = prev.some((c) => c.id === res.conversationId);
        const updated: Conversation = {
          id: res.conversationId,
          title: q.slice(0, 60),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        return exists ? prev : [updated, ...prev];
      });
    } catch (err) {
      setInput(q);
      toast({ type: "error", message: (err as ApiError).message ?? "Request failed" });
    } finally {
      setSending(false);
      loadingRef.current = false;
    }
  }

  async function askSuggested(q: string) {
    await send(q);
  }

  if (!auth.token) return null;

  return (
    <div className="chat-workspace flex h-full bg-[#fffaf9]">
      <ChatSidebar
        conversations={conversations}
        activeId={activeId}
        onSelect={openConversation}
        onDelete={(id) => void deleteConversation(id)}
        onNew={newChat}
        loading={loadingConv}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between border-b border-rose-100 bg-white/65 px-6 py-4"><div className="text-sm"><span className="font-semibold text-slate-900">Chat</span><span className="mx-2 text-slate-400">/</span><span className="text-slate-500">Authorized knowledge graph</span></div><div className="hidden gap-2 sm:flex"><span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-[11px] font-medium text-emerald-600">● ACL Enforced</span><span className="rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-[11px] font-medium text-violet-600">✣ Explainable RAG</span><span className="rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-[11px] font-medium text-rose-600">⌘ Graph RAG</span></div></div>
        <div ref={threadRef} className="flex-1 overflow-y-auto px-6 py-6">
          {error && (
            <div className="mb-4">
              <Alert tone="rose">{error}</Alert>
            </div>
          )}
          {loadingConv ? (
            <Spinner label="Loading conversation…" />
          ) : messages.length === 0 ? (
            <EmptyState
              icon="💬"
              title="Ask about your company"
              hint="Questions are answered from your private knowledge graph with grounded citations — try one of the suggestions below."
            />
          ) : (
            <div className="mx-auto max-w-4xl space-y-6">
              {messages
                .filter((m) => m.role === "user" || m.role === "assistant")
                .map((m, idx) => {
                  if (m.role === "user") {
                    const next = messages[idx + 1];
                    if (next && next.role === "assistant") return null;
                    return <MessageView key={m.id} question={m.content} answer="" onEditQuestion={editQuestion} />;
                  }
                  const prev = messages[idx - 1];
                  return (
                    <MessageView
                      key={m.id}
                      question={prev?.role === "user" ? prev.content : "…"}
                      answer={m.content}
                      citations={m.citations}
                      graphEvidence={m.graphEvidence}
                      messageId={m.id}
                      token={auth.token}
                      createdAt={m.createdAt}
                      explanation={m.explanation ?? null}
                      explanationId={m.explanationId ?? null}
                      grounded={typeof (m.retrievalMeta as { grounded?: boolean } | null)?.grounded === "boolean" ? (m.retrievalMeta as { grounded?: boolean }).grounded : undefined}
                      confidence={
                        typeof (m.retrievalMeta as { confidence?: number } | null)?.confidence === "number"
                          ? (m.retrievalMeta as { confidence?: number }).confidence
                          : null
                      }
                      entities={(m.retrievalMeta as { plan?: { detectedEntities?: string[] } } | null)?.plan?.detectedEntities}
                      onEditQuestion={editQuestion}
                    />
                  );
                })}
            </div>
          )}
          {sending && (
            <div className="mx-auto mt-6 max-w-3xl">
              <Spinner label="Searching graph and generating grounded answer…" />
            </div>
          )}
        </div>

        {messages.length === 0 && suggested.length > 0 && !sending && (
          <div className="mx-auto max-w-3xl px-6 pb-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs uppercase tracking-wide text-slate-600">Try:</span>
                  {suggested.map((s) => (
                    <button
                      key={s}
                      onClick={() => void askSuggested(s)}
                      className="rounded-full border border-white/10 bg-base-900/70 px-3 py-1.5 text-xs text-slate-300 transition hover:border-indigo-500 hover:text-white"
                    >
                      {s}
                    </button>
                  ))}
            </div>
          </div>
        )}

        <div className="border-t border-rose-100 bg-white/70 p-4 backdrop-blur-md">
          <div className="mx-auto max-w-4xl">
            <div className="flex items-end gap-2 rounded-xl border border-rose-200 bg-white px-4 py-3 shadow-[0_8px_24px_rgba(244,63,117,.08)] transition focus-within:border-brand">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
                rows={2}
                placeholder="Ask about people, policies, projects… (Enter to send, Shift+Enter for newline)"
                className="w-full resize-none bg-transparent px-1 py-1.5 text-sm text-slate-200 outline-none placeholder:text-slate-600"
              />
              <button
                onClick={() => void send()}
                disabled={sending || !input.trim()}
                className="mb-0.5 rounded-lg bg-gradient-to-b from-pink-500 to-rose-500 px-4 py-2 text-sm font-medium text-white shadow-lg shadow-rose-200 transition hover:from-pink-400 hover:to-rose-400 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {sending ? "Working…" : "Send"}
              </button>
            </div>
            <div className="mt-2 flex items-center justify-between">
              <span className="text-[11px] text-slate-600">Answers are grounded in your authorized documents.</span>
            </div>
          </div>
        </div>
      </div>
      <ChatContextPanel />
    </div>
  );
}
