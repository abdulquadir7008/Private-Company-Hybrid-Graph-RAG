import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@graphrag/shared": path.join(here, "../../packages/shared/src/index.ts")
    }
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    testTimeout: 30000,
    hookTimeout: 30000,
    env: {
      DATABASE_URL: "postgresql://graphrag_user:graphrag_password@localhost:5433/graphrag?schema=public",
      JWT_SECRET: "test-only-secret",
      OPENAI_API_KEY: "",
      HUGGINGFACE_API_KEY: "",
      ENABLE_DEMO_SETUP: "false"
    }
  }
});