"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { useAuth, useRequireAuth } from "@/components/AuthProvider";
import { useToast } from "@/components/Toast";
import type { AdminGraph, AdminUser, AuditEntry, DocumentSummary, FeedbackSummary, IngestionJob, Paginated, QueryPlan } from "@/lib/types";
import { Alert, Badge, Button, Card, EmptyState, Input, Label, PageHeader, Select, Spinner, Stat, formatDate, statusTone } from "@/components/ui";

type Tab = "overview" | "users" | "documents" | "ingestion" | "feedback" | "audit" | "debug";

const TABS: { key: Tab; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "users", label: "Users" },
  { key: "documents", label: "Documents" },
  { key: "ingestion", label: "Ingestion" },
  { key: "feedback", label: "Feedback" },
  { key: "audit", label: "Audit" },
  { key: "debug", label: "Retrieval debug" }
];

export default function AdminPage() {
  useRequireAuth();
  const auth = useAuth();
  const { toast } = useToast();
  const [tab, setTab] = useState<Tab>("overview");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!error) return;
    toast({ type: "error", message: error });
  }, [error, toast]);

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <PageHeader
        title="Admin"
        subtitle="Operational view of your knowledge graph workspace."
        actions={!auth.isAdmin ? <Alert tone="amber">Admin role required for this view.</Alert> : undefined}
      />

      <div className="mb-6 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
              tab === t.key
                ? "bg-gradient-to-b from-indigo-500 to-indigo-600 text-white shadow-lg shadow-indigo-900/30"
                : "border border-white/10 bg-base-900/60 text-slate-400 hover:text-slate-200"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {auth.isAdmin && tab === "overview" && <OverviewTab onError={setError} />}
      {auth.isAdmin && tab === "users" && <UsersTab onError={setError} />}
      {auth.isAdmin && tab === "documents" && <AdminDocsTab onError={setError} />}
      {auth.isAdmin && tab === "ingestion" && <IngestionTab onError={setError} />}
      {auth.isAdmin && tab === "feedback" && <FeedbackTab onError={setError} />}
      {auth.isAdmin && tab === "audit" && <AuditTab onError={setError} />}
      {auth.isAdmin && tab === "debug" && <DebugTab onError={setError} />}
    </div>
  );
}

function useAdmin() {
  const auth = useAuth();
  return auth.token;
}

function OverviewTab({ onError }: { onError: (e: string) => void }) {
  const token = useAdmin();
  const [data, setData] = useState<AdminGraph | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch<AdminGraph>("/admin/graph", { token })
      .then(setData)
      .catch((e) => onError((e as Error).message))
      .finally(() => setLoading(false));
  }, [token, onError]);

  if (loading) return <Spinner label="Loading admin overview…" />;
  if (!data) return null;

  const pg = data.postgres;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Graph entities" value={data.neo4j.unavailable ? "—" : data.neo4j.entities} />
        <Stat label="Graph relationships" value={data.neo4j.unavailable ? "—" : data.neo4j.relationships} />
        <Stat label="Indexed documents" value={pg?.documentCount ?? 0} />
        <Stat label="Avg confidence" value={pg ? `${(pg.avgConfidence * 100).toFixed(0)}%` : "—"} />
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Orphans" value={pg?.orphanCount ?? "—"} />
        <Stat label="Duplicates" value={pg?.duplicateEntityCount ?? data.duplicates.length} />
        <Stat label="Failed extractions" value={pg?.failedExtractionCount ?? "—"} />
        <Stat label="Quick lookup λ" value="✓" accent />
      </div>
      {data.duplicates.length > 0 && (
        <Card>
          <div className="mb-2 text-sm font-medium text-slate-200">Potential duplicate entities</div>
          <div className="flex flex-wrap gap-1.5">
            {data.duplicates.slice(0, 20).map((d) => (
              <Badge key={d.name} tone="amber">
                {d.name} ×{d.count}
              </Badge>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

function UsersTab({ onError }: { onError: (e: string) => void }) {
  const token = useAdmin();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [department, setDepartment] = useState("GENERAL");
  const [roles, setRoles] = useState<string[]>(["EMPLOYEE"]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    apiFetch<{ items: AdminUser[] }>("/admin/users", { token })
      .then((r) => setUsers(r.items))
      .catch((e) => onError((e as Error).message))
      .finally(() => setLoading(false));
  }, [token, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  async function create() {
    setBusy(true);
    try {
      await apiFetch("/admin/users", { method: "POST", token, body: { name, email, department, roles } });
      setName("");
      setEmail("");
      void load();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(u: AdminUser) {
    try {
      await apiFetch(`/admin/users/${u.id}`, { method: "PATCH", token, body: { isActive: !u.isActive } });
      void load();
    } catch (e) {
      onError((e as Error).message);
    }
  }

  const ROLES = ["ADMIN", "HR", "LEGAL", "MANAGER", "EMPLOYEE", "CONTRACTOR"];
  const DEPTS = ["GENERAL", "ENGINEERING", "HR", "LEGAL", "FINANCE", "MARKETING", "SALES", "LEADERSHIP"];

  if (loading) return <Spinner label="Loading users…" />;

  return (
    <Card>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" />
        <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@company.com" />
        <Select value={department} onChange={(e) => setDepartment(e.target.value)}>
          {DEPTS.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </Select>
        <div>
          <div className="mb-1 flex flex-wrap gap-1">
            {ROLES.map((r) => (
              <button
                key={r}
                onClick={() => setRoles((prev) => (prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r]))}
                className={`rounded-md px-2 py-0.5 text-[11px] ${roles.includes(r) ? "bg-indigo-500/30 text-indigo-200" : "bg-white/5 text-slate-500"}`}
              >
                {r}
              </button>
            ))}
          </div>
          <Button onClick={() => void create()} disabled={busy || !name || !email}>
            {busy ? "Creating…" : "Create user"}
          </Button>
        </div>
      </div>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-white/10 text-xs uppercase tracking-wide text-slate-500">
              <th className="py-2 pr-3">Name</th>
              <th className="py-2 pr-3">Email</th>
              <th className="py-2 pr-3">Roles</th>
              <th className="py-2 pr-3">Dept</th>
              <th className="py-2 pr-3">Status</th>
              <th className="py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b border-white/5">
                <td className="py-2 pr-3 text-slate-200">{u.name ?? "—"}</td>
                <td className="py-2 pr-3 text-slate-400">{u.email}</td>
                <td className="py-2 pr-3">
                  <div className="flex flex-wrap gap-1">
                    {u.roles.map((r) => (
                      <Badge key={r} tone="indigo">{r}</Badge>
                    ))}
                  </div>
                </td>
                <td className="py-2 pr-3 text-slate-400">{u.department ?? "—"}</td>
                <td className="py-2 pr-3">
                  <Badge tone={u.isActive ? "green" : "rose"}>{u.isActive ? "Active" : "Inactive"}</Badge>
                </td>
                <td className="py-2">
                  <Button variant="ghost" onClick={() => void toggleActive(u)}>
                    {u.isActive ? "Disable" : "Enable"}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function AdminDocsTab({ onError }: { onError: (e: string) => void }) {
  const token = useAdmin();
  const [docs, setDocs] = useState<DocumentSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch<Paginated<DocumentSummary>>("/admin/documents", { token })
      .then((r) => setDocs(r.items))
      .catch((e) => onError((e as Error).message))
      .finally(() => setLoading(false));
  }, [token, onError]);

  if (loading) return <Spinner label="Loading documents…" />;

  return docs.length === 0 ? (
    <EmptyState title="No documents" />
  ) : (
    <Card>
      <div className="space-y-2">
        {docs.map((d) => (
          <div key={d.id} className="flex items-center justify-between gap-3 rounded-lg bg-base-900/60 px-3 py-2">
            <div className="min-w-0">
              <div className="truncate text-sm text-slate-200">{d.title}</div>
              <div className="text-[11px] text-slate-500">
                {d.chunkCount ?? 0} chunks · {d.entityCount ?? 0} entities · {d.category}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge tone={statusTone(d.status)}>{d.status}</Badge>
              <Badge tone="cyan">{d.sensitivity}</Badge>
              {d.uploadedBy && <span className="text-[11px] text-slate-600">{d.uploadedBy.email}</span>}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function IngestionTab({ onError }: { onError: (e: string) => void }) {
  const token = useAdmin();
  const [data, setData] = useState<{ jobs: IngestionJob[]; failed: number } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch<{ jobs: IngestionJob[]; failed: number }>("/admin/ingestion", { token })
      .then(setData)
      .catch((e) => onError((e as Error).message))
      .finally(() => setLoading(false));
  }, [token, onError]);

  if (loading) return <Spinner label="Loading ingestion jobs…" />;
  if (!data) return null;

  return (
    <Card>
      <div className="mb-3">
        <div className="text-2xl font-semibold text-slate-100">{data.failed}</div>
        <div className="mt-1 text-xs uppercase tracking-wide text-slate-500">Failed jobs</div>
      </div>
      <div className="space-y-2">
        {data.jobs.length === 0 && <p className="text-sm text-slate-500">No ingestion jobs yet.</p>}
        {data.jobs.map((j) => (
          <div key={j.id} className="flex items-center justify-between gap-3 rounded-lg bg-base-900/60 px-3 py-2">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm text-slate-200">{j.document.title}</span>
                <Badge tone={statusTone(j.status)}>{j.status}</Badge>
                {j.stage && <Badge tone="slate">{j.stage}</Badge>}
              </div>
              {j.error && <div className="mt-0.5 text-[11px] text-rose-400">{j.error}</div>}
            </div>
            <div className="text-right">
              <div className="text-xs text-slate-400">{j.progress}%</div>
              <div className="text-[11px] text-slate-600">{formatDate(j.completedAt ?? j.createdAt)}</div>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function FeedbackTab({ onError }: { onError: (e: string) => void }) {
  const token = useAdmin();
  const [data, setData] = useState<FeedbackSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch<FeedbackSummary>("/admin/feedback", { token })
      .then(setData)
      .catch((e) => onError((e as Error).message))
      .finally(() => setLoading(false));
  }, [token, onError]);

  if (loading) return <Spinner label="Loading feedback…" />;
  if (!data) return null;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Total" value={data.total} />
        <Stat label="Helpful" value={data.helpful} accent />
        <Stat label="Not helpful" value={data.notHelpful} />
      </div>
      {data.items.length === 0 && <EmptyState title="No feedback yet" hint="Ratings appear here as users evaluate answers." />}
      <div className="space-y-2">
        {data.items.map((f) => (
          <Card key={f.id}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <Badge tone={f.rating === "HELPFUL" ? "green" : "rose"}>{f.rating}</Badge>
                  {f.reason && <Badge tone="slate">{f.reason}</Badge>}
                  <span className="text-[11px] text-slate-600">{f.email}</span>
                </div>
                <p className="mt-2 text-sm text-slate-400">“{f.answerPreview}”</p>
              </div>
              <span className="shrink-0 text-[11px] text-slate-600">{formatDate(f.createdAt)}</span>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

function AuditTab({ onError }: { onError: (e: string) => void }) {
  const token = useAdmin();
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [action, setAction] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    apiFetch<AuditEntry[]>(`/admin/audit?limit=50${action ? `&action=${action}` : ""}`, { token })
      .then(setEntries)
      .catch((e) => onError((e as Error).message))
      .finally(() => setLoading(false));
  }, [token, action, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Card>
      <div className="mb-3 flex items-center gap-2">
        <Select value={action} onChange={(e) => setAction(e.target.value)} className="w-56">
          <option value="">All actions</option>
          {["ASK", "DOC_UPLOAD", "DOC_INDEX", "DOC_DELETE", "ACL_CHANGE", "USER_CREATE", "ROLE_CHANGE", "GRAPH_TRAVERSE", "FEEDBACK", "LOGIN", "REGISTER"].map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </Select>
        <Button variant="ghost" onClick={() => void load()}>
          Refresh
        </Button>
      </div>
      {loading ? (
        <Spinner label="Loading audit log…" />
      ) : (
        <div className="max-h-[600px] space-y-1.5 overflow-y-auto">
          {entries.map((e) => (
            <div key={e.id} className="flex items-center gap-3 rounded-lg bg-base-900/60 px-3 py-1.5 text-xs">
              <Badge tone="slate">{e.action}</Badge>
              <span className="truncate text-slate-400">{e.userId}</span>
              <span className="ml-auto shrink-0 text-slate-600">{formatDate(e.createdAt)}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function DebugTab({ onError }: { onError: (e: string) => void }) {
  const token = useAdmin();
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState<QueryPlan | null>(null);
  const [stats, setStats] = useState<Record<string, string | number> | null>(null);

  async function run() {
    if (!question.trim()) return;
    setBusy(true);
    try {
      const res = await apiFetch<{ plan: QueryPlan; vector: unknown[]; graph: unknown[]; keyword: unknown[]; reranked: unknown[]; paths: unknown[]; meta: Record<string, unknown> }>(
        `/admin/debug?question=${encodeURIComponent(question)}`,
        { token }
      );
      setPlan(res.plan);
      setStats({
        vector: (res.vector ?? []).length,
        graph: (res.graph ?? []).length,
        keyword: (res.keyword ?? []).length,
        reranked: (res.reranked ?? []).length,
        paths: (res.paths ?? []).length
      });
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex gap-2">
          <Input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Test a question and inspect the retrieval plan…" />
          <Button onClick={() => void run()} disabled={busy}>
            {busy ? "Running…" : "Debug"}
          </Button>
        </div>
      </Card>
      {stats && (
        <div className="grid grid-cols-3 gap-3 md:grid-cols-5">
          {Object.entries(stats).map(([k, v]) => (
            <Stat key={k} label={k} value={v} />
          ))}
        </div>
      )}
      {plan && (
        <Card>
          <div className="mb-2 text-sm font-medium text-slate-200">Query plan</div>
          <div className="space-y-1 text-xs text-slate-400">
            <div>
              kind: <Badge tone="indigo">{plan.kind}</Badge> · depth: {plan.maxDepth} · validation: {plan.validationErrors.length === 0 ? "passed" : plan.validationErrors.join(", ")}
            </div>
            {plan.detectedEntities.length > 0 && <div>entities: {plan.detectedEntities.join(", ")}</div>}
            <div>search terms: {plan.searchTerms.join(", ")}</div>
            <div className="flex gap-2">
              <Badge tone={plan.vectorEnabled ? "green" : "slate"}>vector {plan.vectorEnabled ? "on" : "off"}</Badge>
              <Badge tone={plan.graphEnabled ? "green" : "slate"}>graph {plan.graphEnabled ? "on" : "off"}</Badge>
              <Badge tone={plan.keywordEnabled ? "green" : "slate"}>keyword {plan.keywordEnabled ? "on" : "off"}</Badge>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}