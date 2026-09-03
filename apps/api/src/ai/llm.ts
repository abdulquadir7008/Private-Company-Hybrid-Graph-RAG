import { AsyncLocalStorage } from "node:async_hooks";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { HfInference } from "@huggingface/inference";
import type { LlmProviderId } from "@graphrag/shared";
import { llmProviderMeta } from "@graphrag/shared";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { AppError } from "../errors.js";
import { decryptSecret } from "./secrets.js";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmChatResponse {
  content: string;
  model: string;
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
}

export interface LlmProvider {
  chat(messages: ChatMessage[], opts?: { temperature?: number; maxTokens?: number }): Promise<LlmChatResponse>;
  embed(texts: string[]): Promise<number[][]>;
  readonly emodel: string;
  readonly cmodel: string;
}

export interface LlmProviderInput {
  provider?: LlmProviderId;
  apiKey?: string;
  model?: string;
  embeddingModel?: string;
  baseUrl?: string;
}

/* ------------------------------------------------------------------ *
 * Persistence shapes
 * ------------------------------------------------------------------ */

export interface PersistedProviderConfig {
  apiKey?: string;
  model: string;
  embeddingModel?: string;
  baseUrl?: string;
}

/** Shape stored in the User.llmConfig JSON column (apiKey never plaintext). */
export interface PersistedLlmConfig {
  providers: Partial<Record<LlmProviderId, PersistedProviderConfig>>;
}

/** The config a user actually has (past the provider model). */
export interface UserLlmConfig {
  activeProvider: LlmProviderId;
  apiKey: string;
  model: string;
  embeddingModel?: string;
  baseUrl?: string;
}

/**
 * Load the effective per-user provider config from PG. Returns null when the
 * user has not configured (or activated) a provider. Never returns apiKey in
 * plaintext from the client path — the key is decrypted only here, server-side.
 */
export async function loadUserLlmConfig(userId: string): Promise<UserLlmConfig | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { llmConfig: true, activeLlmProvider: true }
  });
  if (!user || !user.activeLlmProvider) return null;
  const active = user.activeLlmProvider as LlmProviderId;
  const saved = (user.llmConfig as PersistedLlmConfig | null)?.providers?.[active];
  if (!saved?.model) return null;
  return {
    activeProvider: active,
    apiKey: saved.apiKey ? decryptSecret(saved.apiKey) : "",
    model: saved.model,
    embeddingModel: saved.embeddingModel,
    baseUrl: saved.baseUrl
  };
}

/**
 * Resolve the provider used for vector embeddings. Chat-only providers (such
 * as Groq, Anthropic, and Gemini) cannot create or query vectors, so they use
 * a saved embedding-capable provider. Hugging Face is preferred because its
 * embedding model is available on the free tier.
 */
export async function loadUserEmbeddingConfig(userId: string): Promise<UserLlmConfig | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { llmConfig: true, activeLlmProvider: true }
  });
  if (!user) return null;

  const providers = (user.llmConfig as PersistedLlmConfig | null)?.providers ?? {};
  const active = user.activeLlmProvider as LlmProviderId | null;
  const candidates = [active, "huggingface", "openai", "ollama"]
    .filter((id): id is LlmProviderId => Boolean(id))
    .filter((id, index, ids) => ids.indexOf(id) === index);

  for (const id of candidates) {
    const saved = providers[id];
    if (!saved?.model || !llmProviderMeta(id)?.supportsEmbedding) continue;
    return {
      activeProvider: id,
      apiKey: saved.apiKey ? decryptSecret(saved.apiKey) : "",
      model: saved.model,
      embeddingModel: saved.embeddingModel,
      baseUrl: saved.baseUrl
    };
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Concrete providers
 * ------------------------------------------------------------------ */

class OpenAICompatProvider implements LlmProvider {
  private client: OpenAI;
  readonly cmodel: string;
  readonly emodel: string;

  constructor(input: LlmProviderInput) {
    const meta = llmProviderMeta(input.provider ?? "openai");
    this.client = new OpenAI({
      apiKey: input.apiKey || "no-key",
      // Groq and Ollama expose the OpenAI chat-completions API, but at their
      // own endpoints. Falling back to the provider catalog here also repairs
      // configurations saved before base URLs were persisted.
      baseURL: input.baseUrl || meta?.openAiCompatibleBaseUrl || "https://api.openai.com/v1"
    });
    this.cmodel = input.model ?? config.OPENAI_CHAT_MODEL;
    this.emodel = input.embeddingModel || meta?.defaultEmbeddingModel || config.OPENAI_EMBEDDING_MODEL;
  }

  async chat(messages: ChatMessage[], opts: { temperature?: number; maxTokens?: number } = {}): Promise<LlmChatResponse> {
    const res = await this.client.chat.completions.create({
      model: this.cmodel,
      messages,
      temperature: opts.temperature ?? 0.1,
      max_tokens: opts.maxTokens ?? 1200
    });
    return {
      content: res.choices[0]?.message?.content ?? "",
      model: this.cmodel,
      usage: res.usage
        ? { promptTokens: res.usage.prompt_tokens, completionTokens: res.usage.completion_tokens, totalTokens: res.usage.total_tokens }
        : undefined
    };
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const res = await this.client.embeddings.create({ model: this.emodel, input: texts });
    return res.data.map((d) => d.embedding);
  }
}

class AnthropicProvider implements LlmProvider {
  private client: Anthropic;
  readonly cmodel: string;
  readonly emodel: string;

  constructor(input: LlmProviderInput) {
    this.client = new Anthropic({ apiKey: input.apiKey ?? "" });
    this.cmodel = input.model ?? "claude-3-5-sonnet-latest";
    this.emodel = input.embeddingModel ?? "";
  }

  async chat(messages: ChatMessage[], opts: { temperature?: number; maxTokens?: number } = {}): Promise<LlmChatResponse> {
    const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n");
    const turns = messages.filter((m) => m.role !== "system");
    const res = await this.client.messages.create({
      model: this.cmodel,
      max_tokens: opts.maxTokens ?? 1200,
      system: system || undefined,
      temperature: opts.temperature ?? 0.1,
      messages: turns.map((t) => ({ role: t.role === "assistant" ? ("assistant" as const) : ("user" as const), content: t.content }))
    });
    const text = res.content.filter((b) => b.type === "text").map((b) => ("text" in b ? b.text : "")).join("");
    return {
      content: text,
      model: this.cmodel,
      usage: res.usage
        ? { promptTokens: res.usage.input_tokens, completionTokens: res.usage.output_tokens, totalTokens: res.usage.input_tokens + res.usage.output_tokens }
        : undefined
    };
  }

  async embed(_texts: string[]): Promise<number[][]> {
    return [];
  }
}

class HuggingFaceProvider implements LlmProvider {
  private client: HfInference;
  readonly cmodel: string;
  readonly emodel: string;

  constructor(input: LlmProviderInput) {
    this.client = new HfInference(input.apiKey ?? "");
    this.cmodel = input.model ?? config.HUGGINGFACE_CHAT_MODEL;
    this.emodel = input.embeddingModel ?? config.HUGGINGFACE_EMBEDDING_MODEL;
  }

  async chat(messages: ChatMessage[], opts: { temperature?: number; maxTokens?: number } = {}): Promise<LlmChatResponse> {
    const res = await this.client.chatCompletion({
      model: this.cmodel,
      messages: messages as never,
      temperature: opts.temperature ?? 0.1,
      max_tokens: opts.maxTokens ?? 1200
    });
    return {
      content: res.choices[0]?.message?.content ?? "",
      model: this.cmodel,
      usage: res.usage
        ? { promptTokens: res.usage.prompt_tokens, completionTokens: res.usage.completion_tokens, totalTokens: res.usage.total_tokens }
        : undefined
    };
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const out: number[][] = [];
    for (const t of texts) {
      const r = await this.client.featureExtraction({ model: this.emodel, inputs: t });
      out.push(r as number[]);
    }
    return out;
  }
}

function buildProvider(input: LlmProviderInput): LlmProvider {
  const meta = llmProviderMeta(input.provider ?? "openai");
  if (meta?.anthropicSdk) return new AnthropicProvider(input);
  if (meta?.huggingFaceSdk) return new HuggingFaceProvider(input);
  return new OpenAICompatProvider(input);
}

/** Global (env-derived) fallback provider input. */
function globalInput(): LlmProviderInput {
  if (config.isHuggingFace) {
    return { provider: "huggingface", apiKey: config.HUGGINGFACE_API_KEY, model: config.HUGGINGFACE_CHAT_MODEL, embeddingModel: config.HUGGINGFACE_EMBEDDING_MODEL };
  }
  return { provider: "openai", apiKey: config.OPENAI_API_KEY, model: config.OPENAI_CHAT_MODEL, embeddingModel: config.OPENAI_EMBEDDING_MODEL };
}

/** Build a provider from a resolved per-user config, or the global fallback. */
export function providerFromConfig(cfg: UserLlmConfig | null): LlmProvider {
  if (cfg) {
    return buildProvider({
      provider: cfg.activeProvider,
      apiKey: cfg.apiKey || undefined,
      model: cfg.model,
      embeddingModel: cfg.embeddingModel,
      baseUrl: cfg.baseUrl
    });
  }
  return buildProvider(globalInput());
}

/** Build a provider from a raw LlmProviderInput (used by /llm/test). */
export function buildProviderFromInput(input: LlmProviderInput): LlmProvider {
  // Ensure a stable provider id for the client constructor inside buildProvider.
  return buildProvider({ provider: input.provider ?? "openai", ...input });
}

/* ------------------------------------------------------------------ *
 * Async request context.
 *
 * Each authenticated request binds its resolved LlmProvider into a
 * synchronous AsyncLocalStorage store so the shared chatCompletion /
 * embedTexts call sites pick up the caller's own provider with no signature
 * changes. Fallback to the global env provider when none is configured.
 * ------------------------------------------------------------------ */

interface LlmCtx {
  userId: string | null;
  provider: LlmProvider;
  providerId: LlmProviderId;
  embeddingProvider: LlmProvider;
  configured: boolean;
}

const requestCtx = new AsyncLocalStorage<LlmCtx>();

function currentProvider(): LlmProvider {
  return requestCtx.getStore()?.provider ?? buildProvider(globalInput());
}

function currentEmbeddingProvider(): LlmProvider {
  return requestCtx.getStore()?.embeddingProvider ?? buildProvider(globalInput());
}

/** True when the current request resolved a non-global (user) provider. */
export function currentLlmConfigured(): boolean {
  const store = requestCtx.getStore();
  return store?.configured ?? false;
}

/** The userId bound to the current request, if any. */
export function currentLlmUserId(): string | null {
  return requestCtx.getStore()?.userId ?? null;
}

/** Run `fn` with the user's own provider resolved from PG bound in context. */
export async function withLlmUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  const cfg = await loadUserLlmConfig(userId);
  const embeddingCfg = await loadUserEmbeddingConfig(userId);
  const configured = cfg !== null;
  const provider = providerFromConfig(cfg);
  const embeddingProvider = providerFromConfig(embeddingCfg);
  return requestCtx.run({ userId, provider, providerId: cfg?.activeProvider ?? globalInput().provider!, embeddingProvider, configured }, () => fn());
}

/* ------------------------------------------------------------------ *
 * Public wrappers.
 * ------------------------------------------------------------------ */

export async function chatCompletion(
  messages: ChatMessage[],
  opts?: { temperature?: number; maxTokens?: number }
): Promise<LlmChatResponse> {
  try {
    return await currentProvider().chat(messages, opts);
  } catch (err) {
    const providerId = requestCtx.getStore()?.providerId ?? globalInput().provider!;
    throw providerUnavailableError(providerId, err);
  }
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  return currentEmbeddingProvider().embed(texts);
}

/** Convert third-party SDK failures into a safe, actionable API response. */
export function providerUnavailableError(providerId: LlmProviderId, err: unknown): AppError {
  const meta = llmProviderMeta(providerId);
  const label = meta?.label ?? "AI provider";
  const detail = err as { status?: number; statusCode?: number; message?: string };
  const status = detail.status ?? detail.statusCode;

  if (status === 401 || status === 403) {
    return new AppError(502, `${label} rejected the configured API key. Update it in Manage API provider and try again.`, "AI_PROVIDER_UNAVAILABLE");
  }
  if (status === 429) {
    return new AppError(503, `${label} is rate-limiting this account. Wait a moment or check the provider quota, then try again.`, "AI_PROVIDER_UNAVAILABLE");
  }
  if (status === 404 || /no default model|model.*(not found|unsupported)|does not seem to support chat/i.test(detail.message ?? "")) {
    return new AppError(502, `${label} cannot use the selected model for chat. Choose another model in Manage API provider and try again.`, "AI_PROVIDER_UNAVAILABLE");
  }
  return new AppError(502, `${label} could not complete this chat request. Check the provider connection and selected model, then try again.`, "AI_PROVIDER_UNAVAILABLE");
}
