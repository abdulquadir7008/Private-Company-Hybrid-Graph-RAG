"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/components/AuthProvider";
import { Button, Input, Select, Label, Badge, Alert, Spinner } from "@/components/ui";
import type { LlmConfigState, LlmModel, LlmProviderId, LlmProviderMeta, ModelTier } from "@/lib/types";

const PROVIDER_TIER_LABEL = { freetier: "Free tier", paid: "Paid", local: "Local" } as const;
const PROVIDER_TIER_BADGE = { freetier: "green", paid: "amber", local: "indigo" } as const;

const TIER_META: Record<ModelTier, { label: string; cls: string }> = {
  free: { label: "Free", cls: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30" },
  freetier: { label: "Free tier", cls: "bg-indigo-500/15 text-indigo-300 ring-indigo-500/30" },
  paid: { label: "Paid", cls: "bg-amber-500/15 text-amber-300 ring-amber-500/30" }
};

function TierBadge({ tier }: { tier: ModelTier }) {
  const m = TIER_META[tier];
  return <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${m.cls}`}>{m.label}</span>;
}

/** Modal dialog shown after first login when no provider is configured yet. */
export function LlmSetupModal({
  title = "Connect your AI provider",
  subtitle = "Use your own API key, model, and provider (we never provide one). You can switch among saved providers at any time; only one is active at a time.",
  onDismiss
}: {
  title?: string;
  subtitle?: string;
  onDismiss?: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4 backdrop-blur-sm sm:py-8" role="dialog" aria-modal="true">
      <div className="relative w-full max-w-lg rounded-2xl border border-rose-100 bg-white p-6 shadow-2xl sm:p-7">
        <div className="mb-1 flex items-start justify-between gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-pink-500 to-violet-500 text-white shadow-lg shadow-rose-200">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
            </svg>
          </div>
          {onDismiss && (
            <button onClick={onDismiss} aria-label="Close" className="rounded-lg p-1.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
        <h2 className="mt-2 text-lg font-semibold tracking-tight text-slate-900">{title}</h2>
        <p className="mt-1 text-sm text-slate-600">{subtitle}</p>
        <div className="mt-5">
          <LlmConfigForm onSaved={onDismiss} />
        </div>
        <p className="mt-4 rounded-lg border border-rose-100 bg-rose-50/60 px-3 py-2 text-xs text-slate-600">
          Your API key is encrypted at rest and never stored in plaintext or returned to this browser.
        </p>
      </div>
    </div>
  );
}

/**
 * Shared, self-contained form to configure the caller's own LLM/API provider.
 * Used by both the first-login setup modal and the account settings drawer.
 */
export function LlmConfigForm({
  onSaved
}: {
  onSaved?: (state: LlmConfigState) => void;
}) {
  const auth = useAuth();
  const token = auth.token;
  const setReindexing = auth.setReindexing;
  const [catalog, setCatalog] = useState<LlmProviderMeta[]>([]);
  const [config, setConfig] = useState<LlmConfigState | null>(null);

  const [provider, setProvider] = useState<LlmProviderId>("openai");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [embeddingModel, setEmbeddingModel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");

  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Load catalog + current config.
  useEffect(() => {
    if (!token) return;
    let alive = true;
    (async () => {
      try {
        const [cat, cfg] = await Promise.all([
          apiFetch<LlmProviderMeta[]>("/llm/catalog", { token }),
          apiFetch<LlmConfigState>("/llm/config", { token })
        ]);
        if (!alive) return;
        setCatalog(cat);
        setConfig(cfg);
        if (cat.length > 0) {
          const active = cfg.activeProvider ?? cat[0].id;
          setProvider(active);
          const metaFor = cat.find((p) => p.id === active);
          const saved = cfg.providers[active];
          const defaultFor = metaFor?.models[0]?.id ?? "";
          // Catalogs change as providers retire models. Never leave a stale
          // saved model selected, as it would make Test connection fail before
          // the user can choose a valid replacement.
          setModel(metaFor?.models.some((item) => item.id === saved?.model) ? saved!.model : defaultFor);
          setEmbeddingModel(saved?.embeddingModel || metaFor?.defaultEmbeddingModel || "");
          setBaseUrl(saved?.baseUrl ?? metaFor?.openAiCompatibleBaseUrl ?? "");
        }
      } catch (err) {
        if (alive) setError((err as Error).message);
      }
    })();
    return () => {
      alive = false;
    };
  }, [token]);

  const activeMeta = useMemo(() => catalog.find((p) => p.id === provider) ?? null, [catalog, provider]);
  const chatModels = useMemo(() => activeMeta?.models ?? [], [activeMeta]);
  const hasEmbedding = (activeMeta?.supportsEmbedding ?? false) === true;
  const needsKey = activeMeta?.needsApiKey ?? true;

  const pickProvider = useCallback(
    (id: LlmProviderId) => {
      setProvider(id);
      const meta = catalog.find((p) => p.id === id);
      const saved = config?.providers[id];
      setModel(meta?.models.some((item) => item.id === saved?.model) ? saved!.model : meta?.models[0]?.id || "");
      setEmbeddingModel(saved?.embeddingModel || meta?.defaultEmbeddingModel || "");
      setBaseUrl(saved?.baseUrl ?? meta?.openAiCompatibleBaseUrl ?? "");
      setApiKey("");
      setShowApiKey(false);
      setError(null);
      setNotice(null);
    },
    [catalog, config]
  );

  const testConnection = useCallback(async () => {
    if (!token) return;
    setTesting(true);
    setError(null);
    setNotice(null);
    try {
      const res = await apiFetch<{ ok: boolean; message?: string; error?: string }>("/llm/test", {
        token,
        method: "POST",
        body: {
          provider,
          model,
          apiKey,
          embeddingModel,
          baseUrl: baseUrl || undefined
        }
      });
      if (res.ok) setNotice(res.message ?? "Connected.");
      else setError(res.error ?? "Connection failed.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setTesting(false);
    }
  }, [token, provider, model, apiKey, embeddingModel, baseUrl]);

  const saveAndActivate = useCallback(async () => {
    if (!token) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      // If the provider is already configured with a saved key and none is
      // typed now, omit apiKey to keep the stored (encrypted) key.
      const alreadyConfigured = config?.providers[provider]?.configured;
      const res = await apiFetch<LlmConfigState & { reindexing?: boolean }>("/llm/config", {
        token,
        method: "PUT",
        body: {
          provider,
          model,
          ...(apiKey ? { apiKey } : alreadyConfigured ? {} : {}),
          embeddingModel,
          baseUrl: baseUrl || undefined
        }
      });
      const state: LlmConfigState = { activeProvider: res.activeProvider, providers: res.providers };
      setConfig(state);
      auth.setLlmConfigState(state);

      // If the embedding model changed, the backend is reindexing all
      // documents. Show a loading overlay until the batch finishes (detected
      // by polling document statuses) so the user sees progress.
      if (res.reindexing) {
        setReindexing(true);
        await waitForReindex(token);
        setReindexing(false);
      }

      onSaved?.(state);
      setNotice(`${activeMeta?.label ?? provider} is now your active provider.`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }, [token, provider, model, apiKey, embeddingModel, baseUrl, config, activeMeta, auth, onSaved, setReindexing]);

  const configuredProviderIds = useMemo(
    () => (config ? (Object.keys(config.providers) as LlmProviderId[]).filter((id) => config.providers[id]?.configured) : []),
    [config]
  );
  const activeId = config?.activeProvider ?? null;
  const isProviderConfigured = Boolean(config?.providers[provider]?.configured);

  if (catalog.length === 0) {
    return (
      <div className="py-8">
        <Spinner label="Loading providers…" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Provider select */}
      <div>
        <Label>API Provider</Label>
        <Select value={provider} onChange={(e) => pickProvider(e.target.value as LlmProviderId)}>
          {catalog.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label} — {PROVIDER_TIER_LABEL[p.tier]}
            </option>
          ))}
        </Select>
        {activeMeta && (
          <div className="mt-1.5 flex items-center gap-2">
            <Badge tone={PROVIDER_TIER_BADGE[activeMeta.tier]}>{PROVIDER_TIER_LABEL[activeMeta.tier]}</Badge>
            <p className="text-xs text-slate-500">{activeMeta.description}</p>
          </div>
        )}
        {activeMeta && !activeMeta.supportsEmbedding && (
          <p className="mt-2 rounded-lg border border-indigo-100 bg-indigo-50 px-3 py-2 text-xs text-indigo-800">
            {activeMeta.label} handles chat. Document search automatically uses your saved Hugging Face, OpenAI, or Ollama embedding provider.
          </p>
        )}
      </div>

      {/* Model select (tier-tagged) */}
      <div>
        <Label>Model</Label>
        <Select value={model} onChange={(e) => setModel(e.target.value)}>
          {chatModels.map((m: LlmModel) => (
            <option key={m.id} value={m.id}>
              {m.name} — {TIER_META[m.tier].label}
            </option>
          ))}
        </Select>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {chatModels
            .filter((m) => m.id === model)
            .map((m) => (
              <span key={m.id} className="inline-flex items-center gap-1 text-xs text-slate-500">
                <TierBadge tier={m.tier} />
                {m.contextTokens ? `${(m.contextTokens / 1000).toFixed(0)}k ctx` : ""}
              </span>
            ))}
        </div>
      </div>

      {/* Embedding model, when the provider supports it */}
      {hasEmbedding && (
        <div>
          <Label>Embedding Model</Label>
          <Select value={embeddingModel} onChange={(e) => setEmbeddingModel(e.target.value)}>
            <option value="">Use default</option>
            {chatModels
              .filter((m) => m.supportsEmbedding)
              .map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
          </Select>
        </div>
      )}

      {/* Local base URL (Ollama), pre-filled from catalog */}
      {provider === "ollama" && (
        <div>
          <Label>Ollama Base URL</Label>
          <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="http://localhost:11434/v1" />
        </div>
      )}

      {/* API key */}
      <div>
        <Label>API Key {needsKey ? "" : "(not required for local)"}</Label>
        <div className="relative">
          <Input
            type={showApiKey ? "text" : "password"}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={needsKey ? (isProviderConfigured ? "Saved API key — leave blank to keep it" : activeMeta?.apiKeyLabel ?? "Paste your API key") : isProviderConfigured ? "Saved key (leave blank to keep)" : "None required"}
            autoComplete="off"
            className={needsKey ? "pr-11" : ""}
          />
          {needsKey && (
            <button
              type="button"
              onClick={() => setShowApiKey((visible) => !visible)}
              aria-label={showApiKey ? "Hide API key" : "Show API key"}
              title={showApiKey ? "Hide API key" : "Show API key"}
              className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-slate-400 transition hover:text-rose-600"
            >
              {showApiKey ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 4.2A10.6 10.6 0 0 1 12 4c5.5 0 9.5 5.3 9.5 8s-1.5 4.5-3.7 6.1M6.2 6.2C4 7.8 2.5 9.8 2.5 12c0 2.7 4 8 9.5 8 1.1 0 2.1-.2 3-.6" />
                </svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M2.5 12S6.5 4 12 4s9.5 5.3 9.5 8-4 8-9.5 8-9.5-5.3-9.5-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              )}
            </button>
          )}
        </div>
        {needsKey && isProviderConfigured && (
          <p className="mt-1 text-xs text-slate-500">Your saved key is encrypted and cannot be displayed. Leave this blank to reuse it, or paste a new key to replace it.</p>
        )}
        {needsKey && activeMeta?.apiKeyUrl && (
          <a
            href={activeMeta.apiKeyUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-rose-600 underline decoration-rose-300 underline-offset-2 transition hover:text-rose-700"
          >
            Get or manage your {activeMeta.label} API key
            <span aria-hidden="true">↗</span>
          </a>
        )}
        {!needsKey && <p className="mt-1 text-xs text-slate-500">Ollama runs locally — no API key or cloud cost.</p>}
      </div>

      {error && <Alert tone="rose">{error}</Alert>}
      {notice && <Alert tone="green">{notice}</Alert>}

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <Button type="button" variant="outline" onClick={testConnection} disabled={testing || !token}>
          {testing ? "Testing…" : "Test connection"}
        </Button>
        <Button type="button" onClick={saveAndActivate} disabled={saving || !token || !model}>
          {saving ? "Saving…" : isProviderConfigured ? "Activate saved provider" : "Save & Activate"}
        </Button>
      </div>

      {/* Switch active among configured providers */}
      {configuredProviderIds.length > 0 && (
        <div className="border-t border-rose-100 pt-4">
          <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">Configured providers</div>
          <div className="flex flex-wrap gap-1.5">
            {configuredProviderIds.map((id) => {
              const meta = catalog.find((p) => p.id === id);
              const item = config?.providers[id];
              return (
                <button
                  key={id}
                  onClick={() => pickProvider(id)}
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition ${
                    activeId === id && provider === id
                      ? "border-rose-300 bg-rose-50 text-rose-600"
                      : "border-rose-100 text-slate-600 hover:border-rose-200"
                  }`}
                  title={item?.model}
                >
                  {meta?.label ?? id}
                  {activeId === id && <Badge tone="green">active</Badge>}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Poll the server-side reindex status until no document remains in progress.
 * Used after a provider/embedding-model change triggers an automatic reindex so
 * the UI can keep the loading overlay up until the batch has completed.
 */
async function waitForReindex(token: string): Promise<void> {
  for (;;) {
    try {
      const res = await apiFetch<{ processing: number; complete: boolean }>("/documents/reindex-status", { token });
      if (res.complete || res.processing === 0) return;
    } catch {
      // transient error — keep polling
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
}
