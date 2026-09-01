import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  API_PORT: z.coerce.number().default(parseInt(process.env.PORT || "4000", 10)),
  WEB_URL: z.string().default("http://localhost:3000"),
  UPLOAD_DIR: z.string().default("./uploads"),

  NEO4J_URI: z.string().min(1).default("bolt://localhost:7687"),
  NEO4J_USERNAME: z.string().default("neo4j"),
  NEO4J_PASSWORD: z.string().default("password"),
  NEO4J_DATABASE: z.string().default("neo4j"),

  CHROMA_URL: z.string().default("http://localhost:8000"),
  CHROMA_COLLECTION: z.string().default("graphrag_chunks"),
  CHROMA_API_KEY: z.string().optional().default(""),

  AI_PROVIDER: z.enum(["openai", "huggingface"]).default("openai"),
  OPENAI_API_KEY: z.string().optional().default(""),
  OPENAI_CHAT_MODEL: z.string().default("gpt-4o-mini"),
  OPENAI_EMBEDDING_MODEL: z.string().default("text-embedding-3-small"),
  HUGGINGFACE_API_KEY: z.string().optional().default(""),
  HUGGINGFACE_CHAT_MODEL: z.string().default("meta-llama/Llama-3.3-70B-Instruct"),
  HUGGINGFACE_EMBEDDING_MODEL: z.string().default("sentence-transformers/all-MiniLM-L6-v2"),

  JWT_SECRET: z.string().default("dev-only-insecure-secret-change-me"),
  JWT_EXPIRES_IN: z.string().default("1d"),

  SENDGRID_API_KEY: z.string().optional().default(""),
  SENDGRID_FROM: z.string().optional().default(""),

  ROOT_ADMIN_EMAIL: z.string().optional().default(""),
  ROOT_ADMIN_PASSWORD: z.string().optional().default(""),

  ENABLE_DEMO_SETUP: z.string().default("true"),

  MAX_VECTOR_RESULTS: z.coerce.number().default(20),
  MAX_GRAPH_DEPTH: z.coerce.number().default(3),
  MAX_GRAPH_NODES: z.coerce.number().default(50),
  TOP_K_RERANKED: z.coerce.number().default(10),
  OUTBOUND_EMAIL: z.string().default("console") // "console" | "sendgrid"
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error("Invalid environment configuration:", parsed.error.flatten().fieldErrors);
  throw new Error("Invalid environment configuration");
}

export type Env = z.infer<typeof envSchema>;

export const config = {
  ...parsed.data,
  isDemoSetupEnabled: parsed.data.ENABLE_DEMO_SETUP !== "false",
  isOpenAI: parsed.data.AI_PROVIDER === "openai",
  isHuggingFace: parsed.data.AI_PROVIDER === "huggingface",
  hasLLM:
    parsed.data.AI_PROVIDER === "openai"
      ? parsed.data.OPENAI_API_KEY.length > 0
      : parsed.data.HUGGINGFACE_API_KEY.length > 0
} satisfies Env & {
  isDemoSetupEnabled: boolean;
  isOpenAI: boolean;
  isHuggingFace: boolean;
  hasLLM: boolean;
};

export const IS_TEST = process.env.NODE_ENV === "test";