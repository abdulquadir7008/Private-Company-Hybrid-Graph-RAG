import type { Principal, QueryKind, QueryPlan } from "@graphrag/shared";
import { prisma } from "../db.js";
import { config } from "../config.js";
import { runQuery } from "../graph/driver.js";
import { authPredicate } from "../graph/acl.js";
import { authorizedDocumentIds } from "../access/aclRepository.js";

/**
 * Query planning: classify the user's question and produce a validated,
 * bounded retrieval plan. The LLM is never allowed to execute Cypher;
 * plans are structured data with explicit caps (depth, result counts).
 */

const STOPWORDS = new Set([
  "the","a","an","what","which","who","how","why","when","where","do","does","did","is","are","was",
  "be","been","to","of","in","for","on","by","with","and","or","not","about","please","can","you",
  "explain","tell","me","this","that","these","those","i","my","we","our","their","its","it","have","has","had"
]);

/** Words that break capitalized runs (question stems + connectives). */
const CUTWORDS = new Set([
  "who","what","which","why","when","where","how","does","do","did","is","are","was","were",
  "the","a","an","and","or","of","to","for","from","at","on","in","by","with","that","this",
  "his","her","their","our","my","its","me","it"
]);

export function classifyKind(question: string): QueryKind {
  const q = question.toLowerCase();
  if (/\b(compare|comparison|versus|vs\.?|difference between|similarities|differences)\b/.test(q)) return "comparison";
  if (/\b(how many|count|total|number of|all|list)\b/.test(q)) return "aggregation";
  if (/\b(who|whom|whose|which department|which person|who owns|who manages|responsible for|chain of|managed by|owned by|reports to)\b/.test(q)) return "relationship_lookup";
  if (/\b(related to|connected|affects|affect|depends|impacted|mention|connected to|neighborhood|path between)\b/.test(q)) return "multi_hop";
  if (/\b(what is|what are|define|definition|explain|summarize|describe|policy about)\b/.test(q)) return "hybrid";
  if (/\b(what|which|where)\b/.test(q)) return "semantic_lookup";
  return "hybrid";
}

export function extractSearchTerms(question: string): string[] {
  const tokens = question
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
  return Array.from(new Set(tokens)).slice(0, 12);
}

export interface EntityDetection {
  names: string[];
  normalized: string[];
}

/** Detect entity references by matching question terms against the authorized graph. */
export async function detectEntities(principal: Principal, question: string): Promise<EntityDetection> {
  const tenantId = principal.companyId;
  if (!tenantId) return { names: [], normalized: [] };
  const authDocs = Array.from(await authorizedDocumentIds(principal));
  if (authDocs.length === 0) return { names: [], normalized: [] };

  const names = extractEntityNameCandidates(question);
  if (names.length === 0) return { names: [], normalized: [] };

  const rows = await runQuery<{ e: Record<string, unknown> }>(
    `MATCH (e:Entity {tenantId: $tenantId})
     WHERE ${authPredicate("e")}
     AND (toLower(e.name) IN $names OR toLower(e.normalizedName) IN $names)
     RETURN properties(e) AS e LIMIT 20`,
    { tenantId, authDocs, names }
  );
  const out = rows.map((r) => String((r.e as { name?: unknown }).name ?? ""));
  return { names: out, normalized: out.map((n) => n.toLowerCase()) };
}

export function extractEntityNameCandidates(question: string): string[] {
  const candidates: string[] = [];
  const quoted = question.match(/["“”'`]([^"“”'`]{3,80})["“”'`]/g) ?? [];
  candidates.push(...quoted.map((q) => q.replace(/["“”'`]/g, " ").trim().toLowerCase()));

  // Run extraction: consecutive Capitalized words (with no lowercase word between
  // them) form proper-noun-like phrases. Lowercase words break the run.
  const tokens = question.match(/[A-Za-z][A-Za-z0-9'&.\-]*/g) ?? [];
  const words: { raw: string; upper: boolean }[] = tokens.map((tok) => ({
    raw: tok,
    upper: /^[A-Z]/.test(tok) && tok.length >= 2
  }));
  let i = 0;
  while (i < words.length) {
    if (!words[i].upper) {
      i += 1;
      continue;
    }
    const low = words[i].raw.toLowerCase();
    if (CUTWORDS.has(low) || STOPWORDS.has(low)) {
      i += 1;
      continue;
    }
    const run = [words[i].raw];
    let j = i + 1;
    while (
      j < words.length &&
      words[j].upper &&
      !CUTWORDS.has(words[j].raw.toLowerCase()) &&
      !STOPWORDS.has(words[j].raw.toLowerCase())
    ) {
      run.push(words[j].raw);
      j += 1;
    }
    if (run.length >= 2) {
      candidates.push(run.join(" ").toLowerCase());
    } else if (words[i].raw.length >= 4) {
      candidates.push(words[i].raw.toLowerCase());
    }
    i = j;
  }

  return Array.from(new Set(candidates.map((c) => c.trim()).filter((c) => c.length >= 2)));
}

export interface KeywordHit {
  documentId: string;
  title: string;
  score: number;
  chunkId: string | null;
  chunkText: string | null;
}

/** Keyword search over document titles + chunk sections in PostgreSQL. */
export async function keywordDocuments(principal: Principal, terms: string[]): Promise<KeywordHit[]> {
  if (!principal.companyId || terms.length === 0) return [];
  const lower = terms.map((t) => t.toLowerCase());
  const rows = await prisma.document.findMany({
    where: {
      companyId: principal.companyId,
      status: "INDEXED",
      OR: terms.map((t) => ({ title: { contains: t, mode: "insensitive" } }))
    },
    select: { id: true, title: true }
  });

  const scored: KeywordHit[] = [];
  for (const row of rows) {
    const chunks = await topMatchingChunks(row.id, lower, 5);
    for (const c of chunks) {
      scored.push({
        documentId: row.id,
        title: row.title,
        score: 1 + Math.min(10, c.hits),
        chunkId: c.id,
        chunkText: c.content
      });
    }
    if (chunks.length === 0) {
      scored.push({ documentId: row.id, title: row.title, score: 1, chunkId: null, chunkText: null });
    }
  }

  // No title matched: rescue by searching chunk content so content-only
  // questions (e.g. ownership clauses inside policies) still resolve.
  if (scored.length === 0) {
    const chunks = await prisma.documentChunk.findMany({
      where: {
        companyId: principal.companyId,
        document: { status: "INDEXED" },
        OR: lower.map((t) => ({ content: { contains: t, mode: "insensitive" } }))
      },
      select: { id: true, content: true, documentId: true, document: { select: { title: true } } },
      orderBy: { index: "asc" },
      take: 30
    });
    const byDoc = new Map<string, { chunk: { id: string; content: string; documentId: string; title: string }; hits: number }>();
    for (const chunk of chunks) {
      const hits = termOverlap(chunk.content, lower);
      if (hits === 0) continue;
      const prior = byDoc.get(chunk.documentId);
      if (!prior || hits > prior.hits) {
        byDoc.set(chunk.documentId, { chunk: { id: chunk.id, content: chunk.content, documentId: chunk.documentId, title: chunk.document.title }, hits });
      }
    }
    for (const hit of byDoc.values()) {
      scored.push({
        documentId: hit.chunk.documentId,
        title: hit.chunk.title,
        score: 1 + Math.min(10, hit.hits),
        chunkId: hit.chunk.id,
        chunkText: hit.chunk.content
      });
    }
  }

  return scored.sort((a, b) => b.score - a.score);
}

async function topMatchingChunks(documentId: string, terms: string[], take: number): Promise<{ id: string; content: string; hits: number }[]> {
  const chunks = await prisma.documentChunk.findMany({
    where: { documentId, OR: terms.map((t) => ({ content: { contains: t, mode: "insensitive" } })) },
    select: { id: true, content: true, index: true },
    orderBy: { index: "asc" }
  });
  return chunks
    .map((c) => ({
      id: c.id,
      content: c.content,
      index: c.index,
      hits: termOverlap(c.content, terms)
    }))
    .filter((c) => c.hits > 0)
    .sort((a, b) => b.hits - a.hits || a.index - b.index)
    .slice(0, take);
}

function termOverlap(text: string, terms: string[]): number {
  const lower = text.toLowerCase();
  let hits = 0;
  for (const t of terms) {
    const escaped = t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const m = lower.match(new RegExp(escaped, "g"));
    if (m) hits += m.length;
  }
  return hits;
}

export function buildPlan(
  question: string,
  detection: EntityDetection,
  opts: { depth?: number } = {}
): QueryPlan {
  const kind = classifyKind(question);
  const terms = extractSearchTerms(question);
  const maxDepth = clampDepth(opts.depth ?? config.MAX_GRAPH_DEPTH);
  const hasEntityMatch = detection.names.length > 0;
  const validationErrors: string[] = [];
  if (maxDepth > config.MAX_GRAPH_DEPTH) validationErrors.push("depth exceeds configured maximum");

  const graphEnabled = hasEntityMatch || kind === "relationship_lookup" || kind === "multi_hop";
  const keywordEnabled = kind === "entity_lookup" || kind === "semantic_lookup" || kind === "aggregation";
  const vectorEnabled = kind === "hybrid" || kind === "semantic_lookup" || kind === "comparison" || kind !== "multi_hop" || true;

  return {
    kind,
    question,
    detectedEntities: detection.names,
    searchTerms: terms,
    vectorEnabled,
    graphEnabled,
    keywordEnabled,
    maxDepth,
    validationErrors
  };
}

function clampDepth(depth: number): number {
  const bound = Math.min(depth, config.MAX_GRAPH_DEPTH);
  return Math.max(1, bound);
}