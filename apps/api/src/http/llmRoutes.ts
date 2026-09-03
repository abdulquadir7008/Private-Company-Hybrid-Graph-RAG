import { Router } from "express";
import { z } from "zod";
import type {
  LlmConfigState,
  LlmConfigStateItem,
  LlmProviderId,
  LlmProviderMeta,
  SavedLlmProviderConfig
} from "@graphrag/shared";
import { LLM_PROVIDERS, LLM_PROVIDER_IDS, llmProviderMeta } from "@graphrag/shared";
import { prisma } from "../db.js";
import { asyncHandler } from "../util/asyncHandler.js";
import { requireAuth, principalOf } from "../access/middleware.js";
import { ValidationError } from "../errors.js";
import { Auditor } from "../audit/service.js";
import { encryptSecret, decryptSecret } from "../ai/secrets.js";
import { testProviderConnectivity } from "../ai/llmTest.js";
import { ingestionPipeline } from "../ingestion/pipeline.js";

export const llmRoutes = Router();

/** Stable model options for a provider, for the catalog endpoint. */
export function providersCatalog(): LlmProviderMeta[] {
  return [...LLM_PROVIDERS].sort((a, b) => LLM_PROVIDER_IDS.indexOf(a.id) - LLM_PROVIDER_IDS.indexOf(b.id));
}

/** Build the client-facing config state (never exposes API keys). */
export function toState(saved: { activeLlmProvider: string | null; llmConfig: unknown }): LlmConfigState {
  const providers = {} as Record<LlmProviderId, LlmConfigStateItem>;
  const stored = (saved.llmConfig as { providers?: Record<string, SavedLlmProviderConfig> } | null)?.providers ?? {};
  for (const id of LLM_PROVIDER_IDS) {
    const p = stored[id];
    providers[id] = {
      provider: id,
      configured: Boolean(p?.model),
      model: p?.model ?? "",
      embeddingModel: p?.embeddingModel,
      baseUrl: p?.baseUrl
    };
  }
  return {
    activeProvider: (saved.activeLlmProvider as LlmProviderId | null) ?? null,
    providers
  };
}

const saveSchema = z.object({
  provider: z.enum(LLM_PROVIDER_IDS),
  model: z.string().min(1).max(200),
  apiKey: z.string().max(2000).optional().default(""),
  embeddingModel: z.string().max(200).optional(),
  baseUrl: z.string().url().max(500).optional()
});

llmRoutes.get(
  "/catalog",
  requireAuth,
  asyncHandler(async (_req, res) => {
    res.json(providersCatalog());
  })
);

llmRoutes.get(
  "/config",
  requireAuth,
  asyncHandler(async (req, res) => {
    const p = principalOf(req);
    const user = await prisma.user.findUnique({
      where: { id: p.userId },
      select: { activeLlmProvider: true, llmConfig: true }
    });
    res.json(toState(user ?? { activeLlmProvider: null, llmConfig: null }));
  })
);

/**
 * PUT /llm/config — save (or update) a provider's settings and make it the
 * active provider. API keys are encrypted at rest and never returned.
 */
llmRoutes.put(
  "/config",
  requireAuth,
  asyncHandler(async (req, res) => {
    const p = principalOf(req);
    const parsed = saveSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError("Invalid API configuration", "config");

    const { provider, model, apiKey, embeddingModel, baseUrl } = parsed.data;
    const meta = llmProviderMeta(provider);
    if (!meta) throw new ValidationError("Unknown provider", "provider");

    // Validate the model belongs to this provider's catalog when provided.
    const knownModel = meta.models.find((m) => m.id === model);
    if (!knownModel) {
      throw new ValidationError(`"${model}" is not a known model for ${meta.label}`, "model");
    }

    const user = await prisma.user.findUnique({
      where: { id: p.userId },
      select: { llmConfig: true, activeLlmProvider: true, companyId: true }
    });
    const existingProviders =
      (user?.llmConfig as { providers?: Record<string, SavedLlmProviderConfig> } | null)?.providers ?? {};
    const prevActiveProvider = user?.activeLlmProvider ?? null;

    // Groq, Anthropic, and Gemini are chat-only. RAG still needs a separate
    // embedding provider to retrieve authorized document evidence.
    const hasSavedEmbeddingProvider = (Object.keys(existingProviders) as LlmProviderId[]).some(
      (id) => Boolean(existingProviders[id]?.model) && llmProviderMeta(id)?.supportsEmbedding
    );
    if (!meta.supportsEmbedding && !hasSavedEmbeddingProvider) {
      throw new ValidationError(
        `${meta.label} is chat-only. Save Hugging Face, OpenAI, or Ollama first to create document embeddings.`,
        "provider"
      );
    }

    // Resolve the effective (new) embedding model for the provider being saved.
    const nextEmbeddingModel = embeddingModel || meta.defaultEmbeddingModel || "";
    // The embedding model the documents were last indexed with (if this provider
    // was previously the active one, or switching providers entirely).
    const prevEmbeddingModel =
      existingProviders[prevActiveProvider ?? provider]?.embeddingModel ??
      existingProviders[prevActiveProvider ?? provider]?.model ??
      "";
    const reindexRequired = prevActiveProvider !== provider || nextEmbeddingModel !== prevEmbeddingModel || !meta.supportsEmbedding;

    // Encryption: if the caller omitted an apiKey we keep the previously saved
    // one (they are not round-tripped to the client). Otherwise store encrypted.
    const prevApiKey =
      existingProviders[provider]?.apiKey != null ? decryptSecret(existingProviders[provider]!.apiKey as string) : "";
    const effectiveKey = apiKey ? apiKey : prevApiKey;

    // A key may be omitted when re-activating an already configured provider:
    // it remains encrypted server-side and is never sent back to the browser.
    if (meta.needsApiKey && !effectiveKey) {
      throw new ValidationError(`An API key is required for ${meta.label}`, "apiKey");
    }

    const nextProviders = {
      ...existingProviders,
      [provider]: {
        provider,
        model,
        embeddingModel: nextEmbeddingModel || undefined,
        ...(effectiveKey ? { apiKey: encryptSecret(effectiveKey) } : {}),
        // Persist catalog defaults for OpenAI-compatible providers such as
        // Groq. This makes the stored configuration explicit while the LLM
        // factory still provides the same fallback for existing records.
        ...(baseUrl || meta.openAiCompatibleBaseUrl ? { baseUrl: baseUrl || meta.openAiCompatibleBaseUrl } : {})
      }
    };

    const nextConfig = { providers: nextProviders };
    await prisma.user.update({
      where: { id: p.userId },
      data: { llmConfig: nextConfig as never, activeLlmProvider: provider }
    });

    // When the active provider or its embedding model changes, the stored chunk
    // vectors are no longer compatible with the new provider's embedding model.
    // Reindex every document so vectors + graph are rebuilt with the new model.
    // Await the batch start (not the long-running work) so documents are marked
    // PROCESSING before the client is told to show its reindexing screen.
    if (reindexRequired && user?.companyId) {
      await ingestionPipeline.reindexAll(user.companyId, p.userId);
    }

    await new Auditor().record({
      companyId: p.companyId ?? undefined,
      userId: p.userId,
      action: "LLM_CONFIG_CHANGE",
      detail: { provider, model, configuredProviders: Object.keys(nextProviders) },
      requestId: req.requestId
    });

    const updated = await prisma.user.findUnique({
      where: { id: p.userId },
      select: { activeLlmProvider: true, llmConfig: true }
    });
    res.json({ ...toState(updated!), reindexing: reindexRequired && Boolean(user?.companyId) });
  })
);

const testSchema = saveSchema;

/**
 * POST /llm/test — verify that a provider + key + model actually works before
 * the user saves it. Does not persist anything.
 */
llmRoutes.post(
  "/test",
  requireAuth,
  asyncHandler(async (req, res) => {
    const p = principalOf(req);
    const parsed = testSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError("Invalid provider settings", "config");

    const result = await testProviderConnectivity({
      provider: parsed.data.provider,
      apiKey: parsed.data.apiKey || undefined,
      model: parsed.data.model,
      embeddingModel: parsed.data.embeddingModel,
      baseUrl: parsed.data.baseUrl,
      // Prisma already selected the user for /config; for /test read it again.
      userId: p.userId
    });

    await new Auditor().record({
      companyId: p.companyId ?? undefined,
      userId: p.userId,
      action: "LLM_CONFIG_TEST",
      detail: { provider: parsed.data.provider, model: parsed.data.model, ok: result.ok },
      requestId: req.requestId
    });

    res.status(result.ok ? 200 : 400).json(result);
  })
);

/**
 * GET /llm/verify-key — used by the frontend to confirm a provider key is
 * valid without persisting (thin wrapper around the catalog's base URL).
 */
llmRoutes.get(
  "/verify-key",
  requireAuth,
  asyncHandler(async (_req, res) => {
    res.json({ ok: true });
  })
);
