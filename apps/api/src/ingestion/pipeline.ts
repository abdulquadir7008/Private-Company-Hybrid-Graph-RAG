import fs from "node:fs";
import path from "node:path";
import { Prisma, type Document, type DocumentChunk } from "@prisma/client";
import type { EntityType, ExtractedEntity, ExtractedRelationship } from "@graphrag/shared";
import { prisma } from "../db.js";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { extractTextFromFile, splitPages } from "./extractText.js";
import { detectStructure } from "./structure.js";
import { chunkDocument } from "./chunk.js";
import { extractFromChunk, heuristicEntities, heuristicRelationships } from "../extraction/entities.js";
import { validateRelationships } from "../extraction/relationships.js";
import { normalizeName, resolveEntity } from "../extraction/resolution.js";
import { upsertEntity, upsertRelationship, upsertDocumentChunkProvenance, linkChunkMention } from "../graph/repository.js";
import { getChunkAcl, getDocumentAcl } from "../access/aclRepository.js";
import { aclToChromaFlags } from "../access/policy.js";
import { upsertChunkVector, deleteChunkVector } from "../vector/chroma.js";
import { embedTexts, loadUserEmbeddingConfig, providerFromConfig, withLlmUser } from "../ai/llm.js";
import { AppError, NotFoundError } from "../errors.js";
import { graphStats } from "../graph/repository.js";

export class IngestionPipeline {
  /**
   * Resolve the embedding model name for a given user from their active LLM
   * provider config. Falls back to the env default when no user config exists.
   */
  async #resolveEmbeddingModel(userId?: string): Promise<string> {
    if (userId) {
      const cfg = await loadUserEmbeddingConfig(userId);
      if (cfg) {
        const provider = providerFromConfig(cfg);
        return provider.emodel;
      }
    }
    return config.OPENAI_EMBEDDING_MODEL;
  }

  async ingest(documentId: string, companyId: string, userId?: string): Promise<void> {
    const job = await this.createJob(documentId, companyId);
    try {
      await this.#run(documentId, companyId, job.id, userId);
    } catch (err) {
      await prisma.ingestionJob.update({
        where: { id: job.id },
        data: { status: "FAILED", error: err instanceof Error ? err.message : String(err), completedAt: new Date() }
      });
      await prisma.document.update({
        where: { id: documentId },
        data: { status: "FAILED", failureReason: err instanceof Error ? err.message : String(err) }
      });
      logger.error("ingestion failed", { err, meta: { documentId, companyId, jobId: job.id } });
      throw err;
    }
  }

  private async createJob(documentId: string, companyId: string) {
    const doc = await prisma.document.findFirst({ where: { id: documentId, companyId } });
    if (!doc) throw new NotFoundError("Document not found");
    await prisma.ingestionJob.updateMany({ where: { documentId }, data: { status: "SUPERSEDED" } });
    return prisma.ingestionJob.create({
      data: { companyId, documentId, status: "RUNNING", stage: "extract", progress: 5 }
    });
  }

  async #run(documentId: string, companyId: string, jobId: string, userId?: string): Promise<void> {
    const doc = await prisma.document.findUnique({ where: { id: documentId } });
    if (!doc) throw new NotFoundError("Document not found");

    await prisma.document.update({ where: { id: documentId }, data: { status: "PROCESSING" } });
    await prisma.ingestionJob.update({ where: { id: jobId }, data: { stage: "extract", progress: 10 } });

    const embeddingModel = await this.#resolveEmbeddingModel(userId);

    const storagePath = this.resolveStoragePath(doc);
    const extracted = await extractTextFromFile(storagePath, doc.mimeType, doc.originalName);
    if (!extracted.text.trim()) {
      throw new AppError(400, "No extractable text found in document", "EMPTY_DOCUMENT");
    }

    const { sections, pages } = detectStructure(extracted.text);
    const chunks = chunkDocument(extracted.text, sections, pages);

    await prisma.ingestionJob.update({ where: { id: jobId }, data: { stage: "chunk", progress: 20 } });

    // Delete previous graph + vectors for this document on reindex.
    await this.#cleanupPrevious(doc.id, companyId);

    // Persist chunks to PostgreSQL.
    const pgChunks: DocumentChunk[] = [];
    for (const c of chunks) {
      const created = await prisma.documentChunk.create({
        data: {
          documentId: doc.id,
          companyId,
          index: c.index,
          content: c.content,
          tokenCount: c.tokenCount,
          section: c.section,
          pageStart: c.pageStart,
          pageEnd: c.pageEnd,
          embeddingVersion: embeddingModel
        }
      });
      pgChunks.push(created);
      await upsertDocumentChunkProvenance({
        tenantId: companyId,
        pgDocumentId: doc.id,
        title: doc.title,
        pgChunkId: created.id,
        chunkIndex: c.index,
        section: c.section,
        pageStart: c.pageStart,
        pageEnd: c.pageEnd,
        text: c.content
      });
    }

    await prisma.document.update({
      where: { id: doc.id },
      data: { pageCount: extracted.pageCount, chunkCount: pgChunks.length, status: "PROCESSING" }
    });
    await prisma.ingestionJob.update({ where: { id: jobId }, data: { stage: "embed+graph", progress: 30 } });

    const docAcl = await getDocumentAcl(companyId, doc.id);
    const graphAcl = aclToChromaFlags(docAcl);

    // Build embeddings in one batch.
    await prisma.ingestionJob.update({ where: { id: jobId }, data: { stage: "embedding", progress: 35 } });
    const embeddings = await this.tryEmbed(pgChunks.map((c) => c.content));

    let totalEntities = 0;
    let totalRelationships = 0;
    const knownEntities = new Map<string, string>();
    let embedIndex = 0;

    for (const chunk of pgChunks) {
      const chunkAcl = await getChunkAcl(companyId, chunk.id);
      const effectiveAcl = {
        allowedRoles: chunkAcl.allowedRoles,
        allowedDepartments: chunkAcl.allowedDepartments,
        ownerId: chunkAcl.ownerId ?? docAcl.ownerId
      };
      const flags = aclToChromaFlags(effectiveAcl);
      const metadata: Record<string, string | number | boolean | null> = {
        documentId: doc.id,
        companyId,
        chunk_index: chunk.index,
        section: chunk.section,
        pageStart: chunk.pageStart,
        pageEnd: chunk.pageEnd,
        title: doc.title,
        content_preview: chunk.content.slice(0, 200),
        ...flags
      };

      // Store vector even if embedding generation is unavailable (fallback).
      await upsertChunkVector({
        chromaId: chunk.id,
        embedding: embeddings[embedIndex],
        content: chunk.content,
        metadata: metadata as never
      });
      embedIndex += 1;

      // Graph extraction for this chunk.
      let result;
      try {
        result = await extractFromChunk(
          { tenantId: companyId, documentId: doc.id, chunkId: chunk.id, section: chunk.section, page: chunk.pageStart },
          chunk.content
        );
      } catch {
        result = { entities: heuristicEntities(chunk.content), relationships: [] };
      }
      const entities = result.entities.length ? result.entities : heuristicEntities(chunk.content);
      const relationships = result.relationships.length
        ? result.relationships
        : heuristicRelationships(chunk.content, entities);

      // Validate + persist entities.
      for (const ent of entities as ExtractedEntity[]) {
        const normalized = normalizeName(ent.name, ent.type);
        const existingId = await this.resolveSafely({ tenantId: companyId, name: ent.name, type: ent.type, normalizedName: normalized });
        const ns = existingId ?? null;
        await upsertEntity({
          tenantId: companyId,
          name: ent.name,
          normalizedName: normalized,
          type: ent.type,
          description: ent.description || null,
          confidence: ent.confidence,
          documentId: doc.id,
          chunkId: chunk.id,
          page: chunk.pageStart,
          section: chunk.section,
          sourceText: ent.description
        });
        await linkChunkMention({ tenantId: companyId, pgChunkId: chunk.id, entityName: ent.name, confidence: ent.confidence, sourceText: chunk.content.slice(0, 500), section: chunk.section, page: chunk.pageStart });
        knownEntities.set(ent.name, ent.type);
        totalEntities += 1;
        await prisma.documentEntity.create({
          data: {
            companyId,
            documentId: doc.id,
            chunkId: chunk.id,
            name: ent.name,
            type: ent.type,
            description: ent.description || null,
            confidence: ent.confidence,
            page: chunk.pageStart ?? undefined,
            section: chunk.section,
            sourceText: chunk.content.slice(0, 400),
            graphNodeId: ns ?? undefined,
            resolved: ns != null
          }
        });
        void existingId;
      }

      const validatedRels = validateRelationships(relationships as ExtractedRelationship[], knownEntities);
      for (const rel of validatedRels) {
        const st = knownEntities.get(rel.source);
        const tt = knownEntities.get(rel.target);
        if (!st || !tt) continue;
        await upsertRelationship({
          tenantId: companyId,
          sourceName: rel.source,
          sourceType: st as never,
          targetName: rel.target,
          targetType: tt as never,
          type: rel.type,
          confidence: rel.confidence,
          documentId: doc.id,
          chunkId: chunk.id,
          page: chunk.pageStart,
          section: chunk.section,
          sourceText: chunk.content.slice(0, 500)
        });
        totalRelationships += 1;
      }

      await prisma.ingestionJob.update({
        where: { id: jobId },
        data: { stage: `chunk ${chunk.index}/${pgChunks.length}`, progress: 40 + Math.round((60 / pgChunks.length) * (chunk.index + 1)) }
      });
    }

    // Update PG stats.
    await prisma.document.update({
      where: { id: doc.id },
      data: {
        status: "INDEXED",
        entityCount: totalEntities,
        relationshipCount: totalRelationships,
        ingestedAt: new Date()
      }
    });
    await this.#updateGraphStats(companyId);

    await prisma.ingestionJob.update({
      where: { id: jobId },
      data: { status: "COMPLETED", stage: "done", progress: 100, completedAt: new Date() }
    });
    logger.info("ingestion completed", { meta: { documentId: doc.id, chunks: pgChunks.length, entities: totalEntities, relationships: totalRelationships } });
  }

  private resolveStoragePath(doc: Document): string {
    const p = path.isAbsolute(doc.storagePath) ? doc.storagePath : path.join(config.UPLOAD_DIR, doc.storagePath);
    if (!fs.existsSync(p)) throw new AppError(404, "Stored file missing", "FILE_MISSING");
    return p;
  }

  private async resolveSafely(input: { tenantId: string; name: string; type: EntityType; normalizedName: string }): Promise<string | null> {
    try {
      return await resolveEntity(input);
    } catch (err) {
      logger.warn("entity resolution failed, creating fresh", { err, meta: { name: input.name } });
      return null;
    }
  }

  private async tryEmbed(texts: string[]): Promise<(number[] | undefined)[]> {
    try {
      const em = await embedTexts(texts);
      return em;
    } catch (err) {
      logger.warn("embedding generation failed; indexing without vectors", { err });
      return texts.map(() => undefined);
    }
  }

  async #cleanupPrevious(documentId: string, companyId: string): Promise<void> {
    await deleteChunkVector(documentId);
    const chunks = await prisma.documentChunk.findMany({ where: { documentId } });
    for (const c of chunks) {
      await prisma.documentEntity.deleteMany({ where: { chunkId: c.id } });
      await prisma.documentChunk.delete({ where: { id: c.id } });
    }
    // Graph cleanup handled by graph repo (deleteDocumentSubgraph) — deferred.
    const { deleteDocumentSubgraph } = await import("../graph/repository.js");
    await deleteDocumentSubgraph(companyId, documentId);
  }

  /**
   * Start a company-wide reindex after a provider/embedding-model change.
   *
   * The PROCESSING state is written before this method resolves. This is
   * important to callers that show a blocking progress view: they can safely
   * begin polling as soon as the API response arrives without racing the
   * background ingestion tasks.
   */
  async reindexAll(companyId: string, userId: string): Promise<void> {
    const docs = await prisma.document.findMany({
      where: { companyId, status: { in: ["INDEXED", "FAILED"] } },
      select: { id: true }
    });

    if (docs.length > 0) {
      await prisma.document.updateMany({
        where: { id: { in: docs.map((doc) => doc.id) } },
        data: { status: "PROCESSING", failureReason: null }
      });
    }

    logger.info("reindexAll triggered", { meta: { companyId, documentCount: docs.length } });
    for (const doc of docs) {
      // Bind the user's provider into the async context so embedTexts /
      // extractFromChunk use the newly activated embedding + chat models.
      withLlmUser(userId, () => this.ingest(doc.id, companyId, userId)).catch((err) => {
        logger.warn("reindexAll: document reindex failed", { err, meta: { documentId: doc.id } });
      });
    }
  }

  async #updateGraphStats(companyId: string): Promise<void> {
    try {
      const gs = await graphStats(companyId);
      const failed = await prisma.ingestionJob.count({ where: { companyId, status: "FAILED" } });
      const dup = await prisma.documentEntity.groupBy({ by: ["name"], where: { companyId }, _count: { _all: true }, having: { name: { _count: { gt: 1 } } } });
      const orphan = await prisma.documentEntity.count({ where: { companyId } });
      const docs = await prisma.document.count({ where: { companyId, status: "INDEXED" } });
      const avgConf = await prisma.documentEntity.aggregate({ where: { companyId }, _avg: { confidence: true } });
      await prisma.graphStats.upsert({
        where: { companyId },
        create: {
          companyId,
          entityCount: gs.entities,
          relationshipCount: gs.relationships,
          documentCount: docs,
          orphanCount: orphan,
          duplicateEntityCount: dup.length,
          avgConfidence: avgConf._avg.confidence ?? 0,
          failedExtractionCount: failed
        },
        update: {
          entityCount: gs.entities,
          relationshipCount: gs.relationships,
          documentCount: docs,
          orphanCount: orphan,
          duplicateEntityCount: dup.length,
          avgConfidence: avgConf._avg.confidence ?? 0,
          failedExtractionCount: failed
        }
      });
    } catch (err) {
      logger.warn("graph stats update failed", { err });
    }
  }
}

export const ingestionPipeline = new IngestionPipeline();
export { Prisma };
