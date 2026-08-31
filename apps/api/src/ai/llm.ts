import { config } from "../config.js";
import OpenAI from "openai";
import { HfInference } from "@huggingface/inference";

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

class OpenAIProvider implements LlmProvider {
  private client: OpenAI;
  readonly emodel: string;
  readonly cmodel: string;

  constructor() {
    this.client = new OpenAI({ apiKey: config.OPENAI_API_KEY });
    this.cmodel = config.OPENAI_CHAT_MODEL;
    this.emodel = config.OPENAI_EMBEDDING_MODEL;
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
      usage: {
        promptTokens: res.usage?.prompt_tokens,
        completionTokens: res.usage?.completion_tokens,
        totalTokens: res.usage?.total_tokens
      }
    };
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const res = await this.client.embeddings.create({ model: this.emodel, input: texts });
    return res.data.map((d) => d.embedding);
  }
}

class HuggingFaceProvider implements LlmProvider {
  private client: HfInference;
  readonly emodel: string;
  readonly cmodel: string;

  constructor() {
    this.client = new HfInference(config.HUGGINGFACE_API_KEY);
    this.cmodel = config.HUGGINGFACE_CHAT_MODEL;
    this.emodel = config.HUGGINGFACE_EMBEDDING_MODEL;
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
    // hf-inference embeds one string at a time via featureExtraction.
    for (const t of texts) {
      const r = await this.client.featureExtraction({ model: this.emodel, inputs: t });
      out.push(r as number[]);
    }
    return out;
  }
}

let provider: LlmProvider | null = null;

export function getLlmProvider(): LlmProvider {
  if (provider) return provider;
  if (config.isHuggingFace) {
    provider = new HuggingFaceProvider();
  } else {
    provider = new OpenAIProvider();
  }
  return provider;
}

export function registerProviderFactory(factory: () => LlmProvider): void {
  provider = factory();
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  return getLlmProvider().embed(texts);
}

export async function chatCompletion(
  messages: ChatMessage[],
  opts?: { temperature?: number; maxTokens?: number }
): Promise<LlmChatResponse> {
  return getLlmProvider().chat(messages, opts);
}