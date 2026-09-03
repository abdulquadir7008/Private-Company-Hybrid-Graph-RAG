"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ApiError, apiFetch } from "@/lib/api";
import { useAuth, useRequireAuth } from "@/components/AuthProvider";
import { useToast } from "@/components/Toast";
import GraphCanvas, { colorFor, type CanvasEdge, type CanvasNode } from "@/components/GraphCanvas";
import PageSeo from "@/components/PageSeo";
import type { AiGraphQueryResponse, EntityDetail, GraphRelationship, GraphStats } from "@/lib/types";
import { Badge, Button, Card, EmptyState, Input, Select, Spinner, Stat } from "@/components/ui";

interface PathGraph {
  id: string;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  highlightNodes: Set<string>;
  highlightEdges: Set<string>;
}

/** Schema-based natural-language example queries (only schema types shown). */
const AI_EXAMPLES = [
  "Show me everyone related to Remote Work Policy",
  "Which employees are connected to security policies?",
  "Show departments connected to employees",
  "Who reports to managers in Engineering?"
];

const LOADING_STAGES = [
  { id: "understand", label: "Understanding graph question…", icon: "✨" },
  { id: "build", label: "Building graph query…", icon: "🔗" },
  { id: "verify", label: "Verifying access…", icon: "🛡️" },
  { id: "render", label: "Building graph…", icon: "🕸️" }
];

export default function GraphPage() {
  useRequireAuth();
  const auth = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();

  const [stats, setStats] = useState<GraphStats | null>(null);
  const [query, setQuery] = useState("");
  const [aiQuery, setAiQuery] = useState("");
  const [depth, setDepth] = useState("1");
  const [results, setResults] = useState<{ id: string; name: string; type: string; description?: string | null; confidence?: number | null }[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<EntityDetail | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [fullGraph, setFullGraph] = useState<{ nodes: CanvasNode[]; edges: CanvasEdge[] } | null>(null);
  const [pathGraph, setPathGraph] = useState<PathGraph | null>(null);
  const [pathLoading, setPathLoading] = useState(false);
  const [pathError, setPathError] = useState<string | null>(null);

  const [aiResult, setAiResult] = useState<AiGraphQueryResponse | null>(null);
  const [aiLoadingStage, setAiLoadingStage] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [showPlan, setShowPlan] = useState(false);
  const [recentQueries, setRecentQueries] = useState<string[]>([]);

  useEffect(() => {
    apiFetch<GraphStats>("/graph/stats", { token: auth.token })
      .then(setStats)
      .catch(() => undefined);
  }, [auth.token]);

  // Deep-link support: /graph?message=<id>&path=<pathId> fetches + renders the
  // exact authorized graph path from the answer's explanation trace. Runs
  // immediately on mount/navigation so no browser refresh is required.
  const messageParam = searchParams.get("message");
  const pathParam = searchParams.get("path");

  useEffect(() => {
    if (!messageParam || !pathParam || !auth.token) return;
    let cancelled = false;
    setPathLoading(true);
    setPathError(null);
    setPathGraph(null);
    setSelected(null);
    setFullGraph(null);
    apiFetch<{ path: PathGraph }>(`/graph/explanation-path?message=${encodeURIComponent(messageParam)}&path=${encodeURIComponent(pathParam)}`, { token: auth.token })
      .then((data) => {
        if (cancelled) return;
        const highlightNodes = new Set(data.path.nodes.map((n) => n.id));
        const highlightEdges = new Set(data.path.edges.map((e) => e.id));
        setPathGraph({ ...data.path, highlightNodes, highlightEdges });
      })
      .catch((err) => {
        if (cancelled) return;
        setPathError((err as Error).message || "This graph path is not available.");
      })
      .finally(() => {
        if (!cancelled) setPathLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [messageParam, pathParam, auth.token]);

  async function search(e?: React.FormEvent) {
    e?.preventDefault();
    setSearching(true);
    setSelected(null);
    setFullGraph(null);
    setPathGraph(null);
    setPathError(null);
    try {
      const res = await apiFetch<{ items: { id: string; name: string; type: string; description?: string | null; confidence?: number | null }[] }>(
        `/graph/entities?query=${encodeURIComponent(query)}`,
        { token: auth.token }
      );
      setResults(res.items);
    } catch (err) {
      toast({ type: "error", message: (err as Error).message });
    } finally {
      setSearching(false);
    }
  }

  const openEntity = useCallback(
    async (name: string) => {
      setLoading(name);
      setFullGraph(null);
      try {
        const detail = await apiFetch<EntityDetail>(`/graph/entities/${encodeURIComponent(name)}?depth=${depth}`, { token: auth.token });
        setSelected(detail);
        setResults(detail.relatedEntities.map((r) => ({ id: r.id, name: r.name, type: r.type, description: r.description, confidence: r.confidence })));
      } catch (err) {
        toast({ type: "error", message: (err as Error).message });
      } finally {
        setLoading(null);
      }
    },
    [depth, auth.token, toast]
  );

  async function loadFullGraph() {
    setLoading("__all__");
    setSelected(null);
    setQuery("");
    setPathGraph(null);
    setPathError(null);
    try {
      const rels = await apiFetch<{ items: GraphRelationship[] }>("/graph/relationships", { token: auth.token });
      const { nodes, edges } = normalizeGraph(rels.items);
      setFullGraph({ nodes, edges });
      setResults([]);
    } catch (err) {
      toast({ type: "error", message: (err as Error).message });
    } finally {
      setLoading(null);
    }
  }

  /**
   * Run a natural-language graph query. Walks the high-level loading stages so
   * the UI feels responsive without exposing chain-of-thought. Results are set
   * into aiResult, which flows into the existing `canvasNodes`/`canvasEdges`
   * memos — because those memos feed GraphCanvas's `dataKey`, the layout is
   * recomputed and auto-fitted automatically (no browser refresh).
   */
  async function runAiQuery(question: string) {
    const q = (question ?? aiQuery).trim();
    if (!q) return;
    if (!auth.token) return;
    setAiError(null);
    setAiLoadingStage(LOADING_STAGES[0].id);
    setAiResult(null);

    // Reveal stages progressively while the request is in flight.
    const board: ReturnType<typeof setTimeout>[] = [];
    LOADING_STAGES.forEach((s, i) => {
      board.push(setTimeout(() => setAiLoadingStage(s.id), i * 450));
    });

    try {
      const res = await apiFetch<AiGraphQueryResponse>("/graph/ai-query", { token: auth.token, method: "POST", body: JSON.stringify({ query: q }) });

      setLabel(res, q);

      if (res.queryPlan) setShowPlan(false);
    } catch (err) {
      const apiError = err instanceof ApiError ? err : null;
      // The API returns safe, actionable messages for query planning errors
      // (including a misconfigured or unreachable user-owned provider). Keep
      // them visible instead of hiding them behind a generic retry message.
      setAiError(
        apiError?.status === 0
          ? "Cannot reach the API server. Check that it is running and try again."
          : apiError?.message || "Graph query generation failed. Please try again."
      );
    } finally {
      board.forEach(clearTimeout);
      setAiLoadingStage(null);
    }
  }

  function setLabel(res: AiGraphQueryResponse, _q: string) {
    setAiResult(res);
    const rels = res.relationships ?? [];
    const iso = res.isolatedNodes ?? [];
    if (res.isEntitySearch && res.items?.length) {
      setResults(res.items.map((i) => ({ id: i.id, name: i.name, type: i.type, description: i.description, confidence: i.confidence })));
      setSelected(null);
      setFullGraph(null);
      setPathGraph(null);
    } else if (rels.length > 0 || iso.length > 0) {
      setFullGraph(graphFromAi(res));
      setSelected(null);
      setPathGraph(null);
      setResults([]);
    } else {
      // No graph data surfaced for this question.
      setAiError("No authorized graph data matched your query.");
    }
    setRecentQueries((prev) => Array.from(new Set([_q, ...prev])).slice(0, 8));
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
      pathGraph
        ? pathGraph.nodes
        : selected
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
    [selected, entityGraph, fullGraph, pathGraph]
  );

  const canvasEdges: CanvasEdge[] = useMemo(
    () => (pathGraph ? pathGraph.edges : selected ? entityGraph?.edges ?? [] : fullGraph?.edges ?? []),
    [selected, entityGraph, fullGraph, pathGraph]
  );

  const selectedId: string | null = useMemo(() => {
    if (pathGraph && pathGraph.nodes.length > 0) return pathGraph.nodes[0].id;
    return selected ? selected.entity.id.trim() || selected.entity.name : null;
  }, [pathGraph, selected]);

  const graphMode: "auto" | "entity" | "full" | "path" = pathGraph ? "path" : selected ? "entity" : fullGraph ? "full" : "auto";

  return (
    <>
      <PageSeo title="Graph Explorer" description="Visualize and explore your private company knowledge graph with natural-language queries, entity neighborhoods, and relationship paths." keywords={["graph explorer", "knowledge graph", "entity browser", "graph traversal", "relationships"]} />
      <div className="graph-blossom flex min-h-full flex-col overflow-visible bg-[#fffaf9] text-slate-800 md:h-full md:flex-row md:overflow-hidden">
      {/* LEFT SIDEBAR */}
      <aside className="flex max-h-[22rem] w-full shrink-0 flex-col overflow-y-auto border-b border-rose-100 bg-white/90 shadow-[-12px_0_32px_rgba(244,63,94,0.04)] backdrop-blur-md md:order-2 md:h-full md:max-h-none md:w-[19rem] md:border-b-0 md:border-l md:border-r-0">
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

        <div className="px-3 py-3">
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

        <div className="shrink-0 border-t border-rose-100 bg-white/95 px-4 py-3">
          <div className="rounded-xl border border-rose-100 bg-gradient-to-br from-rose-50/80 to-pink-50/40 p-3">
            <div className="mb-1.5 flex items-center gap-1.5">
              <span className="text-xs">✨</span>
              <span className="text-[11px] font-semibold uppercase tracking-wide text-rose-600">Ask AI</span>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void runAiQuery(aiQuery);
              }}
              className="space-y-2"
            >
              <Input
                value={aiQuery}
                onChange={(e) => setAiQuery(e.target.value)}
                placeholder="Ask a graph question…"
                aria-label="Natural-language graph query"
                className="bg-white/80 text-slate-700"
              />
              <Button
                type="submit"
                disabled={!!aiLoadingStage || aiQuery.trim().length === 0}
                className="w-full bg-gradient-to-b from-pink-500 to-rose-500 shadow-pink-200 hover:from-pink-400 hover:to-rose-400"
              >
                {aiLoadingStage ? "Working…" : "Ask AI"}
              </Button>
            </form>

            <div className="mt-2.5 space-y-1">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Examples</p>
              {AI_EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  type="button"
                  onClick={() => {
                    setAiQuery(ex);
                    void runAiQuery(ex);
                  }}
                  className="block w-full rounded-md px-2 py-1 text-left text-[11px] text-slate-600 transition hover:bg-rose-100/70 hover:text-rose-700"
                >
                  {ex}
                </button>
              ))}
            </div>

            {recentQueries.length > 0 && (
              <div className="mt-2.5 border-t border-rose-100 pt-2">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Recent AI queries</p>
                <div className="space-y-1">
                  {recentQueries.map((rq) => (
                    <button
                      key={rq}
                      type="button"
                      onClick={() => {
                        setAiQuery(rq);
                        void runAiQuery(rq);
                      }}
                      className="block w-full truncate rounded-md px-2 py-1 text-left text-[11px] text-slate-500 transition hover:bg-rose-100/70 hover:text-rose-700"
                    >
                      • {rq}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* MAIN GRAPH PANEL */}
      <main className="order-1 flex min-h-[640px] min-w-0 flex-1 flex-col md:min-h-0">
        {pathGraph && !pathLoading && !pathError && (
          <div className="flex items-center justify-between gap-3 border-b border-rose-100 bg-white/80 px-4 py-2 backdrop-blur-md">
            <div className="flex min-w-0 items-center gap-2 text-xs text-slate-600">
              <span className="inline-block h-2 w-2 shrink-0 rounded-full bg-rose-500 shadow-[0_0_8px_#f43f5e]" />
              <span className="truncate">
                Explained path · {pathGraph.nodes.length} entities · {pathGraph.edges.length} relationships
              </span>
            </div>
            <Button
              variant="outline"
              onClick={() => {
                setPathGraph(null);
                router.replace("/graph");
              }}
              className="!px-3 !py-1 !text-xs"
            >
              Back to explorer
            </Button>
          </div>
        )}
        <div className="flex-1 space-y-3 p-3">
          {aiResult && (
            <AiGraphResultCard
              result={aiResult}
              showPlan={showPlan}
              onTogglePlan={() => setShowPlan((v) => !v)}
            />
          )}
          {pathLoading ? (
            <div className="flex h-full items-center justify-center">
              <Spinner label="Loading explained path…" />
            </div>
          ) : pathError ? (
            <div className="flex h-full items-center justify-center">
              <EmptyState
                icon="🕸️"
                title="Graph path unavailable"
                hint={pathError}
              />
            </div>
          ) : aiLoadingStage ? (
            <div className="flex flex-col items-center justify-center py-16">
              <Spinner />
              <p className="mt-3 text-sm text-slate-500">
                {LOADING_STAGES.find((s) => s.id === aiLoadingStage)?.icon} {LOADING_STAGES.find((s) => s.id === aiLoadingStage)?.label}
              </p>
            </div>
          ) : aiError ? (
            <div className="flex h-full items-center justify-center">
              <EmptyState icon="🤖" title="AI graph query" hint={aiError} />
            </div>
          ) : canvasNodes.length === 0 ? (
            <div className="flex h-full items-center justify-center">
              <EmptyState icon="🕸️" title="Pick an entity to explore" hint="Every node you see was verified against your document permissions." />
            </div>
          ) : (
            <GraphCanvas
              nodes={canvasNodes}
              edges={canvasEdges}
              onSelect={(n) => void openEntity(n.name)}
              selectedId={selectedId}
              mode={graphMode}
              height={560}
              theme="blossom"
              highlightNodeIds={pathGraph?.highlightNodes ?? null}
              highlightEdgeIds={pathGraph?.highlightEdges ?? null}
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
    </>
  );
}

/**
 * AI Graph Query result card: shows the human-readable interpretation of the
 * user's natural-language request plus a collapsible view of the SAFE structured
 * query plan. No chain-of-thought, prompts, or internal Cypher are shown.
 */
function AiGraphResultCard({
  result,
  showPlan,
  onTogglePlan
}: {
  result: AiGraphQueryResponse;
  showPlan: boolean;
  onTogglePlan: () => void;
}) {
  const plan = result.queryPlan;
  const steps = result.explanation.steps ?? [];

  return (
    <Card className="!p-4 shadow-[0_10px_30px_rgba(244,63,94,0.08)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-sm">✨</span>
            <h2 className="text-sm font-semibold text-slate-900">AI Graph Query</h2>
          </div>
          <p className="mt-1 text-xs italic text-slate-500">&ldquo;{result.query}&rdquo;</p>
          <p className="mt-2 text-sm font-medium text-slate-700">{result.explanation.summary}</p>

          {steps.length > 0 && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-rose-600">
              {steps.map((s, i) => (
                <span key={i} className="inline-flex items-center gap-1.5 rounded-md bg-rose-50 px-2 py-0.5 font-medium text-rose-700 ring-1 ring-inset ring-rose-100">
                  {s}
                  {i < steps.length - 1 && <span className="text-rose-300">→</span>}
                </span>
              ))}
            </div>
          )}

          <p className="mt-2 text-xs text-slate-500">
            {result.stats?.nodes ?? 0} entities · {result.stats?.relationships ?? 0} relationships
          </p>
        </div>
        <Button variant="outline" onClick={onTogglePlan} className="shrink-0 !px-3 !py-1.5 !text-xs">
          {showPlan ? "Hide query details" : "View generated query"}
        </Button>
      </div>

      {showPlan && plan && (
        <div className="mt-3 rounded-lg border border-rose-100 bg-[#fffaf9] p-3">
          <QueryPlanView plan={plan} />
        </div>
      )}
    </Card>
  );
}

/** Human-readable rendering of the validated structured query plan. */
function QueryPlanView({ plan }: { plan: AiGraphQueryResponse["queryPlan"] }) {
  if (!plan) return null;
  const path = plan.path ?? [];
  const intentLabel = readableIntent(plan);

  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-xs sm:grid-cols-2">
      <div>
        <dt className="font-semibold uppercase tracking-wide text-slate-400">Intent</dt>
        <dd className="mt-0.5 text-slate-700">{intentLabel}</dd>
      </div>
      {plan.targetEntityTypes.length > 0 && (
        <div>
          <dt className="font-semibold uppercase tracking-wide text-slate-400">Targets</dt>
          <dd className="mt-0.5 text-slate-700">{plan.targetEntityTypes.join(", ")}</dd>
        </div>
      )}
      {path.length > 0 && (
        <div className="sm:col-span-2">
          <dt className="font-semibold uppercase tracking-wide text-slate-400">Path</dt>
          <dd className="mt-0.5 flex flex-wrap items-center gap-1.5 text-slate-700">
            {path.map((s, i) => (
              <span key={i} className="inline-flex items-center gap-1.5">
                <span className="rounded bg-pink-100 px-1.5 py-0.5 font-medium text-pink-800">{s.entityType ?? "any"}</span>
                {i < path.length - 1 && <span className="text-rose-300">→</span>}
              </span>
            ))}
          </dd>
        </div>
      )}
      {plan.relationshipTypes && plan.relationshipTypes.length > 0 && (
        <div>
          <dt className="font-semibold uppercase tracking-wide text-slate-400">Relationship filters</dt>
          <dd className="mt-0.5 text-slate-700">{plan.relationshipTypes.join(", ")}</dd>
        </div>
      )}
      <div>
        <dt className="font-semibold uppercase tracking-wide text-slate-400">Max depth</dt>
        <dd className="mt-0.5 text-slate-700">{plan.maxDepth ?? 3}</dd>
      </div>
      <div>
        <dt className="font-semibold uppercase tracking-wide text-slate-400">Result limit</dt>
        <dd className="mt-0.5 text-slate-700">{plan.limit ?? 50}</dd>
      </div>
    </dl>
  );
}

function readableIntent(plan: AiGraphQueryResponse["queryPlan"]): string {
  if (!plan) return "—";
  switch (plan.intent) {
    case "find_entities":
      return plan.targetEntityTypes.length ? `Find ${plan.targetEntityTypes.join(" and ")}` : "Find entities";
    case "find_paths":
      return "Find paths";
    case "find_relationships":
      return "Find relationships";
    case "neighborhood":
      return "Neighborhood";
    case "count":
      return "Count";
    default:
      return "—";
  }
}

/**
 * Normalize an AI graph-query response into canvas nodes+edges compatible with
 * the existing GraphCanvas. Reuses the centralized node-key strategy so edges
 * always resolve to real nodes; isolated authorized nodes are appended.
 */
function graphFromAi(res: AiGraphQueryResponse): { nodes: CanvasNode[]; edges: CanvasEdge[] } {
  const base = normalizeGraph(Array.isArray(res.relationships) ? res.relationships : []);
  const nodesById = new Map<string, CanvasNode>(base.nodes.map((n) => [n.id, n]));
  for (const n of res.isolatedNodes ?? []) {
    const key = n.id.trim() || n.name.trim();
    if (key && !nodesById.has(key)) nodesById.set(key, { id: key, name: n.name, type: n.type || "Topic" });
  }
  return { nodes: Array.from(nodesById.values()), edges: base.edges };
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
