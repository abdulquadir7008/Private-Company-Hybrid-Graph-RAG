import * as chromadb from "chromadb";
import type { Principal } from "@graphrag/shared";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { buildChromaAccessFilter } from "../access/policy.js";

export interface ChunkMetadata {
  documentId: string;
  companyId: string;
  chunk_index: number;
  section: string | null;
  pageStart: number | null;
  pageEnd: number | null;
  title: string;
  content_preview: string;
  // ACL flags are expanded per-chunk at index time.
  [key: string]: string | number | boolean | null;
}

/** Chroma metadata disallows null/undefined values; strip them explicitly. */
export function sanitizeMetadata(meta: Record<string, string | number | boolean | null>): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (v !== null && v !== undefined) out[k] = v;
  }
  return out;
}

let collection: chromadb.Collection | null = null;
let chromaUnavailable = false;

function client(): chromadb.ChromaClient {
  const opts: chromadb.ChromaClientParams = { path: config.CHROMA_URL };
  if (config.CHROMA_API_KEY) {
    opts.auth = {
      provider: "token",
      credentials: config.CHROMA_API_KEY,
      tokenHeaderType: "X_CHROMA_TOKEN"
    };
  }
  return new chromadb.ChromaClient(opts);
}

export async function getCollection(): Promise<chromadb.Collection> {
  if (chromaUnavailable) throw new Error("Chroma is unavailable");
  if (collection) return collection;
  try {
    const c = client();
    collection = await c.getOrCreateCollection({ name: config.CHROMA_COLLECTION, metadata: { "hnsw:space": "cosine" } });
    return collection;
  } catch (err) {
    chromaUnavailable = true;
    throw err;
  }
}

export function isChromaAvailable(): boolean {
  return !chromaUnavailable;
}

export async function upsertChunkVector(opts: {
  chromaId: string;
  embedding: number[] | undefined;
  content: string;
  metadata: ChunkMetadata;
}): Promise<void> {
  const embedding = opts.embedding ?? [];
  if (embedding.length === 0) return;
  try {
    const col = await getCollection();
    await col.upsert({
      ids: [opts.chromaId],
      embeddings: [embedding],
      documents: [opts.content],
      metadatas: [sanitizeMetadata(opts.metadata)]
    });
  } catch (err) {
    logger.warn("chroma upsert failed; continuing without vectors", { err, meta: { chromaId: opts.chromaId } });
  }
}

export async function deleteChunkVector(chromaId: string): Promise<void> {
  try {
    const col = await getCollection();
    await col.delete({ ids: [chromaId] });
  } catch (err) {
    logger.warn("chroma delete failed", { err, meta: { chromaId } });
  }
}

export interface VectorHit {
  id: string;
  score: number;
  documentId: string;
  companyId: string;
  chunkIndex: number;
  section: string | null;
  pageStart: number | null;
  pageEnd: number | null;
  title: string;
  content: string;
}

/**
 * ACL-filtered similarity search. The authorization filter is applied INSIDE
 * the query, so unauthorized chunks are never retrieved or scored.
 */
export async function vectorSearch(opts: {
  principal: Principal;
  query: string;
  embedding: number[];
  limit?: number;
  additionalWhere?: Record<string, unknown>;
}): Promise<VectorHit[]> {
  const filter = buildChromaAccessFilter(opts.principal);
  if (!filter || opts.principal.companyId == null) return [];
  const where = opts.additionalWhere ? { $and: [filter, opts.additionalWhere] } : filter;

  try {
    const col = await getCollection();
    const res = await col.query({
      queryEmbeddings: [opts.embedding],
      nResults: opts.limit ?? config.MAX_VECTOR_RESULTS,
      where
    });

    const hits: VectorHit[] = [];
    const ids = res.ids[0] ?? [];
    const distances = res.distances?.[0] ?? [];
    const metadatas = res.metadatas?.[0] ?? [];
    const documents = res.documents?.[0] ?? [];
    for (let i = 0; i < ids.length; i++) {
      const meta = (metadatas[i] ?? {}) as Record<string, unknown>;
      // Fail-closed double-check: any result that somehow lacks the tenantId
      // match is dropped.
      if (meta.companyId !== opts.principal.companyId) continue;
      hits.push({
        id: ids[i],
        score: 1 - (distances[i] ?? 1),
        documentId: String(meta.documentId ?? ""),
        companyId: String(meta.companyId ?? ""),
        chunkIndex: Number(meta.chunk_index ?? 0),
        section: (meta.section as string | null) ?? null,
        pageStart: meta.pageStart != null ? Number(meta.pageStart) : null,
        pageEnd: meta.pageEnd != null ? Number(meta.pageEnd) : null,
        title: String(meta.title ?? ""),
        content: documents[i] ?? ""
      });
    }
    return hits;
  } catch (err) {
    logger.warn("vector search unavailable; continuing without vectors", { err });
    return [];
  }
}

export async function chromaCount(): Promise<number> {
  try {
    const col = await getCollection();
    return col.count();
  } catch {
    return 0;
  }
}

/** Full text / metadata lookup used by "keyword" retrieval. */
export async function metadataSearch(opts: {
  principal: Principal;
  where: Record<string, unknown>;
  limit?: number;
}): Promise<VectorHit[]> {
  const filter = buildChromaAccessFilter(opts.principal);
  if (!filter || opts.principal.companyId == null) return [];
  const where = { $and: [filter, opts.where] };
  try {
    const col = await getCollection();
    const res = await col.get({ where, limit: opts.limit ?? 20 });
    const items = res.ids ?? [];
    const out: VectorHit[] = [];
    for (let i = 0; i < items.length; i++) {
      const meta = (res.metadatas?.[i] ?? {}) as Record<string, unknown>;
      if (meta.companyId !== opts.principal.companyId) continue;
      out.push({
        id: items[i],
        score: 1,
        documentId: String(meta.documentId ?? ""),
        companyId: String(meta.companyId ?? ""),
        chunkIndex: Number(meta.chunk_index ?? 0),
        section: (meta.section as string | null) ?? null,
        pageStart: meta.pageStart != null ? Number(meta.pageStart) : null,
        pageEnd: meta.pageEnd != null ? Number(meta.pageEnd) : null,
        title: String(meta.title ?? ""),
        content: String(res.documents?.[i] ?? "")
      });
    }
    return out;
  } catch (err) {
    logger.warn("chroma metadata search unavailable; continuing without vectors", { err });
    return [];
  }
}

export async function deleteDocumentVectors(documentId: string): Promise<void> {
  try {
    const col = await getCollection();
    await col.delete({ where: { documentId } });
  } catch (err) {
    logger.warn("chroma bulk delete failed", { err });
  }
}