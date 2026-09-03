"use client";

import type { Conversation } from "@/lib/types";
import { formatDate } from "@/components/ui";

export default function ChatSidebar({
  conversations,
  activeId,
  onSelect,
  onDelete,
  onNew,
  loading
}: {
  conversations: Conversation[];
  activeId?: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onNew: () => void;
  loading?: boolean;
}) {
  return (
    <div className="flex w-72 shrink-0 flex-col border-r border-white/8 bg-base-900/70 backdrop-blur-md">
      <div className="p-3">
        <button
          onClick={onNew}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-b from-pink-500 to-rose-500 px-3 py-2 text-sm font-medium text-white shadow-lg shadow-rose-200 transition hover:from-pink-400 hover:to-rose-400 active:scale-[0.98]"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
          New chat
        </button>
      </div>
      <div className="flex items-center justify-between px-4 pb-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">Conversations</span>
        {!loading && conversations.length > 0 && <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-medium text-rose-500">{conversations.length}</span>}
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-3">
        {loading && <div className="px-3 py-2 text-xs text-slate-500">Loading conversations…</div>}
        {!loading && conversations.length === 0 && (
          <div className="px-3 py-2 text-xs text-slate-500">No conversations yet.</div>
        )}
        {conversations.map((c) => (
          <div
            key={c.id}
            className={`group mb-1 flex w-full items-center gap-1 rounded-lg pr-1 transition ${
              c.id === activeId
                ? "bg-gradient-to-r from-rose-100 to-pink-50 text-rose-600 ring-1 ring-inset ring-rose-200"
                : "text-slate-500 hover:bg-rose-50 hover:text-rose-600"
            }`}
          >
            <button onClick={() => onSelect(c.id)} className="min-w-0 flex-1 px-3 py-2 text-left">
              <div className="truncate text-sm font-medium">{c.title || "New conversation"}</div>
              <div className="mt-0.5 text-[11px] text-slate-600">{formatDate(c.updatedAt)}</div>
            </button>
            <button
              onClick={() => onDelete(c.id)}
              aria-label={`Delete ${c.title || "conversation"}`}
              title="Delete conversation"
              className="mr-1 rounded-md p-1.5 text-slate-400 opacity-0 transition hover:bg-rose-100 hover:text-rose-600 focus:opacity-100 group-hover:opacity-100"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v5M14 11v5" />
              </svg>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
