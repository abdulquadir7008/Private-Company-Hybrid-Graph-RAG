-- AlterTable
ALTER TABLE "User" ADD COLUMN "activeLlmProvider" TEXT,
ADD COLUMN "llmConfig" JSONB;
