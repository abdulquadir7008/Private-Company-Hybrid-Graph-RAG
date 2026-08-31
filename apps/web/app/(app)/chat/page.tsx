"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch, type ApiError } from "@/lib/api";
import { useAuth, useRequireAuth } from "@/components/AuthProvider";
import ChatSidebar from "@/components/ChatSidebar";
import MessageView from "@/components/MessageView";
import { EmptyState, Alert, Spinner } from "@/components/ui";
import type { ChatMessage, ChatResponse, Conversation } from "@/lib/types";

export default function ChatPage() {
  useRequireAuth();
  const auth = useAuth();

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [suggested, setSuggested] = useState<string[]>([]);
  const [loadingConv, setLoadingConv] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const threadRef = useRef<HTMLDivElement>(null);
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
      setError((err as ApiError).message ?? "Request failed");
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
    <div className="flex h-screen">
      <ChatSidebar
        conversations={conversations}
        activeId={activeId}
        onSelect={openConversation}
        onNew={newChat}
        loading={loadingConv}
      />
      <div className="flex min-w-0 flex-1 flex-col">
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
            <div className="mx-auto max-w-3xl space-y-6">
              {messages
                .filter((m) => m.role === "user" || m.role === "assistant")
                .map((m, idx) => {
                  if (m.role === "user") {
                    const next = messages[idx + 1];
                    if (next && next.role === "assistant") return null;
                    return <MessageView key={m.id} question={m.content} answer="" />;
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
                      createdAt={m.createdAt}
                      grounded={typeof (m.retrievalMeta as { grounded?: boolean } | null)?.grounded === "boolean" ? (m.retrievalMeta as { grounded?: boolean }).grounded : undefined}
                      confidence={
                        typeof (m.retrievalMeta as { confidence?: number } | null)?.confidence === "number"
                          ? (m.retrievalMeta as { confidence?: number }).confidence
                          : null
                      }
                      entities={(m.retrievalMeta as { plan?: { detectedEntities?: string[] } } | null)?.plan?.detectedEntities}
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
                  className="rounded-full border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-slate-300 transition hover:border-indigo-500 hover:text-white"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="border-t border-slate-800 bg-ink-950 p-4">
          <div className="mx-auto max-w-3xl">
            <textarea
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
              className="w-full resize-none rounded-xl border border-slate-800 bg-ink-900 px-4 py-3 text-sm text-slate-200 outline-none placeholder:text-slate-600 focus:border-indigo-500"
            />
            <div className="mt-2 flex items-center justify-between">
              <span className="text-[11px] text-slate-600">Answers are grounded in your authorized documents.</span>
              <button
                onClick={() => void send()}
                disabled={sending || !input.trim()}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {sending ? "Working…" : "Send →"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}