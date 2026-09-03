"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { useAuth, useRequireAuth } from "@/components/AuthProvider";
import PageSeo from "@/components/PageSeo";
import { PageHeader, Spinner, Stat } from "@/components/ui";
import type { GraphStats } from "@/lib/types";

export default function AnalyticsPage() {
  useRequireAuth(); const auth = useAuth(); const [stats, setStats] = useState<GraphStats | null>(null);
  useEffect(() => { apiFetch<GraphStats>("/graph/stats", { token: auth.token }).then(setStats).catch(() => setStats({ entities: 0, relationships: 0, chunks: 0, documents: 0 })); }, [auth.token]);
  if (!stats) return <div className="p-8"><Spinner label="Loading analytics…"/></div>;
  return (<>
    <PageSeo title="Analytics" description="Knowledge graph analytics — entity, relationship, document and chunk coverage metrics for your authorized graph." keywords={["analytics", "knowledge graph metrics", "RAG statistics", "entity coverage"]} />
    <div className="mx-auto max-w-6xl px-6 py-8"><PageHeader title="Analytics" subtitle="A snapshot of your authorized knowledge graph."/><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><Stat label="Entities" value={stats.entities}/><Stat label="Relationships" value={stats.relationships}/><Stat label="Documents" value={stats.documents}/><Stat label="Indexed chunks" value={stats.chunks}/></div><section className="mt-6 rounded-2xl border border-rose-100 bg-white p-6 shadow-sm"><h2 className="font-semibold text-slate-900">Knowledge graph coverage</h2><p className="mt-2 text-sm text-slate-600">These metrics reflect only documents and graph data you are authorized to access.</p><div className="mt-6 grid grid-cols-4 items-end gap-4">{[stats.documents, stats.chunks, stats.entities, stats.relationships].map((value, index) => <div key={index}><div className="rounded-t-lg bg-gradient-to-t from-rose-500 to-pink-300" style={{ height: `${Math.max(24, Math.min(180, value ? Math.log10(value + 1) * 58 : 24))}px` }}/><div className="mt-2 text-center text-xs text-slate-500">{["Documents", "Chunks", "Entities", "Relations"][index]}</div></div>)}</div></section></div>
  </>);
}
