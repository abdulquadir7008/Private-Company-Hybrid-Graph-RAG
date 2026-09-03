"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { useAuth, useRequireAuth } from "@/components/AuthProvider";
import PageSeo from "@/components/PageSeo";
import { Alert, EmptyState, PageHeader, Spinner, formatDate } from "@/components/ui";
import type { AuditEntry } from "@/lib/types";

export default function AuditLogsPage() {
  useRequireAuth(); const auth = useAuth(); const [items, setItems] = useState<AuditEntry[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState<string | null>(null);
  useEffect(() => { apiFetch<{ items: AuditEntry[] }>("/admin/audit", { token: auth.token }).then((data) => setItems(data.items)).catch((err) => setError(err instanceof Error ? err.message : "Unable to load audit logs")).finally(() => setLoading(false)); }, [auth.token]);
  return (<>
    <PageSeo title="Audit Logs" description="Review security-sensitive audit events across your private knowledge graph workspace." keywords={["audit logs", "security events", "activity log", "compliance"]} />
    <div className="mx-auto max-w-6xl px-6 py-8"><PageHeader title="Audit logs" subtitle="Review security-sensitive events in your workspace."/>{error && <Alert tone="amber">{error}</Alert>}{loading ? <Spinner label="Loading audit logs…"/> : items.length === 0 ? <EmptyState icon="◉" title="No audit events found"/> : <div className="mt-5 overflow-hidden rounded-2xl border border-rose-100 bg-white shadow-sm"><div className="grid grid-cols-[1.2fr_1fr_1fr] border-b border-rose-100 bg-rose-50/60 px-5 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500"><span>Action</span><span>User</span><span>Time</span></div>{items.map((item) => <div key={item.id} className="grid grid-cols-[1.2fr_1fr_1fr] border-b border-rose-50 px-5 py-4 text-sm last:border-0"><span className="font-medium text-slate-800">{item.action}</span><span className="text-slate-600">{item.userId ?? "System"}</span><span className="text-slate-500">{formatDate(item.createdAt)}</span></div>)}</div>}</div>
  </>);
}
