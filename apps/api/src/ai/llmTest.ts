import type { LlmProviderId, LlmProviderMeta } from "@graphrag/shared";
import { llmProviderMeta } from "@graphrag/shared";
import { buildProviderFromInput, type LlmProviderInput } from "./llm.js";
import { maskSecret } from "./secrets.js";

export interface LlmTestResult {
  ok: boolean;
  provider?: LlmProviderId;
  model?: string;
  message?: string;
  error?: string;
}

/**
 * Verify connectivity with a provider using the supplied key/model. Does NOT
 * persist anything. Performs one tiny chat round-trip (the lightest possible
 * check) and reports an actionable error on failure.
 */
export async function testProviderConnectivity(input: {
  provider: LlmProviderId;
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  embeddingModel?: string;
  userId?: string;
}): Promise<LlmTestResult> {
  const meta = llmProviderMeta(input.provider);
  if (!meta) return { ok: false, error: "Unknown provider" };
  if (meta.needsApiKey && !input.apiKey) {
    return { ok: false, provider: input.provider, error: "No API key provided" };
  }

  const providerInput: LlmProviderInput = {
    provider: input.provider,
    apiKey: input.apiKey,
    model: input.model,
    baseUrl: input.baseUrl,
    embeddingModel: input.embeddingModel
  };

  try {
    const provider = buildProviderFromInput(providerInput);
    const res = await provider.chat(
      [{ role: "system", content: "You are a connectivity probe." }, { role: "user", content: "Reply with the single word: OK" }],
      { temperature: 0, maxTokens: 16 }
    );
    return {
      ok: true,
      provider: input.provider,
      model: input.model ?? provider.cmodel,
      message: res.content?.length ? "Connected. Model responded." : "Connected (empty reply)."
    };
  } catch (err) {
    return {
      ok: false,
      provider: input.provider,
      model: input.model,
      error: friendlyError(meta, err)
    };
  }
}

/** Map provider SDK errors to an actionable, user-facing message. */
function friendlyError(meta: LlmProviderMeta, err: unknown): string {
  const e = err as { status?: number; statusCode?: number; message?: string; body?: { error?: { message?: string } } };
  const msg = e?.body?.error?.message ?? e?.message ?? "";
  const status = (e?.status ?? e?.statusCode ?? 0) as number;
  if (status === 401 || status === 403 || /api[_-]?key|unauthorized|invalid api|invalid_api|403/i.test(msg)) {
    return `The API key for ${meta.label} looks invalid or unauthorized. Check the key (${meta.apiKeyLabel}) and try again.`;
  }
  if (status === 429 || /rate|quota|limit|credit|insufficient/i.test(msg)) {
    return `${meta.label}: the account is rate-limited or out of free credits. (${msg})`;
  }
  if (/enrich|depleted|exhaust|billing/i.test(msg)) {
    return `${meta.label}: free credits appear to be exhausted (${msg}).`;
  }
  if (status === 404 || /not found|no such model|unknown model/i.test(msg)) {
    return `The model could not be found on ${meta.label}. Pick another model.`;
  }
  if (e instanceof TypeError) {
    return `Could not reach ${meta.label}. Check your connection and base URL. (${msg})`;
  }
  return `Connection to ${meta.label} failed: ${msg || "unknown error"}`;
}

export { maskSecret };