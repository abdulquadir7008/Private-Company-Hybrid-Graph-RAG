"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/components/AuthProvider";
import type { DocumentSummary, GraphNode, Conversation, AuditEntry } from "@/lib/types";

interface SearchResult {
  kind: "document" | "entity" | "conversation" | "audit";
  title: string;
  subtitle: string;
  href: string;
  icon: string;
}

export default function SearchModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const auth = useAuth();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setResults([]);
      return;
    }
    const t = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open || query.trim().length < 2 || !auth.token) {
      setResults([]);
      return;
    }
    setLoading(true);
    setSelected(0);
    const timer = setTimeout(async () => {
      const out: SearchResult[] = [];
      try {
        const [docs, entities, conversations, audit] = await Promise.all([
          apiFetch<{ items: DocumentSummary[] }>(`/documents?pageSize=10`, { token: auth.token }).catch(() => ({ items: [] as DocumentSummary[] })),
          apiFetch<{ items: GraphNode[] }>(`/graph/entities?query=${encodeURIComponent(query)}&limit=10`, { token: auth.token }).catch(() => ({ items: [] as GraphNode[] })),
          apiFetch<Conversation[]>(`/chat/conversations`, { token: auth.token }).catch(() => [] as Conversation[]),
          apiFetch<{ items: AuditEntry[] }>(`/admin/audit?limit=10`, { token: auth.token }).catch(() => ({ items: [] as AuditEntry[] })),
        ]);
        const q = query.toLowerCase();
        docs.items.forEach((d) => {
          if (d.title.toLowerCase().includes(q)) out.push({ kind: "document", title: d.title, subtitle: `${d.category} · ${d.status}`, href: "/documents", icon: "📄" });
        });
        entities.items.forEach((e) => {
          if (e.name.toLowerCase().includes(q)) out.push({ kind: "entity", title: e.name, subtitle: e.type + (e.description ? ` · ${e.description.slice(0, 40)}` : ""), href: `/entities`, icon: "⬡" });
        });
        conversations.forEach((c) => {
          if (c.title.toLowerCase().includes(q)) out.push({ kind: "conversation", title: c.title, subtitle: "Conversation", href: "/chat", icon: "💬" });
        });
        audit.items.forEach((a) => {
          const detail = typeof a.detail === "string" ? a.detail : JSON.stringify(a.detail ?? "");
          if (a.action.toLowerCase().includes(q)) out.push({ kind: "audit", title: a.action, subtitle: detail.slice(0, 60), href: "/audit-logs", icon: "◉" });
        });
      } catch {
        // ignore fetch errors
      }
      setResults(out);
      setLoading(false);
    }, 200);
    return () => clearTimeout(timer);
  }, [query, open, auth.token]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelected((s) => Math.min(results.length - 1, s + 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelected((s) => Math.max(0, s - 1));
      } else if (e.key === "Enter" && results[selected]) {
        e.preventDefault();
        onClose();
        window.location.href = results[selected].href;
      } else if (e.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, results, selected, onClose]);

  useEffect(() => {
    resultsRef.current?.querySelector(`[data-index="${selected}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[90] flex items-start justify-center bg-slate-900/50 p-4 pt-[15vh] backdrop-blur-sm" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="w-full max-w-xl overflow-hidden rounded-2xl border border-rose-100 bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 border-b border-rose-100 px-4 py-3">
          <span className="text-lg text-slate-600">⌕</span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search documents, entities, conversations, audit logs..."
            className="flex-1 bg-transparent text-sm text-slate-800 outline-none placeholder:text-slate-400"
            aria-label="Global search"
          />
          <button onClick={onClose} className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">ESC</button>
        </div>
        <div ref={resultsRef} className="max-h-[50vh] overflow-y-auto p-2">
          {loading && <div className="px-3 py-4 text-center text-sm text-slate-500">Searching…</div>}
          {!loading && query.trim().length < 2 && <div className="px-3 py-4 text-center text-sm text-slate-400">Type at least 2 characters to search across documents, entities, conversations, and audit logs.</div>}
          {!loading && query.trim().length >= 2 && results.length === 0 && <div className="px-3 py-4 text-center text-sm text-slate-400">No results found for “{query}”</div>}
          {results.map((r, i) => (
            <Link
              key={`${r.kind}-${r.title}-${i}`}
              href={r.href}
              data-index={i}
              onClick={() => onClose()}
              onMouseEnter={() => setSelected(i)}
              className={`flex items-start gap-3 rounded-lg px-3 py-2.5 transition ${i === selected ? "bg-rose-50" : ""}`}
            >
              <span className="mt-0.5 text-base text-slate-500">{r.icon}</span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-slate-800">{r.title}</div>
                <div className="truncate text-xs text-slate-500">{r.subtitle}</div>
              </div>
              <span className={`mt-1 rounded px-1.5 py-0.5 text-[10px] font-medium ${r.kind === "document" ? "bg-rose-50 text-rose-600" : r.kind === "entity" ? "bg-violet-50 text-violet-600" : r.kind === "audit" ? "bg-amber-50 text-amber-600" : "bg-sky-50 text-sky-600"}`}>{r.kind}</span>
            </Link>
          ))}
        </div>
        {!loading && results.length > 0 && (
          <div className="border-t border-rose-100 px-4 py-2 text-[10px] text-slate-400">
            <span className="font-medium text-slate-500">↑↓</span> navigate · <span className="font-medium text-slate-500">↵</span> open · <span className="font-medium text-slate-500">esc</span> close
          </div>
        )}
      </div>
    </div>
  );
}