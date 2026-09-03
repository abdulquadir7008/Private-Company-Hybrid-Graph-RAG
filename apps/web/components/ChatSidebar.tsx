"use client";

import { useState } from "react";
import Link from "next/link";
import type { Conversation } from "@/lib/types";
import { formatDate } from "@/components/ui";

const nav = [
  ["/chat", "Chat"], ["/documents", "Documents"], ["/graph", "Graph Explorer"], ["/entities", "Entities"], ["/analytics", "Analytics"], ["/audit-logs", "Audit Logs"]
] as const;

function NavIcon({ label }: { label: string }) {
  const cls = "h-[18px] w-[18px] shrink-0";
  if (label === "Chat") return <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>;
  if (label === "Documents") return <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6M9 13h6M9 17h6" /></svg>;
  if (label === "Graph Explorer") return <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="6" cy="6" r="2.4" /><circle cx="18" cy="6" r="2.4" /><circle cx="12" cy="18" r="2.4" /><path d="M8.2 6.9l5.6 8.2M15.8 6.9l-5.6 8.2M8.2 6h.2M15.8 6h.2" /></svg>;
  if (label === "Entities") return <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m12 3 7 4v10l-7 4-7-4V7zM5 7l7 4 7-4m-7 4v10" /></svg>;
  if (label === "Analytics") return <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 20V10m5 10V4m5 16v-7m5 7V7" /><path d="M2 20h20" /></svg>;
  if (label === "Audit Logs") return <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><path d="M9 12h6m-6 3h4" /></svg>;
  return <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>;
}

export default function ChatSidebar({ conversations, activeId, onSelect, onDelete, onNew, loading }: { conversations: Conversation[]; activeId?: string | null; onSelect: (id: string) => void; onDelete: (id: string) => void; onNew: () => void; loading?: boolean }) {
  const [collapsed, setCollapsed] = useState(false);
  return <aside className={`hidden shrink-0 flex-col border-r border-rose-100 bg-white/75 py-6 backdrop-blur-md transition-all duration-200 xl:flex ${collapsed ? "w-[76px] px-3" : "w-[320px] px-4"}`}>
    <button onClick={() => setCollapsed((value) => !value)} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} className="mb-5 flex h-9 items-center justify-center rounded-lg border border-rose-100 bg-white text-slate-500 hover:text-rose-500">{collapsed ? "›" : "‹"}</button>
    <button onClick={onNew} title="New chat" className={`flex items-center rounded-lg bg-gradient-to-r from-rose-500 to-pink-600 text-sm font-medium text-white shadow-lg shadow-rose-200 ${collapsed ? "h-11 justify-center" : "gap-3 px-4 py-3"}`}><span>＋</span>{!collapsed && <>New Chat <span className="ml-auto text-[10px] opacity-75">⌘ N</span></>}</button>
    <nav className="mt-6 space-y-1">{nav.map(([href, label]) => <Link key={label} href={href} title={collapsed ? label : undefined} className={`flex items-center rounded-lg py-2.5 text-sm ${collapsed ? "justify-center" : "gap-3 px-3"} ${label === "Chat" ? "bg-rose-100/80 text-rose-600" : "text-slate-600 hover:bg-rose-50"}`}><NavIcon label={label}/>{!collapsed && label}</Link>)}</nav>
    {!collapsed && <div className="mt-5 border-t border-rose-100 pt-5"><div className="mb-2 flex items-center justify-between px-2 text-[10px] font-bold uppercase tracking-wide text-slate-500">Recent conversations <span className="normal-case font-medium text-rose-500">View all</span></div><div className="max-h-[290px] space-y-1 overflow-y-auto">{loading && <div className="px-3 py-2 text-xs text-slate-500">Loading conversations…</div>}{!loading && conversations.length === 0 && <div className="px-3 py-2 text-xs text-slate-500">No conversations yet.</div>}{conversations.map((c) => <div key={c.id} className={`group flex items-center rounded-lg ${c.id === activeId ? "border border-rose-200 bg-rose-50" : "hover:bg-rose-50"}`}><button onClick={() => onSelect(c.id)} className="min-w-0 flex-1 px-3 py-2 text-left"><div className={`truncate text-xs font-medium ${c.id === activeId ? "text-rose-600" : "text-slate-700"}`}>▱　{c.title || "New conversation"}</div><div className="ml-5 mt-0.5 text-[10px] text-slate-400">{formatDate(c.updatedAt)}</div></button><button aria-label={`Delete ${c.title || "conversation"}`} onClick={() => onDelete(c.id)} className="mr-2 rounded p-1 text-slate-400 opacity-0 transition hover:bg-rose-100 hover:text-rose-600 group-hover:opacity-100"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5"/></svg></button></div>)}</div></div>}
  </aside>;
}
