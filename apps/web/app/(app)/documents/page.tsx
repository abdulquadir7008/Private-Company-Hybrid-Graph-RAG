"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch, apiUrl } from "@/lib/api";
import { useAuth, useRequireAuth } from "@/components/AuthProvider";
import type { DocumentSummary, Paginated } from "@/lib/types";
import { Alert, Badge, Button, Card, EmptyState, formatBytes, formatDate, Input, Label, Select, Spinner, statusTone } from "@/components/ui";

const CATEGORIES = ["HR_POLICY", "PRODUCT", "TECHNICAL", "LEGAL", "TRAINING", "OTHER"];
const ROLES = ["ADMIN", "HR", "LEGAL", "MANAGER", "EMPLOYEE", "CONTRACTOR"];
const DEPARTMENTS = ["GENERAL", "ENGINEERING", "HR", "LEGAL", "FINANCE", "MARKETING", "SALES", "LEADERSHIP"];
const SENSITIVITY = ["PUBLIC", "INTERNAL", "CONFIDENTIAL", "RESTRICTED"];

interface AclDraft {
  allowedRoles: string[];
  allowedDepartments: string[];
  sensitivity: string;
}

export default function DocumentsPage() {
  useRequireAuth();
  const auth = useAuth();
  const admin = auth.isAdmin;

  const [docs, setDocs] = useState<DocumentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("HR_POLICY");
  const [uploading, setUploading] = useState(false);

  const [aclDraft, setAclDraft] = useState<Record<string, AclDraft>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch<Paginated<DocumentSummary>>("/documents", { token: auth.token });
      setDocs(res.items);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [auth.token]);

  useEffect(() => {
    if (auth.token) void load();
  }, [auth.token, load]);

  async function onUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setUploading(true);
    setError(null);
    const form = new FormData();
    form.append("file", file);
    form.append("title", title || file.name.replace(/\.[^.]+$/, ""));
    form.append("category", category);
    try {
      await fetch(apiUrl("/documents"), { method: "POST", headers: { Authorization: `Bearer ${auth.token}` }, body: form });
      setFile(null);
      setTitle("");
      void load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUploading(false);
    }
  }

  async function indexDocument(id: string) {
    setError(null);
    try {
      await apiFetch(`/documents/${id}/index`, { method: "POST", token: auth.token });
      void load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function saveAcl(id: string) {
    const draft = aclDraft[id];
    if (!draft) return;
    setSaving(id);
    setError(null);
    try {
      await apiFetch(`/documents/${id}/reclassify`, { method: "POST", token: auth.token, body: draft });
      void load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(null);
    }
  }

  async function deleteDocument(id: string) {
    setError(null);
    try {
      await apiFetch(`/documents/${id}`, { method: "DELETE", token: auth.token });
      setConfirmDelete(null);
      void load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  function toggleRole(id: string, role: string) {
    setAclDraft((prev) => {
      const cur = prev[id] ?? { allowedRoles: [], allowedDepartments: [], sensitivity: "INTERNAL" };
      const roles = cur.allowedRoles.includes(role) ? cur.allowedRoles.filter((r) => r !== role) : [...cur.allowedRoles, role];
      return { ...prev, [id]: { ...cur, allowedRoles: roles } };
    });
  }

  function toggleDept(id: string, dept: string) {
    setAclDraft((prev) => {
      const cur = prev[id] ?? { allowedRoles: [], allowedDepartments: [], sensitivity: "INTERNAL" };
      const deps = cur.allowedDepartments.includes(dept) ? cur.allowedDepartments.filter((d) => d !== dept) : [...cur.allowedDepartments, dept];
      return { ...prev, [id]: { ...cur, allowedDepartments: deps } };
    });
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">Documents</h1>
          <p className="mt-1 text-sm text-slate-500">Upload and classify your company documents. Access control is enforced per document.</p>
        </div>
      </div>

      {error && (
        <div className="mb-4">
          <Alert tone="rose">{error}</Alert>
        </div>
      )}

      <Card className="mb-8">
        <form onSubmit={onUpload} className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <div className="md:col-span-2">
            <Label>File (pdf / docx / txt / md)</Label>
            <input
              type="file"
              accept=".pdf,.docx,.doc,.txt,.md,.csv,.json"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="w-full rounded-lg border border-slate-800 bg-ink-950 p-2 text-sm text-slate-300 file:mr-3 file:rounded-md file:border-0 file:bg-slate-800 file:px-3 file:py-1.5 file:text-sm file:text-slate-200"
            />
          </div>
          <div>
            <Label>Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Employee Handbook" />
          </div>
          <div>
            <Label>Category</Label>
            <Select value={category} onChange={(e) => setCategory(e.target.value)}>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </div>
          <div className="md:col-span-4">
            <Button type="submit" disabled={uploading || !file || !auth.isAdmin}>
              {uploading ? "Uploading…" : auth.isAdmin ? "Upload document" : "Only admins can upload"}
            </Button>
          </div>
        </form>
      </Card>

      {loading ? (
        <Spinner label="Loading documents…" />
      ) : docs.length === 0 ? (
        <EmptyState icon="📄" title="No documents yet" hint="Upload your first document to start building the knowledge graph." />
      ) : (
        <div className="space-y-3">
          {docs.map((d) => {
            const draft = aclDraft[d.id] ?? { allowedRoles: d.acl?.allowedRoles ?? [], allowedDepartments: d.acl?.allowedDepartments ?? [], sensitivity: d.acl?.sensitivity ?? "INTERNAL" };
            return (
              <div key={d.id} className="rounded-xl border border-slate-800 bg-ink-900 p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-slate-100">{d.title}</span>
                      <Badge tone="slate">{d.category}</Badge>
                      <Badge tone={statusTone(d.status)}>{d.status}</Badge>
                      <Badge tone={d.sensitivity === "RESTRICTED" || d.sensitivity === "CONFIDENTIAL" ? "rose" : "cyan"}>{d.sensitivity}</Badge>
                    </div>
                    <div className="mt-1.5 text-xs text-slate-500">
                      {formatBytes(d.sizeBytes)} · {d.chunkCount ?? 0} chunks · {d.entityCount ?? 0} entities · uploaded {formatDate(d.createdAt)} {d.uploadedBy ? `by ${d.uploadedBy.email}` : ""}
                    </div>
                    {d.acl && (
                      <div className="mt-1.5 flex flex-wrap gap-1 text-[11px]">
                        <span className="text-slate-600">access:</span>
                        {(d.acl.allowedRoles.length > 0 || d.acl.allowedDepartments.length > 0) && (
                          <>
                            {d.acl.allowedRoles.map((r) => (
                              <Badge key={r} tone="indigo">{r}</Badge>
                            ))}
                            {d.acl.allowedDepartments.map((dep) => (
                              <Badge key={dep} tone="cyan">{dep}</Badge>
                            ))}
                          </>
                        )}
                        {d.acl.allowedRoles.length === 0 && d.acl.allowedDepartments.length === 0 && <span className="text-slate-600">admin-only (fail-closed)</span>}
                      </div>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {d.status !== "INDEXED" && (
                      <Button onClick={() => void indexDocument(d.id)} disabled={d.status === "PROCESSING"}>
                        {d.status === "PROCESSING" ? "Indexing…" : "Index"}
                      </Button>
                    )}
                    {admin && (
                      <Button variant="danger" onClick={() => setConfirmDelete(d.id)}>
                        Delete
                      </Button>
                    )}
                  </div>
                </div>

                {admin && (
                  <div className="mt-4 border-t border-slate-800 pt-3">
                    <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Classify access (admin)</div>
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                      <div>
                        <div className="mb-1 text-xs text-slate-400">Allowed roles</div>
                        <div className="flex flex-wrap gap-1">
                          {ROLES.map((r) => (
                            <button
                              key={r}
                              onClick={() => toggleRole(d.id, r)}
                              className={`rounded-md px-2 py-0.5 text-[11px] transition ${draft.allowedRoles.includes(r) ? "bg-indigo-500/30 text-indigo-200" : "bg-slate-800 text-slate-500 hover:text-slate-300"}`}
                            >
                              {r}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div>
                        <div className="mb-1 text-xs text-slate-400">Allowed departments</div>
                        <div className="flex flex-wrap gap-1">
                          {DEPARTMENTS.map((dep) => (
                            <button
                              key={dep}
                              onClick={() => toggleDept(d.id, dep)}
                              className={`rounded-md px-2 py-0.5 text-[11px] transition ${draft.allowedDepartments.includes(dep) ? "bg-cyan-500/30 text-cyan-200" : "bg-slate-800 text-slate-500 hover:text-slate-300"}`}
                            >
                              {dep}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div>
                        <Label>Sensitivity</Label>
                        <Select value={draft.sensitivity} onChange={(e) => setAclDraft((prev) => ({ ...prev, [d.id]: { ...draft, sensitivity: e.target.value } }))}>
                          {SENSITIVITY.map((s) => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          ))}
                        </Select>
                      </div>
                    </div>
                    <div className="mt-3 flex justify-end gap-2">
                      <Button
                        onClick={() => void saveAcl(d.id)}
                        disabled={saving === d.id}
                        className="bg-emerald-600 hover:bg-emerald-500"
                      >
                        {saving === d.id ? "Saving…" : "Save classification (reindexes)"}
                      </Button>
                    </div>
                  </div>
                )}

                {confirmDelete === d.id && (
                  <div className="mt-3 rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm">
                    <span className="text-rose-200">Permanently delete “{d.title}” and its graph/vectors? This cannot be undone.</span>
                    <div className="mt-2 flex gap-2">
                      <Button variant="danger" onClick={() => void deleteDocument(d.id)}>
                        Delete permanently
                      </Button>
                      <Button onClick={() => setConfirmDelete(null)}>Cancel</Button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}