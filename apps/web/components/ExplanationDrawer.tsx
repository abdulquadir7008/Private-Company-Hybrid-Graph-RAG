"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, type ApiError } from "@/lib/api";
import type {
  AnswerExplanation,
  Citation,
  ExplanationClaim,
  ExplanationGraphEvidence,
  ExplanationGraphPath,
  EvidenceStrength
} from "@/lib/types";
import { Badge, Spinner } from "@/components/ui";
import GraphCanvas, { type CanvasEdge, type CanvasNode } from "./GraphCanvas";

/* ------------------------------------------------------------------ */
/* Shared presentational helpers                                       */
/* ------------------------------------------------------------------ */

function StrengthBadge({ level }: { level: EvidenceStrength }) {
  const tone = level === "HIGH" ? "green" : level === "MEDIUM" ? "amber" : "rose";
  const label = `${level} evidence`;
  return <Badge tone={tone as "green" | "amber" | "rose"}>{label}</Badge>;
}

function Section({ title, subtitle, children, defaultOpen = true }: { title: string; subtitle?: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="overflow-hidden rounded-2xl border border-rose-100 bg-white">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-slate-800">{title}</div>
          {subtitle && <div className="mt-0.5 text-xs text-slate-500">{subtitle}</div>}
        </div>
        <svg viewBox="0 0 20 20" fill="currentColor" className={`h-4 w-4 shrink-0 text-slate-400 transition-transform duration-200 ${open ? "rotate-180" : ""}`} aria-hidden>
          <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.17l3.71-3.94a.75.75 0 1 1 1.08 1.04l-4.25 4.5a.75.75 0 0 1-1.08 0l-4.25-4.5a.75.75 0 0 1 .02-1.06Z" clipRule="evenodd" />
        </svg>
      </button>
      {open && <div className="border-t border-rose-100 px-4 py-4">{children}</div>}
    </div>
  );
}

function MetricRow({ label, value, accent }: { label: string; value: React.ReactNode; accent?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2 py-1 text-sm">
      <span className="text-slate-500">{label}</span>
      <span className={`font-semibold ${accent ? "text-rose-600" : "text-slate-800"}`}>{value}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Graph evidence: authorized paths + "View this path in Graph"        */
/* ------------------------------------------------------------------ */

function GraphEvidenceView({
  evidence,
  paths,
  onViewPath
}: {
  evidence: ExplanationGraphEvidence[];
  paths: ExplanationGraphPath[];
  onViewPath: (pathId: string) => void;
}) {
  // Fallback mini-graph from the flat edge list (used when no structured paths).
  const flatGraph = useMemo(() => {
    const nodeById = new Map<string, CanvasNode>();
    const edgeList: CanvasEdge[] = [];
    for (const e of evidence) {
      const upsert = (id: string, name: string, type: string) => {
        const key = id.trim() || name.trim();
        if (!key) return null;
        if (!nodeById.has(key)) nodeById.set(key, { id: key, name, type: type || "Topic" });
        return key;
      };
      const s = upsert(e.source.id, e.source.name, e.source.type);
      const t = upsert(e.target.id, e.target.name, e.target.type);
      if (s && t) edgeList.push({ id: e.relationshipId || `${s}-${t}`, source: s, target: t, type: e.type });
    }
    return { nodes: Array.from(nodeById.values()), edges: edgeList };
  }, [evidence]);

  if (evidence.length === 0 && paths.length === 0) {
    return <div className="text-sm text-slate-500">No graph path contributed to this answer.</div>;
  }

  // If we have structured paths, render each strongly-connected path with its
  // ordered node sequence + a "View this path in Graph" action.
  if (paths.length > 0) {
    return (
      <div className="space-y-3">
        {paths.map((path, idx) => (
          <PathCard key={path.id} path={path} index={idx} onViewPath={onViewPath} />
        ))}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-white/10 bg-[#fffaf9] p-2">
      <GraphCanvas nodes={flatGraph.nodes} edges={flatGraph.edges} mode="full" height={280} theme="blossom" />
    </div>
  );
}

function PathCard({ path, index, onViewPath }: { path: ExplanationGraphPath; index: number; onViewPath: (pathId: string) => void }) {
  const hasValid = path.nodes.length >= 2 && path.edges.length >= 1;
  return (
    <div className="overflow-hidden rounded-xl border border-rose-100 bg-white">
      <div className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        {pathsLabel(index, path)}
      </div>
      <div className="border-t border-rose-100 px-3 py-3">
        {hasValid ? (
          <div className="flex flex-wrap items-center gap-1.5 text-[13px] text-slate-700">
            {path.nodes.map((n, i) => (
              <span key={n.id} className="contents">
                <span className="rounded-md bg-slate-100 px-2 py-0.5 font-medium">{n.name}</span>
                {i < path.nodes.length - 1 && <span className="text-slate-400">→</span>}
              </span>
            ))}
          </div>
        ) : (
          <div className="text-sm text-slate-500">Graph path unavailable</div>
        )}
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-slate-400">
            {path.nodes.length} entities · {path.edges.length} relationships
          </span>
          <button
            onClick={() => onViewPath(path.id)}
            disabled={!hasValid}
            className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-sm font-medium text-rose-600 shadow-sm transition hover:border-rose-300 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <circle cx="6" cy="6" r="2.4" />
              <circle cx="18" cy="6" r="2.4" />
              <circle cx="12" cy="18" r="2.4" />
              <path d="M8.2 6.9l5.6 8.2M15.8 6.9l-5.6 8.2" />
            </svg>
            View this path in Graph
          </button>
        </div>
      </div>
    </div>
  );
}

function pathsLabel(index: number, path: ExplanationGraphPath): string {
  return `Supporting path ${index + 1}${path.depth > 1 ? ` · ${path.depth} hops` : ""}`;
}

/* ------------------------------------------------------------------ */
/* Main drawer                                                        */
/* ------------------------------------------------------------------ */

interface Props {
  open: boolean;
  onClose: () => void;
  messageId?: string | null;
  token?: string | null;
  explanation?: AnswerExplanation | null;
  citations?: Citation[] | null;
}

export default function ExplanationDrawer({ open, onClose, messageId, token, explanation: initialExplanation, citations = [] }: Props) {
  const router = useRouter();
  const [explanation, setExplanation] = useState<AnswerExplanation | null>(initialExplanation ?? null);
  const [loading, setLoading] = useState<boolean>(!initialExplanation && Boolean(messageId));
  const [error, setError] = useState<string | null>(null);

  // Normalize a possibly-null citations prop to a safe array.
  const safeCitations: Citation[] = citations ?? [];

  useEffect(() => {
    setExplanation(initialExplanation ?? null);
  }, [initialExplanation]);

  useEffect(() => {
    if (!open || explanation || !messageId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    apiFetch<AnswerExplanation>(`/chat/answers/${encodeURIComponent(messageId)}/explanation`, { token })
      .then((data) => {
        if (cancelled) return;
        setExplanation(data);
      })
      .catch((err) => {
        if (cancelled) return;
        const apiErr = err as ApiError;
        if (apiErr?.code === "NO_EXPLANATION") {
          setError("No explanation is available for this answer.");
        } else {
          setError("Explanation temporarily unavailable.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, explanation, messageId, token]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const handleViewPath = useCallback(
    (pathId: string) => {
      if (!messageId) return;
      onClose();
      router.push(`/graph?message=${encodeURIComponent(messageId)}&path=${encodeURIComponent(pathId)}`);
    },
    [messageId, onClose, router]
  );

  if (!open) return null;

  const citeFor = (indices: number[]): Citation[] => indices
    .map((n) => safeCitations.find((c) => c.index === n))
    .filter((c): c is Citation => Boolean(c));

  const renderBody = () => {
    if (loading) {
      return (
        <div className="space-y-4">
          <div className="rounded-2xl border border-rose-100 bg-white p-5">
            <Spinner label="Loading evidence…" />
            <ul className="mt-4 space-y-2 text-sm text-slate-500">
              <li>Retrieving graph evidence…</li>
              <li>Checking permissions…</li>
              <li>Loading document citations…</li>
            </ul>
          </div>
        </div>
      );
    }

    if (error) {
      return (
        <div className="rounded-2xl border border-rose-100 bg-white p-5 text-sm text-slate-600">
          {error}
          <p className="mt-2 text-xs text-slate-400">The grounded answer and its citations remain available.</p>
        </div>
      );
    }

    if (!explanation) {
      return (
        <div className="rounded-2xl border border-rose-100 bg-white p-5 text-sm text-slate-600">
          No explanation is available for this answer.
        </div>
      );
    }

    const plan = explanation.retrievalPlan;
    const strength = explanation.evidenceStrength;
    const metrics = explanation.metrics;

    return (
      <div className="space-y-3 pb-8">
        {/* Answer Summary */}
        <Section title="Answer Summary" subtitle={`Question type: ${plan.queryKind.replace(/_/g, " ")}`}>
          <div className="mb-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">“{plan.question}”</div>
          {plan.detectedEntities.length > 0 && (
            <div className="mb-2">
              <div className="mb-1 text-xs uppercase tracking-wide text-slate-500">Detected entities</div>
              <div className="flex flex-wrap gap-1.5">
                {plan.detectedEntities.map((e) => (
                  <Badge key={e} tone="violet">{e}</Badge>
                ))}
              </div>
            </div>
          )}
          {plan.searchTerms.length > 0 && (
            <div className="mb-2">
              <div className="mb-1 text-xs uppercase tracking-wide text-slate-500">Search terms</div>
              <div className="flex flex-wrap gap-1.5">
                {plan.searchTerms.map((t) => (
                  <span key={t} className="inline-flex items-center rounded-md bg-slate-800 px-2 py-0.5 text-[11px] font-medium text-white ring-1 ring-inset ring-slate-700/40">
                    {t}
                  </span>
                ))}
              </div>
            </div>
          )}
        </Section>

        {/* Evidence Strength */}
        <Section title="Evidence Strength">
          <div className="flex items-center gap-3">
            <StrengthBadge level={strength.level} />
            <span className="text-sm text-slate-600">{strength.supportingSources} supporting source(s)</span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            <MetricRow label="Graph support" value={strength.graphSupport ? "Yes" : "No"} />
            <MetricRow label="Vector support" value={strength.vectorSupport ? "Yes" : "No"} />
            <MetricRow label="Keyword support" value={strength.keywordSupport ? "Yes" : "No"} />
            <MetricRow label="Citation coverage" value={`${Math.round(strength.citationCoverage * 100)}%`} />
          </div>
          <p className="mt-3 text-xs leading-5 text-slate-400">{strength.note}</p>
        </Section>

        {/* Retrieval Journey */}
        <Section title="Retrieval Journey" subtitle="How evidence moved through the pipeline" defaultOpen={false}>
          <ol className="space-y-2">
            {explanation.pipelineMetrics.map((m, i) => (
              <li key={m.stage} className="flex items-start gap-3">
                <div className="flex w-6 flex-col items-center">
                  <span className={`flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold ${i === explanation.pipelineMetrics.length - 1 ? "bg-gradient-to-br from-pink-500 to-violet-500 text-white" : "bg-rose-100 text-rose-600"}`}>
                    {i + 1}
                  </span>
                  {i < explanation.pipelineMetrics.length - 1 && <span className="my-0.5 w-px flex-1 bg-rose-100" />}
                </div>
                <div className="min-w-0 pb-2">
                  <div className="text-sm font-medium capitalize text-slate-700">{m.stage}</div>
                  {m.note && <div className="text-xs text-slate-500">{m.note}</div>}
                  {i > 0 && <div className="mt-0.5 text-xs text-slate-400">{m.before} → {m.after}</div>}
                </div>
              </li>
            ))}
          </ol>
          <div className="mt-3 rounded-xl bg-slate-50 p-3">
            <div className="mb-1 grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs text-slate-600">
              <span>Graph candidates: <b>{metrics.graphCandidates}</b></span>
              <span>Vector candidates: <b>{metrics.vectorCandidates}</b></span>
              <span>Keyword candidates: <b>{metrics.keywordCandidates}</b></span>
              <span>After ACL filtering: <b>{metrics.afterAclFiltering}</b></span>
              <span>After fusion: <b>{metrics.afterFusion}</b></span>
              <span>After reranking: <b>{metrics.afterReranking}</b></span>
              <span>Used for answer: <b>{metrics.usedForAnswer}</b></span>
            </div>
          </div>
        </Section>

        {/* Graph Evidence */}
        <Section
          title="Graph Evidence"
          subtitle={`${explanation.graphEvidence.length} authorized relationship(s) · ${explanation.graphPaths?.length ?? 0} path(s)`}
          defaultOpen={(explanation.graphPaths?.length ?? 0) > 0 || explanation.graphEvidence.length > 0}
        >
          <GraphEvidenceView
            evidence={explanation.graphEvidence}
            paths={explanation.graphPaths ?? []}
            onViewPath={handleViewPath}
          />
        </Section>

        {/* Document Evidence */}
        <Section title="Document Evidence" subtitle={explanation.vectorEvidence.length ? `${explanation.vectorEvidence.length} authorized chunk(s)` : "None retrieved"} defaultOpen={explanation.vectorEvidence.length > 0}>
          {explanation.vectorEvidence.length === 0 && explanation.keywordEvidence.length === 0 ? (
            <div className="text-sm text-slate-500">No document evidence was used for this answer.</div>
          ) : (
            <div className="space-y-2">
              {explanation.vectorEvidence.map((v) => (
                <div key={v.chunkId} className="rounded-xl border border-rose-100 bg-white p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-slate-800">{v.documentTitle}</div>
                      {v.section && <div className="text-xs text-slate-500">Section: {v.section}</div>}
                    </div>
                    <Badge tone="green">✓ Authorized</Badge>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                    <span>Similarity <b>{v.similarity.toFixed(2)}</b></span>
                    <span>Rank <b>#{v.rank}</b></span>
                    {typeof v.page === "number" && <span>Page <b>{v.page}</b></span>}
                  </div>
                </div>
              ))}
              {explanation.keywordEvidence.map((k) => (
                <div key={`${k.documentId}:${k.chunkId}`} className="rounded-xl border border-rose-100 bg-rose-50/40 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-slate-800">{k.documentTitle}</div>
                      <div className="text-xs text-slate-500">Keyword match · Rank #{k.rank}</div>
                    </div>
                    <Badge tone="green">✓ Authorized</Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* Answer Support */}
        <Section title="Answer Support" subtitle="Claim-by-claim mapping to cited evidence">
          {explanation.answerClaims.length === 0 ? (
            <div className="text-sm text-slate-500">No claims could be mapped to citations.</div>
          ) : (
            <div className="space-y-3">
              {explanation.answerClaims.map((claim) => {
                const cited = citeFor(claim.citationIndices);
                return (
                  <div key={claim.index} className="rounded-xl border border-rose-100 bg-white p-3">
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Claim {claim.index}</span>
                      {cited.length > 0 && (
                        <span className="text-xs text-emerald-600">✓ supported</span>
                      )}
                    </div>
                    <p className="text-sm text-slate-700">{claim.text}</p>
                    {cited.length > 0 ? (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {cited.map((c) => (
                          <span key={c.index} className="inline-flex items-center gap-1 rounded-md bg-rose-50 px-2 py-0.5 text-xs text-rose-700">
                            [{c.index}] {c.documentName}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <div className="mt-2 text-xs text-slate-400">No direct citation mapped to this claim.</div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          <ClaimEvidenceFooter claims={explanation.answerClaims} />
        </Section>

        {/* Citations */}
        <Section title="Citations" subtitle={`${safeCitations.length} source(s) referenced by [n] markers`} defaultOpen={false}>
          <div className="space-y-2">
            {safeCitations.length === 0 && <div className="text-sm text-slate-500">No citations for this answer.</div>}
            {safeCitations.map((c) => (
              <div key={c.index} className="rounded-xl border border-rose-100 bg-white p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-rose-100 text-[11px] font-bold text-rose-600">[{c.index}]</span>
                    <span className="truncate text-sm font-medium text-slate-800">{c.documentName}</span>
                  </div>
                  {typeof c.page === "number" && <Badge tone="slate">p.{c.page}</Badge>}
                </div>
                {c.section && <div className="mt-1 text-xs text-slate-500">Section: {c.section}</div>}
                <p className="mt-2 text-xs leading-5 text-slate-600">“{c.text}”</p>
                <Badge tone="green">✓ Authorized for current user</Badge>
              </div>
            ))}
          </div>
        </Section>

        {/* Security & Permissions */}
        <Section title="Security & Permissions" subtitle="Fail-closed ACL verification" defaultOpen={false}>
          <div className="grid grid-cols-1 gap-1 text-sm sm:grid-cols-2">
            <SecurityRow ok={explanation.security.userAuthenticated} label="User authenticated" />
            <SecurityRow ok={explanation.security.tenantVerified} label="Tenant verified" />
            <SecurityRow ok={explanation.security.roleVerified} label="Role verified" />
            <SecurityRow ok={explanation.security.departmentVerified} label="Department access verified" />
            <SecurityRow ok={explanation.security.documentClassificationVerified} label="Document classification verified" />
            <SecurityRow ok={explanation.security.graphEvidenceAuthorized} label="Graph evidence authorized" />
            <SecurityRow ok={explanation.security.vectorEvidenceAuthorized} label="Vector evidence authorized" />
            <SecurityRow ok={explanation.security.finalEvidenceReverified} label="Final evidence re-verified" />
          </div>
          {explanation.security.excludedCount > 0 && (
            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {explanation.security.exclusionNote}
            </div>
          )}
        </Section>
      </div>
    );
  };

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[2px]" onClick={onClose} aria-hidden />
      <aside
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-lg flex-col rounded-l-2xl border-l border-rose-100 bg-[#fffaf9] shadow-2xl"
        role="dialog"
        aria-modal="true"
      >
        <header className="flex items-start justify-between gap-3 border-b border-rose-100 px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Why did AI give this answer?</h2>
            <p className="mt-0.5 text-xs text-slate-500">Trace the authorized evidence used to generate this response.</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600" aria-label="Close">
            <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5" aria-hidden>
              <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" clipRule="evenodd" fillRule="evenodd" />
            </svg>
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">{renderBody()}</div>
      </aside>
    </>
  );
}

function SecurityRow({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className={`flex h-4 w-4 items-center justify-center rounded-full text-[10px] ${ok ? "bg-emerald-100 text-emerald-600" : "bg-rose-100 text-rose-600"}`}>
        {ok ? "✓" : "✕"}
      </span>
      <span className="text-xs text-slate-600">{label}</span>
    </div>
  );
}

function ClaimEvidenceFooter({ claims }: { claims: ExplanationClaim[] }) {
  const covered = claims.filter((c) => c.citationIndices.length > 0).length;
  const pct = claims.length === 0 ? 0 : Math.round((covered / claims.length) * 100);
  return (
    <div className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
      {covered} of {claims.length} claims are backed by at least one citation ({pct}% citation coverage).
    </div>
  );
}