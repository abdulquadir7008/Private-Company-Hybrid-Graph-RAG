"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { useAuth, useRequireAuth } from "@/components/AuthProvider";
import { EmptyState, Input, PageHeader, Spinner } from "@/components/ui";
import type { GraphNode } from "@/lib/types";

export default function EntitiesPage() {
  useRequireAuth();
  const auth = useAuth(); const [query, setQuery] = useState(""); const [items, setItems] = useState<GraphNode[]>([]); const [loading, setLoading] = useState(true);
  useEffect(() => { setLoading(true); const timer = setTimeout(() => apiFetch<{ items: GraphNode[] }>(`/graph/entities?query=${encodeURIComponent(query)}`, { token: auth.token }).then((data) => setItems(data.items)).catch(() => setItems([])).finally(() => setLoading(false)), 200); return () => clearTimeout(timer); }, [auth.token, query]);
  return <div className="mx-auto max-w-6xl px-6 py-8"><PageHeader title="Entities" subtitle="Browse the people, policies, departments, and concepts in your authorized graph."/><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search entities…" className="mb-6 max-w-xl"/>{loading ? <Spinner label="Loading entities…"/> : items.length === 0 ? <EmptyState icon="⬡" title="No entities found" hint="Try a different search term."/> : <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{items.map((item) => <div key={item.id} className="rounded-xl border border-rose-100 bg-white p-4 shadow-sm"><div className="flex items-center gap-2"><span className="flex h-9 w-9 items-center justify-center rounded-full bg-violet-50 text-violet-600">⬡</span><div className="min-w-0"><div className="truncate font-medium text-slate-900">{item.name}</div><div className="text-xs text-rose-500">{item.type}</div></div></div>{item.description && <p className="mt-3 line-clamp-2 text-sm text-slate-600">{item.description}</p>}</div>)}</div>}</div>;
}
