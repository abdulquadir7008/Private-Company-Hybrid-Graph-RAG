"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";
import { useAuth, useRequireAuth } from "@/components/AuthProvider";
import GraphCanvas, { colorFor, type CanvasEdge, type CanvasNode } from "@/components/GraphCanvas";
import type { EntityDetail, GraphRelationship, GraphStats } from "@/lib/types";
import { Alert, Badge, Button, Card, EmptyState, Input, Select, Spinner, Stat } from "@/components/ui";

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

  const openEntity = useCallback(
    async (name: string) => {
      setLoading(name);
      setError(null);
      setFullGraph(null);
      try {
        const detail = await apiFetch<EntityDetail>(`/graph/entities/${encodeURIComponent(name)}?depth=${depth}`, { token: auth.token });
        setSelected(detail);
        setResults(detail.relatedEntities.map((r) => ({ id: r.id, name: r.name, type: r.type, description: r.description, confidence: r.confidence })));
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(null);
      }
    },
    [depth, auth.token]
  );

  async function loadFullGraph() {
    setLoading("__all__");
    setError(null);
    setSelected(null);
    setQuery("");
    try {
      const rels = await apiFetch<{ items: GraphRelationship[] }>("/graph/relationships", { token: auth.token });
      const { nodes, edges } = normalizeGraph(rels.items);
      setFullGraph({ nodes, edges });
      setResults([]);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(null);
    }
  }

  // Entity mode is built from the same canonical GraphRelationship list so the
  // node ID strategy is identical to full-graph mode (normalized in one place).
  // Memoized so the array identities are stable unless the actual graph data
  // changes (avoids needlessly recomputing the expensive canvas layout).
  const entityGraph = useMemo(
    () => (selected ? normalizeGraph(selected.relationships) : null),
    [selected]
  );

  const canvasNodes: CanvasNode[] = useMemo(
    () =>
      selected
        ? entityGraph && entityGraph.nodes.length > 0
          ? entityGraph.nodes
          : [
              {
                id: selected.entity.id.trim() || selected.entity.name,
                name: selected.entity.name,
                type: selected.entity.type
              }
            ]
        : fullGraph?.nodes ?? [],
    [selected, entityGraph, fullGraph]
  );

  const canvasEdges: CanvasEdge[] = useMemo(
    () => (selected ? entityGraph?.edges ?? [] : fullGraph?.edges ?? []),
    [selected, entityGraph, fullGraph]
  );

  return (
    <div className="graph-blossom flex min-h-full flex-col overflow-visible bg-[#fffaf9] text-slate-800 md:h-full md:flex-row md:overflow-hidden">
      {/* LEFT SIDEBAR */}
      <aside className="flex max-h-[22rem] w-full shrink-0 flex-col border-b border-rose-100 bg-white/90 shadow-[-12px_0_32px_rgba(244,63,94,0.04)] backdrop-blur-md md:order-2 md:max-h-none md:w-[19rem] md:border-b-0 md:border-l md:border-r-0">
        <div className="border-b border-rose-100 px-4 py-4">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-pink-500 to-rose-500 text-xs text-white">✦</span>
            <div>
              <h1 className="text-base font-semibold tracking-tight text-slate-900">Graph Explorer</h1>
              <p className="text-[11px] text-slate-500">Explore authorized knowledge</p>
            </div>
          </div>
          {stats && (
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Stat label="Entities" value={stats.unavailable ? "—" : stats.entities} />
              <Stat label="Relationships" value={stats.unavailable ? "—" : stats.relationships} />
            </div>
          )}
        </div>

        <div className="border-b border-rose-100 px-4 py-3">
          <form onSubmit={search} className="space-y-2">
            <div className="relative">
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"
              >
                <circle cx="11" cy="11" r="8" />
                <path d="M21 21l-4.35-4.35" />
              </svg>
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search entities…"
                className="pl-9"
              />
            </div>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-slate-500">Depth</span>
                <Select value={depth} onChange={(e) => setDepth(e.target.value)} className="w-20">
                  {["1", "2", "3"].map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </Select>
              </div>
              <Button type="submit" disabled={searching} className="bg-gradient-to-b from-pink-500 to-rose-500 shadow-pink-200 hover:from-pink-400 hover:to-rose-400">
                {searching ? "Searching…" : "Search"}
              </Button>
            </div>
          </form>

          <Button variant="outline" onClick={() => void loadFullGraph()} className="mt-3 w-full">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="6" cy="6" r="2.4" />
              <circle cx="18" cy="6" r="2.4" />
              <circle cx="12" cy="18" r="2.4" />
              <path d="M8.2 6.9l5.6 8.2M15.8 6.9l-5.6 8.2" />
            </svg>
            View full authorized graph
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-3">
          {loading === "__all__" && <Spinner label="Loading graph…" />}
          <div className="space-y-1.5">
            {results.map((r) => {
              const isActive = selected?.entity.name === r.name;
              return (
                <button
                  key={r.id}
                  onClick={() => void openEntity(r.name)}
                  className={`block w-full rounded-xl border px-3 py-2.5 text-left transition ${
                    isActive
                      ? "border-rose-300 bg-rose-50 shadow-[0_8px_20px_rgba(244,63,94,0.12)]"
                      : "border-white/8 bg-base-900/60 hover:border-rose-200 hover:bg-rose-50/50"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex min-w-0 items-center gap-1.5">
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: colorFor(r.type), boxShadow: `0 0 8px ${colorFor(r.type)}66` }} />
                      <span className="truncate text-sm font-medium text-slate-100">{r.name}</span>
                    </span>
                    <Badge tone="violet">{r.type}</Badge>
                  </div>
                  {r.description && <div className="mt-0.5 line-clamp-1 text-[11px] text-slate-500">{r.description}</div>}
                  {loading === r.name && <div className="mt-1 text-[11px] text-slate-500">Loading neighborhood…</div>}
                </button>
              );
            })}
            {results.length === 0 && searching === false && !loading && !fullGraph && !selected && (
              <p className="px-1 py-3 text-xs text-slate-500">Search for an entity or view the full graph.</p>
            )}
          </div>
        </div>
      </aside>

      {/* MAIN GRAPH PANEL */}
      <main className="order-1 flex min-h-[640px] min-w-0 flex-1 flex-col md:min-h-0">
        <div className="flex-1 p-3">
          {error && (
            <div className="mb-3">
              <Alert tone="rose">{error}</Alert>
            </div>
          )}
          {canvasNodes.length === 0 ? (
            <div className="flex h-full items-center justify-center">
              <EmptyState icon="🕸️" title="Pick an entity to explore" hint="Every node you see was verified against your document permissions." />
            </div>
          ) : (
            <GraphCanvas
              nodes={canvasNodes}
              edges={canvasEdges}
              onSelect={(n) => void openEntity(n.name)}
              selectedId={selected ? selected.entity.id.trim() || selected.entity.name : null}
              mode={selected ? "entity" : "full"}
              height={560}
              theme="blossom"
            />
          )}
        </div>

        {selected && (
          <div className="shrink-0 border-t border-white/8 px-3 py-3">
            <Card className="!p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="inline-block h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: colorFor(selected.entity.type), boxShadow: `0 0 8px ${colorFor(selected.entity.type)}66` }} />
                  <span className="truncate text-base font-semibold text-slate-100">{selected.entity.name}</span>
                  <Badge tone="violet">{selected.entity.type}</Badge>
                  {typeof selected.permissions?.sourceCount === "number" && (
                    <span className="text-[11px] text-slate-500">{selected.permissions.sourceCount} source docs</span>
                  )}
                </div>
              </div>
              {selected.entity.description && <p className="mb-3 max-w-3xl text-sm text-slate-400">{selected.entity.description}</p>}
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <Section title="Source documents">
                  {selected.sourceDocuments.length > 0 ? (
                    <div className="space-y-1">
                      {selected.sourceDocuments.map((d) => (
                        <div key={d.id} className="flex items-center justify-between gap-2 rounded-lg bg-base-900/60 px-2.5 py-1.5 text-xs text-slate-300 ring-1 ring-inset ring-white/5">
                          <span className="truncate">{d.title}</span>
                          <Badge tone="slate">{d.sensitivity}</Badge>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-slate-600">No documents visible</p>
                  )}
                </Section>
                <Section title="Relationships">
                  {selected.relationships.length > 0 ? (
                    <div className="space-y-1">
                      {selected.relationships.slice(0, 20).map((r, i) => (
                        <div key={r.rid ?? i} className="flex items-center gap-1.5 rounded-lg bg-base-900/60 px-2.5 py-1.5 text-xs text-slate-300 ring-1 ring-inset ring-white/5">
                          <span className="truncate">{r.source?.name}</span>
                          <span className="shrink-0 rounded bg-indigo-500/15 px-1.5 py-px text-[10px] font-semibold text-indigo-300">{r.type}</span>
                          <span className="truncate">{r.target?.name}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-slate-600">No relationships visible</p>
                  )}
                </Section>
              </div>
            </Card>
          </div>
        )}
      </main>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{title}</div>
      {children}
    </div>
  );
}

/**
 * Centralized normalization of GraphRelationship[] -> canvas nodes + edges.
 *
 * A single identifier strategy is applied here, in ONE place, for both the
 * entity-neighborhood graph and the full authorized graph:
 *   node key = relationship endpoint id, falling back to its name when the id
 *   is empty/missing.
 *
 * This guarantees every edge endpoint resolves to a node that actually exists
 * in the node map — preventing invisible edges, collapsed nodes, and the
 * "Cannot read properties of undefined (reading 'id')" class of crashes caused
 * by inconsistent source/target identifiers. Invalid edges are safely skipped.
 *
 * The selected root is keyed the same way, so the node on the canvas that
 * represents the selected entity is always the same node the edge endpoints
 * point to.
 */
function normalizeGraph(rels: GraphRelationship[]): { nodes: CanvasNode[]; edges: CanvasEdge[] } {
  const nodesById = new Map<string, CanvasNode>();
  const edges: CanvasEdge[] = [];

  const upsertNode = (id: string, name: string, type?: string) => {
    const key = id.trim() || name.trim();
    if (!key) return null;
    if (!nodesById.has(key)) {
      nodesById.set(key, { id: key, name: name || key, type: (type ?? "Topic") as string });
    }
    return key;
  };

  for (const r of rels) {
    // Defensive: every relationship must have structured source/target.
    const s = r?.source;
    const t = r?.target;
    const sName = s?.name;
    const tName = t?.name;
    const sType = s?.type;
    const tType = t?.type;
    // Empty-name endpoints are unusable; skip this edge rather than crash.
    if (!sName && !tName) continue;
    if (!sName || !tName) continue;

    const sourceKey = upsertNode(s.id, sName, sType);
    const targetKey = upsertNode(t.id, tName, tType);
    if (!sourceKey || !targetKey) continue;

    edges.push({ id: r.rid || `${sourceKey}->${r.type}->${targetKey}`, source: sourceKey, target: targetKey, type: r.type });
  }

  return { nodes: Array.from(nodesById.values()), edges };
}
