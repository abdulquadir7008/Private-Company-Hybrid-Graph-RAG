"use client";

import type { Conversation } from "@/lib/types";
import { formatDate } from "@/components/ui";

export default function ChatSidebar({
  conversations,
  activeId,
  onSelect,
  onNew,
  loading
}: {
  conversations: Conversation[];
  activeId?: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  loading?: boolean;
}) {
  return (
    <div className="flex w-72 shrink-0 flex-col border-r border-slate-800 bg-ink-950">
      <div className="p-3">
        <button
          onClick={onNew}
          className="w-full rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-indigo-500"
        >
          + New chat
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-3">
        {loading && <div className="px-3 py-2 text-xs text-slate-500">Loading conversations…</div>}
        {!loading && conversations.length === 0 && (
          <div className="px-3 py-2 text-xs text-slate-500">No conversations yet.</div>
        )}
        {conversations.map((c) => (
          <button
            key={c.id}
            onClick={() => onSelect(c.id)}
            className={`mb-1 block w-full rounded-lg px-3 py-2 text-left transition ${
              c.id === activeId ? "bg-slate-800 text-slate-100" : "text-slate-400 hover:bg-slate-900 hover:text-slate-200"
            }`}
          >
            <div className="truncate text-sm font-medium">{c.title || "New conversation"}</div>
            <div className="mt-0.5 text-[11px] text-slate-600">{formatDate(c.updatedAt)}</div>
          </button>
        ))}
      </div>
    </div>
  );
}