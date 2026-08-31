"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/api";
import type { ChatResponse, Citation, GraphRelationship, GraphPath } from "@/lib/types";
import { Badge, Button, formatDate } from "@/components/ui";

type GraphEvidence = { relationships?: GraphRelationship[]; paths?: GraphPath[] };

interface Props {
  question: string;
  answer: string;
  citations?: Citation[] | null;
  graphEvidence?: GraphEvidence | null;
  entities?: string[];
  grounded?: boolean;
  confidence?: number | null;
  messageId?: string | null;
  createdAt?: string | null;
}

export function renderMarkdownLinks(text: string): string {
  // Minimal markdown-ish formatting for inline [1] citation tokens only.
  return text;
}

function withCitations(text: string, citations: Citation[] | null | undefined) {
  const parts = text.split(/\[(\d+)\]/g);
  if (parts.length === 1) return text;
  const nodes: React.ReactNode[] = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (i % 2 === 1) {
      const idx = parseInt(part, 10);
      const cite = citations?.find((c) => c.index === idx);
      nodes.push(
        <a key={`c-${i}`} href={`#cite-${idx}`} className="cite-link" title={cite ? cite.documentName : undefined}>
          {idx}
        </a>
      );
    } else if (part.length > 0) {
      nodes.push(part);
    }
  }
  return nodes;
}

function CitationChevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="currentColor"
      className={`h-4 w-4 shrink-0 text-slate-500 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
      aria-hidden
    >
      <path
        fillRule="evenodd"
        d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.17l3.71-3.94a.75.75 0 1 1 1.08 1.04l-4.25 4.5a.75.75 0 0 1-1.08 0l-4.25-4.5a.75.75 0 0 1 .02-1.06Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

interface CitationGroup {
  documentId: string;
  documentName: string;
  items: Citation[];
}

export default function MessageView({
  question,
  answer,
  citations = [],
  graphEvidence,
  entities = [],
  grounded,
  confidence,
  messageId,
  createdAt
}: Props) {
  const [feedback, setFeedback] = useState<string | null>(null);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [openDocs, setOpenDocs] = useState<Record<string, boolean>>({});

  async function sendFeedback(rating: "HELPFUL" | "NOT_HELPFUL") {
    if (!messageId) return;
    try {
      await apiFetch("/chat/feedback", { method: "POST", body: { messageId, rating } });
      setFeedback(rating);
    } catch {
      setFeedback("error");
    }
  }

  const rels = graphEvidence?.relationships ?? [];

  // Group citations by source document so the same doc isn't listed repeatedly.
  const grouped: CitationGroup[] = [];
  for (const c of citations ?? []) {
    const key = c.documentId || c.documentName;
    let g = grouped.find((gr) => gr.documentId === key);
    if (!g) {
      g = { documentId: key, documentName: c.documentName, items: [] };
      grouped.push(g);
    }
    g.items.push(c);
  }

  const openDoc = (id: string) => openDocs[id] ?? false;
  const toggleDoc = (id: string) => setOpenDocs((prev) => ({ ...prev, [id]: !prev[id] }));

  return (
    <div>
      {/* Question */}
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-indigo-600 px-4 py-2.5 text-sm text-white">{question}</div>
      </div>

      {/* Answer */}
      <div className="mt-4 flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-800 text-[11px] text-slate-300">Gr</div>
            <span className="text-xs font-medium text-slate-400">Graph RAG</span>
            {typeof grounded === "boolean" && (
              <Badge tone={grounded ? "green" : "amber"}>{grounded ? "Grounded" : "Low confidence"}</Badge>
            )}
            {typeof confidence === "number" && (
              <Badge tone="indigo">{(confidence * 100).toFixed(0)}%</Badge>
            )}
            {createdAt && <span className="text-[11px] text-slate-600">{formatDate(createdAt)}</span>}
          </div>
          {messageId && feedback === null && (
            <div className="flex items-center gap-1">
              <button onClick={() => sendFeedback("HELPFUL")} className="rounded-md px-2 py-1 text-xs text-slate-400 hover:bg-slate-800 hover:text-emerald-300" title="Helpful">
                👍
              </button>
              <button onClick={() => sendFeedback("NOT_HELPFUL")} className="rounded-md px-2 py-1 text-xs text-slate-400 hover:bg-slate-800 hover:text-rose-300" title="Not helpful">
                👎
              </button>
            </div>
          )}
          {feedback === "HELPFUL" && <span className="text-xs text-emerald-400">✓ Feedback recorded</span>}
          {feedback === "NOT_HELPFUL" && <span className="text-xs text-amber-400">Feedback recorded</span>}
          {feedback === "error" && <span className="text-xs text-rose-400">Failed to record</span>}
        </div>

        <div className="markdown-body whitespace-pre-wrap rounded-xl border border-slate-800 bg-ink-900 p-4">
          {withCitations(answer, citations)}
        </div>

        {/* Graph evidence for this answer */}
        {rels.length > 0 && (
          <div className="rounded-xl border border-slate-800 bg-ink-900">
            <button
              onClick={() => setSourcesOpen((o) => !o)}
              className="flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-left hover:bg-slate-800/40"
            >
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Knowledge graph evidence <span className="text-slate-600">({rels.length})</span>
              </span>
              <CitationChevron open={sourcesOpen} />
            </button>
            {sourcesOpen && (
              <div className="flex flex-wrap items-center gap-1.5 border-t border-slate-800 px-3 py-3 text-xs">
                {rels.slice(0, 8).map((r, i) => (
                  <span key={r.rid ?? i} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-800/70 px-2 py-1 text-slate-300">
                    {r.source?.name}
                    <span className="text-[10px] font-semibold text-indigo-300">{r.type}</span>
                    {r.target?.name}
                  </span>
                ))}
                {rels.length > 8 && <span className="text-slate-500">+{rels.length - 8} more</span>}
              </div>
            )}
          </div>
        )}

        {/* Citations — collapsed accordion grouped by source document */}
        {citations && citations.length > 0 && (
          <div className="rounded-xl border border-slate-800 bg-ink-900">
            <button
              onClick={() => setSourcesOpen((o) => !o)}
              className="flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-left hover:bg-slate-800/40"
            >
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Sources <span className="text-slate-600">({grouped.length} {grouped.length === 1 ? "document" : "documents"})</span>
                {entities.length > 0 && (
                  <span className="ml-2 normal-case text-slate-600">entities: {entities.join(", ")}</span>
                )}
              </span>
              <CitationChevron open={sourcesOpen} />
            </button>

            {sourcesOpen && (
              <div className="space-y-2 border-t border-slate-800 p-3">
                {grouped.map((group) => {
                  const isOpen = openDoc(group.documentId);
                  return (
                    <div key={group.documentId} className="overflow-hidden rounded-lg border border-slate-800/70 bg-slate-900/40">
                      {/* Document header row — click to expand/collapse */}
                      <button
                        onClick={() => toggleDoc(group.documentId)}
                        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-slate-800/40"
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          <CitationChevron open={isOpen} />
                          <span className="truncate text-xs font-medium text-slate-200">{group.documentName}</span>
                        </div>
                        <span className="shrink-0 text-[10px] text-slate-500">
                          {group.items.length} {group.items.length === 1 ? "match" : "matches"}
                        </span>
                      </button>

                      {isOpen && (
                        <div className="space-y-2 border-t border-slate-800/70 p-2.5">
                          {group.items.map((c) => (
                            <div key={c.index} id={`cite-${c.index}`} className="rounded-md bg-ink-950/60 p-2.5">
                              <div className="mb-1 flex items-center justify-between gap-2">
                                <div className="text-[10px] text-slate-500">Citation {c.index}</div>
                                <div className="flex gap-1 text-[10px] text-slate-500">
                                  {c.section && <span className="rounded bg-slate-800 px-1 py-0.5">{c.section}</span>}
                                  {typeof c.page === "number" && <span className="rounded bg-slate-800 px-1 py-0.5">p.{c.page}</span>}
                                </div>
                              </div>
                              <p className="text-xs leading-5 text-slate-400">“{c.text}”</p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}