"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch, apiUrl } from "@/lib/api";
import { useAuth, useRequireAuth } from "@/components/AuthProvider";
import { useToast } from "@/components/Toast";
import type { DocumentSummary, Paginated } from "@/lib/types";
import { Alert, Badge, Button, Card, EmptyState, formatBytes, formatDate, Input, Label, PageHeader, Select, Spinner, statusTone } from "@/components/ui";

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
  const { toast } = useToast();

  const [docs, setDocs] = useState<DocumentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("HR_POLICY");
  const [uploading, setUploading] = useState(false);

  const [aclDraft, setAclDraft] = useState<Record<string, AclDraft>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [processing, setProcessing] = useState<Record<string, boolean>>({});
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [documentQuery, setDocumentQuery] = useState("");
  const [sensitivityFilter, setSensitivityFilter] = useState("ALL");

  const visibleDocs = useMemo(() => {
    const query = documentQuery.trim().toLowerCase();
    return docs.filter((doc) => {
      const matchesQuery = !query || [doc.title, doc.category, doc.status, doc.sensitivity, doc.uploadedBy?.email]
        .filter(Boolean)
        .some((value) => value?.toLowerCase().includes(query));
      return matchesQuery && (sensitivityFilter === "ALL" || doc.sensitivity === sensitivityFilter);
    });
  }, [docs, documentQuery, sensitivityFilter]);

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

  async function pollUntilSettled(id: string, successMessage: string) {
    const deadline = Date.now() + 10 * 60 * 1000;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 2500));
      try {
        const res = await apiFetch<Paginated<DocumentSummary>>("/documents", { token: auth.token });
        setDocs(res.items);
        const doc = res.items.find((x) => x.id === id);
        if (doc && doc.status !== "PROCESSING" && doc.status !== "UPLOADED") {
          if (doc.status === "FAILED") {
            toast({ type: "error", message: `Processing failed for “${doc.title}”.` });
          } else {
            toast({ type: "success", message: successMessage });
          }
          return;
        }
      } catch {
        return;
      }
    }
    toast({ type: "error", message: "Processing is taking longer than expected. Refresh and check the document status." });
  }

  async function indexDocument(id: string) {
    setError(null);
    setProcessing((prev) => ({ ...prev, [id]: true }));
    try {
      await apiFetch(`/documents/${id}/index`, { method: "POST", token: auth.token });
      await pollUntilSettled(id, "Document indexed successfully.");
    } catch (err) {
      toast({ type: "error", message: (err as Error).message });
    } finally {
      setProcessing((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      void load();
    }
  }

  async function saveAcl(id: string) {
    const draft = aclDraft[id];
    if (!draft) return;
    setSaving(id);
    setError(null);
    try {
      await apiFetch<{ id: string }>(`/documents/${id}/reclassify`, { method: "POST", token: auth.token, body: draft });
      setSaving(null);
      setProcessing((prev) => ({ ...prev, [id]: true }));
      await pollUntilSettled(id, "Document reclassified and reindexed.");
    } catch (err) {
      toast({ type: "error", message: (err as Error).message });
    } finally {
      setSaving(null);
      setProcessing((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      void load();
    }
  }

  async function deleteDocument(id: string) {
    setDeleting(id);
    setError(null);
    try {
      await apiFetch(`/documents/${id}`, { method: "DELETE", token: auth.token });
      setConfirmDelete(null);
      const title = docs.find((d) => d.id === id)?.title ?? "Document";
      toast({ type: "success", message: `“${title}” permanently deleted.` });
      void load();
    } catch (err) {
      toast({ type: "error", message: (err as Error).message });
    } finally {
      setDeleting(null);
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
      <PageHeader
        title="Documents"
        subtitle="Upload and classify your company documents. Access control is enforced per document."
      />

      <div className="mb-5 flex flex-col gap-2 sm:flex-row">
        <div className="relative min-w-0 flex-1">
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <Input value={documentQuery} onChange={(e) => setDocumentQuery(e.target.value)} className="pl-9" placeholder="Search documents, categories, or access status…" aria-label="Search documents" />
        </div>
        <Select value={sensitivityFilter} onChange={(e) => setSensitivityFilter(e.target.value)} className="sm:w-44" aria-label="Filter by sensitivity">
          <option value="ALL">All access levels</option>
          {SENSITIVITY.map((level) => <option key={level} value={level}>{level}</option>)}
        </Select>
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
              className="w-full rounded-lg border border-white/10 bg-base-950 p-2 text-sm text-slate-300 file:mr-3 file:rounded-md file:border-0 file:bg-slate-800 file:px-3 file:py-1.5 file:text-sm file:text-slate-200"
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
      ) : visibleDocs.length === 0 ? (
        <EmptyState icon="⌕" title="No matching documents" hint="Try a different name, category, or access-level filter." />
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between px-1 text-xs text-slate-500">
            <span>{visibleDocs.length} of {docs.length} documents</span>
            {(documentQuery || sensitivityFilter !== "ALL") && <button onClick={() => { setDocumentQuery(""); setSensitivityFilter("ALL"); }} className="text-indigo-300 hover:text-indigo-200">Clear filters</button>}
          </div>
          {visibleDocs.map((d) => {
            const draft = aclDraft[d.id] ?? { allowedRoles: d.acl?.allowedRoles ?? [], allowedDepartments: d.acl?.allowedDepartments ?? [], sensitivity: d.acl?.sensitivity ?? "INTERNAL" };
            return (
              <div key={d.id} className="rounded-xl border border-white/10 bg-surface/70 p-4 backdrop-blur-sm">
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
                    {d.status === "INDEXED" ? (
                      <Badge tone="green">Indexed ✓</Badge>
                    ) : (
                      <Button onClick={() => void indexDocument(d.id)} disabled={d.status === "PROCESSING" || processing[d.id]}>
                        {d.status === "PROCESSING" || processing[d.id] ? (
                          <>
                            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/50 border-t-white" />
                            Indexing…
                          </>
                        ) : (
                          "Index"
                        )}
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
                  <div className="mt-4 border-t border-white/10 pt-3">
                    <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Classify access (admin)</div>
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                      <div>
                        <div className="mb-1 text-xs text-slate-400">Allowed roles</div>
                        <div className="flex flex-wrap gap-1">
                          {ROLES.map((r) => (
                            <button
                              key={r}
                              onClick={() => toggleRole(d.id, r)}
                              className={`rounded-md px-2 py-0.5 text-[11px] transition ${draft.allowedRoles.includes(r) ? "bg-indigo-500/30 text-indigo-200" : "bg-white/5 text-slate-500 hover:text-slate-300"}`}
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
                              className={`rounded-md px-2 py-0.5 text-[11px] transition ${draft.allowedDepartments.includes(dep) ? "bg-cyan-500/30 text-cyan-200" : "bg-white/5 text-slate-500 hover:text-slate-300"}`}
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
                        disabled={saving === d.id || processing[d.id]}
                        className="bg-emerald-600 hover:bg-emerald-500"
                      >
                        {saving === d.id || processing[d.id] ? (
                          <>
                            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/50 border-t-white" />
                            {saving === d.id ? "Saving…" : "Reindexing…"}
                          </>
                        ) : (
                          "Save classification (reindexes)"
                        )}
                      </Button>
                    </div>
                  </div>
                )}

              </div>
            );
          })}
        </div>
      )}

      {confirmDelete && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-lg font-semibold text-slate-900">Delete document</h2>
              <button onClick={() => setConfirmDelete(null)} className="text-slate-400 transition hover:text-slate-600" aria-label="Close">
                <span aria-hidden="true" className="text-xl leading-none">×</span>
              </button>
            </div>
            <p className="mt-1 text-sm text-slate-600">
              {(() => {
                const d = docs.find((x) => x.id === confirmDelete);
                return d ? `“${d.title}”` : "This document";
              })()}{" "}
              and all of its chunks, graph entities, relationships, vectors, and the uploaded file will be{" "}
              <span className="font-semibold text-rose-700">permanently deleted</span>. This cannot be undone.
            </p>
            <div className="mt-6 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setConfirmDelete(null)} disabled={deleting === confirmDelete}>
                Cancel
              </Button>
              <Button variant="danger" onClick={() => void deleteDocument(confirmDelete)} disabled={deleting === confirmDelete}>
                {deleting === confirmDelete ? (
                  <>
                    <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/50 border-t-white" />
                    Deleting…
                  </>
                ) : (
                  "Delete permanently"
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
