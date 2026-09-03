/* ------------------------------------------------------------------ *
 * Per-user LLM provider catalog.
 *
 * Describes the providers a user can attach their OWN API key to and the
 * models each provider exposes, tagged by cost tier. The server never owns
 * a key for a tenant's personal provider; each registered user supplies,
 * stores (encrypted), and activates ONE provider at a time.
 *
 * Embeddings are separate from chat: a provider may support chat only, and
 * the app falls back to the configured chat model / embedding model as
 * appropriate.
 * ------------------------------------------------------------------ */

export const LLM_PROVIDER_IDS = [
  "huggingface",
  "groq",
  "gemini",
  "openai",
  "anthropic",
  "ollama"
] as const;
export type LlmProviderId = (typeof LLM_PROVIDER_IDS)[number];

export type LlmProviderTier = "freetier" | "paid" | "local";

export const MODEL_TIERS = ["free", "freetier", "paid"] as const;
export type ModelTier = (typeof MODEL_TIERS)[number];

/** A selectable model. tier labels how much it costs to run. */
export interface LlmModel {
  /** Stable identifier used in the request (the provider's model string). */
  id: string;
  /** Human-friendly label shown in the dropdown. */
  name: string;
  tier: ModelTier;
  /** Whether this provider can also embed text with this model. */
  supportsEmbedding: boolean;
  /** Context window in tokens (informational). */
  contextTokens?: number;
}

export interface LlmProviderMeta {
  id: LlmProviderId;
  label: string;
  description: string;
  /** Display category used to order the setup picker. */
  tier: LlmProviderTier;
  /** Placeholder/help for the API-key field (e.g. "sk-…"). */
  apiKeyLabel: string;
  /** Official page where a user can create or manage their key. */
  apiKeyUrl?: string;
  /** Set false for local providers (Ollama) that need no key. */
  needsApiKey: boolean;
  /** OpenAI-compatible base URL override when the OpenAI client is reused. */
  openAiCompatibleBaseUrl?: string;
  /** Set only for providers supported by the Anthropic SDK. */
  anthropicSdk?: boolean;
  /** Set only for providers supported by the HuggingFace SDK. */
  huggingFaceSdk?: boolean;
  supportsEmbedding: boolean;
  defaultEmbeddingModel?: string;
  models: LlmModel[];
}

/**
 * Built-in catalog of models. It is intentionally curated rather than
 * auto-discovered so the UI can label each model's cost tier without making
 * a network call per provider. (The /llm/test endpoint still verifies real
 * connectivity at save time.)
 */
export const LLM_PROVIDERS: LlmProviderMeta[] = [
  {
    id: "openai",
    label: "OpenAI",
    description: "GPT-4o and GPT-4o-mini from OpenAI. Paid, per-token.",
    tier: "paid",
    apiKeyLabel: "sk-…",
    apiKeyUrl: "https://platform.openai.com/api-keys",
    needsApiKey: true,
    supportsEmbedding: true,
    defaultEmbeddingModel: "text-embedding-3-small",
    models: [
      { id: "gpt-4o-mini", name: "GPT-4o mini", tier: "paid", supportsEmbedding: false, contextTokens: 128000 },
      { id: "gpt-4o", name: "GPT-4o", tier: "paid", supportsEmbedding: false, contextTokens: 128000 },
      { id: "o3-mini", name: "o3-mini (reasoning)", tier: "paid", supportsEmbedding: false, contextTokens: 200000 },
      { id: "text-embedding-3-small", name: "text-embedding-3-small", tier: "paid", supportsEmbedding: true },
      { id: "text-embedding-3-large", name: "text-embedding-3-large", tier: "paid", supportsEmbedding: true }
    ]
  },
  {
    id: "anthropic",
    label: "Anthropic",
    description: "Claude models from Anthropic. Paid, per-token.",
    tier: "paid",
    apiKeyLabel: "sk-ant-…",
    apiKeyUrl: "https://console.anthropic.com/settings/keys",
    needsApiKey: true,
    anthropicSdk: true,
    supportsEmbedding: false,
    models: [
      { id: "claude-3-5-haiku-latest", name: "Claude 3.5 Haiku", tier: "paid", supportsEmbedding: false, contextTokens: 200000 },
      { id: "claude-3-5-sonnet-latest", name: "Claude 3.5 Sonnet", tier: "paid", supportsEmbedding: false, contextTokens: 200000 },
      { id: "claude-sonnet-4-20250514", name: "Claude Sonnet 4", tier: "paid", supportsEmbedding: false, contextTokens: 200000 }
    ]
  },
  {
    id: "groq",
    label: "Groq",
    description: "Fast inference on Groq LPUs. These chat models are available on Groq's Free tier with rate limits.",
    tier: "freetier",
    apiKeyLabel: "gsk_…",
    apiKeyUrl: "https://console.groq.com/keys",
    needsApiKey: true,
    openAiCompatibleBaseUrl: "https://api.groq.com/openai/v1",
    supportsEmbedding: false,
    models: [
      // These are text-generation models supported by Groq's Free plan. They
      // use the OpenAI-compatible chat-completions endpoint used throughout
      // this app; Groq enforces the account's free-plan rate limits.
      { id: "openai/gpt-oss-20b", name: "GPT-OSS 20B", tier: "free", supportsEmbedding: false, contextTokens: 131072 },
      { id: "openai/gpt-oss-120b", name: "GPT-OSS 120B", tier: "free", supportsEmbedding: false, contextTokens: 131072 },
      { id: "qwen/qwen3.6-27b", name: "Qwen 3.6 27B", tier: "free", supportsEmbedding: false, contextTokens: 131072 },
      { id: "qwen/qwen3.8-27b", name: "Qwen 3.8 27B", tier: "free", supportsEmbedding: false, contextTokens: 131072 }
    ]
  },
  {
    id: "huggingface",
    label: "HuggingFace",
    description: "Open models via the Hugging Face inference server.",
    tier: "freetier",
    apiKeyLabel: "hf_…",
    apiKeyUrl: "https://huggingface.co/settings/tokens",
    needsApiKey: true,
    huggingFaceSdk: true,
    supportsEmbedding: true,
    defaultEmbeddingModel: "sentence-transformers/all-MiniLM-L6-v2",
    models: [
      { id: "openai/gpt-oss-120b", name: "GPT-OSS 120B", tier: "freetier", supportsEmbedding: false, contextTokens: 131072 },
      { id: "meta-llama/Llama-3.3-70B-Instruct", name: "Llama 3.3 70B Instruct", tier: "freetier", supportsEmbedding: false },
      { id: "mistralai/Mistral-7B-Instruct-v0.3", name: "Mistral 7B Instruct", tier: "free", supportsEmbedding: false },
      { id: "Qwen/Qwen2.5-7B-Instruct", name: "Qwen 2.5 7B Instruct", tier: "free", supportsEmbedding: false },
      { id: "sentence-transformers/all-MiniLM-L6-v2", name: "all-MiniLM-L6-v2 (embed)", tier: "free", supportsEmbedding: true }
    ]
  },
  {
    id: "ollama",
    label: "Ollama (local)",
    description: "Run models locally with Ollama. No API key, no cloud cost.",
    tier: "local",
    apiKeyLabel: "None required",
    needsApiKey: false,
    openAiCompatibleBaseUrl: "http://localhost:11434/v1",
    supportsEmbedding: true,
    defaultEmbeddingModel: "nomic-embed-text",
    models: [
      { id: "llama3.2", name: "Llama 3.2", tier: "free", supportsEmbedding: false, contextTokens: 128000 },
      { id: "llama3.2:1b", name: "Llama 3.2 1B", tier: "free", supportsEmbedding: false },
      { id: "qwen2.5:7b", name: "Qwen 2.5 7B", tier: "free", supportsEmbedding: false },
      { id: "nomic-embed-text", name: "nomic-embed-text (embed)", tier: "free", supportsEmbedding: true }
    ]
  },
  {
    id: "gemini",
    label: "Google Gemini",
    description: "Current Gemini Flash models via the OpenAI-compatible endpoint. Free tier available.",
    tier: "freetier",
    apiKeyLabel: "AIza…",
    apiKeyUrl: "https://aistudio.google.com/app/apikey",
    needsApiKey: true,
    openAiCompatibleBaseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    supportsEmbedding: false,
    models: [
      { id: "gemini-3.5-flash-lite", name: "Gemini 3.5 Flash-Lite", tier: "freetier", supportsEmbedding: false },
      { id: "gemini-3.5-flash", name: "Gemini 3.5 Flash", tier: "freetier", supportsEmbedding: false },
      { id: "gemini-3.1-flash-lite", name: "Gemini 3.1 Flash-Lite", tier: "freetier", supportsEmbedding: false }
    ]
  }
];

export function llmProviderMeta(id: LlmProviderId): LlmProviderMeta | undefined {
  return LLM_PROVIDERS.find((p) => p.id === id);
}
