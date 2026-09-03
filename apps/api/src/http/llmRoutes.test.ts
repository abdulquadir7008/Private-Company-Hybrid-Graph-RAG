import { describe, it, expect } from "vitest";
import { LLM_PROVIDERS, LLM_PROVIDER_IDS } from "@graphrag/shared";
import { providersCatalog, toState } from "./llmRoutes.js";

describe("llm provider config", () => {
  it("catalog lists every supported provider with at least one model", () => {
    const catalog = providersCatalog();
    expect(catalog.map((p) => p.id)).toEqual(LLM_PROVIDER_IDS);
    for (const p of catalog) {
      expect(p.models.length).toBeGreaterThan(0);
      for (const m of p.models) {
        expect(["free", "freetier", "paid"]).toContain(m.tier);
      }
    }
  });

  it("the local provider (ollama) requires no api key and marks models free", () => {
    const ollama = providersCatalog().find((p) => p.id === "ollama");
    expect(ollama?.needsApiKey).toBe(false);
    expect(ollama?.models.every((m) => m.tier === "free")).toBe(true);
  });

  it("toState never exposes an api key and reports configured providers", () => {
    const state = toState({
      activeLlmProvider: "groq",
      llmConfig: {
        providers: {
          groq: { model: "openai/gpt-oss-20b", apiKey: "super-secret-key-that-must-not-leak", embeddingModel: "" },
          ollama: { model: "llama3.2", baseUrl: "http://localhost:11434/v1" }
        }
      } as unknown
    });
    expect(state.activeProvider).toBe("groq");
    expect(state.providers.groq?.configured).toBe(true);
    expect(state.providers.groq).not.toHaveProperty("apiKey");
    expect(JSON.stringify(state)).not.toContain("super-secret-key-that-must-not-leak");
    expect(state.providers.ollama?.configured).toBe(true);
  });

  it("lists Groq's OpenAI-compatible endpoint in the catalog", () => {
    const groq = providersCatalog().find((provider) => provider.id === "groq");
    expect(groq?.openAiCompatibleBaseUrl).toBe("https://api.groq.com/openai/v1");
    expect(groq?.models.map((model) => model.id)).toEqual([
      "openai/gpt-oss-20b",
      "openai/gpt-oss-120b",
      "qwen/qwen3.6-27b",
      "qwen/qwen3.8-27b"
    ]);
    expect(groq?.models.every((model) => model.tier === "free")).toBe(true);
  });
});
