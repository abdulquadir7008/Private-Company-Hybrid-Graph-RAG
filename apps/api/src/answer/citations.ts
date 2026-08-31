import type { Citation, EvidenceItem } from "@graphrag/shared";
import { config } from "../config.js";

/**
 * Builds [1][2][3] style citations from the reranked evidence set. Each
 * citation points at a real PostgreSQL document + chunk, preserving the
 * source-traceability guarantee (no fabricated citations possible).
 */
export function buildCitations(evidence: EvidenceItem[], limit = 8): Citation[] {
  const seen = new Set<string>();
  const citations: Citation[] = [];
  let index = 1;

  for (const item of evidence) {
    if (!item.documentId || !item.chunkId) continue;
    if (item.aclStatus !== "authorized") continue;
    const key = `${item.documentId}:${item.chunkId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    citations.push({
      index,
      documentId: item.documentId,
      documentName: item.documentTitle ?? "Source document",
      section: item.section ?? null,
      page: item.pageStart ?? null,
      chunkId: item.chunkId,
      text: item.text.slice(0, 500),
      url: `${config.WEB_URL}/documents/${item.documentId}`
    });
    index += 1;
    if (citations.length >= limit) break;
  }
  return citations;
}