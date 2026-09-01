"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { useAuth, useRequireAuth } from "@/components/AuthProvider";
import GraphCanvas, { type CanvasEdge, type CanvasNode } from "@/components/GraphCanvas";
import type { EntityDetail, GraphRelationship, GraphStats, QueryPlan } from "@/lib/types";
import { Badge, Button, Card, EmptyState, Input, Select, Spinner, Stat } from "@/components/ui";

export default function GraphPage() {
  useRequireAuth();
  const auth = useAuth();

  const [stats, setStats] = useState<GraphStats | null>(null);
  const [query, setQuery] = useState("");
  const [depth, setDepth] = useState("1");
  const [results, setResults] = useState<{ id: string; name: string; type: string; description?: string | null; confidence?: number | null }[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<EntityDetail | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [fullGraph, setFullGraph] = useState<{ nodes: CanvasNode[]; edges: CanvasEdge[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<GraphStats>("/graph/stats", { token: auth.token })
      .then(setStats)
      .catch(() => undefined);
  }, [auth.token]);

  async function search(e?: React.FormEvent) {
    e?.preventDefault();
    setSearching(true);
    setError(null);
    setSelected(null);
    setFullGraph(null);
    try {
      const res = await apiFetch<{ items: { id: string; name: string; type: string; description?: string | null; confidence?: number | null }[] }>(
        `/graph/entities?query=${encodeURIComponent(query)}`,
        { token: auth.token }
      );
      setResults(res.items);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSearching(false);
    }
  }

  async function openEntity(name: string) {
    setLoading(name);
    setError(null);
    setFullGraph(null);
    try {
      const detail = await apiFetch<EntityDetail>(`/graph/entities/${encodeURIComponent(name)}?depth=${depth}`, { token: auth.token });
      setSelected(detail);
      setResults(detail.relatedEntities);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(null);
    }
  }

  async function loadFullGraph() {
    setLoading("__all__");
    setError(null);
    setSelected(null);
    try {
      const rels = await apiFetch<{ items: GraphRelationship[] }>("/graph/relationships", { token: auth.token });
      const seen = new Map<string, CanvasNode>();
      const edges: CanvasEdge[] = [];
      const items = rels.items;
      for (const r of items) {
        const s = r.source;
        const t = r.target;
        if (s?.name && !seen.has(s.name)) seen.set(s.name, { id: s.id || s.name, name: s.name, type: (s.type ?? "Topic") as string });
        if (t?.name && !seen.has(t.name)) seen.set(t.name, { id: t.id || t.name, name: t.name, type: (t.type ?? "Topic") as string });
        edges.push({ id: r.rid, source: s.id || s.name, target: t.id || t.name, type: r.type });
        if (seen.size >= 120) break;
      }
      setFullGraph({ nodes: Array.from(seen.values()), edges });
      setResults([]);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(null);
    }
  }

  const canvasNodes: CanvasNode[] =
    selected ? [
      { id: selected.entity.id, name: selected.entity.name, type: selected.entity.type },
      ...selected.relatedEntities.map((r) => ({ id: r.id, name: r.name, type: r.type }))
    ]
    : fullGraph?.nodes ?? [];

  const canvasEdges: CanvasEdge[] =
    selected
      ? selected.relationships
          .filter((r) => r.source && r.target)
          .map((r) => ({ id: r.rid, source: r.source.id ?? r.source.name, target: r.target.id ?? r.target.name, type: r.type }))
      : fullGraph?.edges ?? [];

  return (
    <div className="flex min-h-screen">
      <div className="w-80 shrink-0 border-r border-slate-800 bg-ink-950 p-4">
        <h1 className="text-lg font-semibold text-slate-100">Graph Explorer</h1>

        {stats && (
          <div className="mt-4 grid grid-cols-2 gap-2">
            <Stat label="Entities" value={stats.unavailable ? "—" : stats.entities} />
            <Stat label="Relationships" value={stats.unavailable ? "—" : stats.relationships} />
          </div>
        )}

        <form onSubmit={search} className="mt-5 space-y-2">
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search entities…" />
          <div className="flex items-center justify-between gap-2">
            <Select value={depth} onChange={(e) => setDepth(e.target.value)} className="w-24">
              {["1", "2", "3"].map((d) => (
                <option key={d} value={d}>
                  depth {d}
                </option>
              ))}
            </Select>
            <Button type="submit" disabled={searching}>
              {searching ? "Searching…" : "Search"}
            </Button>
          </div>
        </form>

        <button onClick={() => void loadFullGraph()} className="mt-3 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-300 transition hover:border-indigo-500">
          View full authorized graph
        </button>

        <div className="mt-4 space-y-1.5">
          {loading === "__all__" && <Spinner label="Loading graph…" />}
          {results.map((r) => (
            <button
              key={r.name}
              onClick={() => void openEntity(r.name)}
              className="block w-full rounded-lg border border-slate-800 bg-ink-900 px-3 py-2 text-left transition hover:border-indigo-500"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm text-slate-200">{r.name}</span>
                <Badge tone="indigo">{r.type}</Badge>
              </div>
              {r.description && <div className="mt-0.5 line-clamp-1 text-[11px] text-slate-500">{r.description}</div>}
              {loading === r.name && <div className="mt-1 text-[11px] text-slate-500">Loading neighborhood…</div>}
            </button>
          ))}
          {results.length === 0 && searching === false && !loading && !fullGraph && (
            <p className="px-1 py-3 text-xs text-slate-600">Search for an entity or view the full graph.</p>
          )}
        </div>
      </div>

      <div className="min-w-0 flex-1 p-4">
        {error && (
          <div className="mb-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{error}</div>
        )}
        {canvasNodes.length === 0 ? (
          <EmptyState icon="🕸️" title="Pick an entity to explore" hint="Every node you see was verified against your document permissions." />
        ) : (
          <>
            <GraphCanvas nodes={canvasNodes} edges={canvasEdges} onSelect={(n) => void openEntity(n.name)} selectedId={selected?.entity.id ?? null} height={Math.max(520, canvasNodes.length * 14)} />
            <div className="mt-3 flex flex-wrap gap-1 text-[11px] text-slate-500">
              <span className="uppercase tracking-wide text-slate-600">Showing:</span>
              {selected && (
                <span>
                  neighborhood of <span className="text-indigo-300">{selected.entity.name}</span> (depth {depth})
                </span>
              )}
              {!selected && fullGraph && <span>authorized relationships ({fullGraph.nodes.length} nodes, {fullGraph.edges.length} edges)</span>}
              <span className="ml-auto">{canvasNodes.length} nodes · {canvasEdges.length} relations</span>
            </div>
          </>
        )}

        {selected && (
          <Card className="mt-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-base font-semibold text-slate-100">{selected.entity.name}</span>
                <Badge tone="indigo">{selected.entity.type}</Badge>
                {typeof selected.permissions?.sourceCount === "number" && (
                  <span className="text-[11px] text-slate-500">{selected.permissions.sourceCount} source docs</span>
                )}
              </div>
            </div>
            {selected.entity.description && <p className="mb-3 text-sm text-slate-400">{selected.entity.description}</p>}
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div>
                <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Source documents</div>
                {selected.sourceDocuments.length > 0 ? (
                  <div className="space-y-1">
                    {selected.sourceDocuments.map((d) => (
                      <div key={d.id} className="rounded-md bg-slate-900 px-2.5 py-1.5 text-xs text-slate-300">
                        {d.title} <Badge tone="slate">{d.sensitivity}</Badge>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-slate-600">No documents visible</p>
                )}
              </div>
              <div>
                <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Relationships</div>
                {selected.relationships.length > 0 ? (
                  <div className="space-y-1">
                    {selected.relationships.slice(0, 20).map((r, i) => (
                      <div key={r.rid ?? i} className="flex items-center gap-1.5 rounded-md bg-slate-900 px-2.5 py-1.5 text-xs text-slate-300">
                        {r.source?.name} <span className="text-[10px] font-semibold text-indigo-300">{r.type}</span> {r.target?.name}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-slate-600">No relationships visible</p>
                )}
              </div>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}