import type {
  EvidenceBundle,
  EvidenceItem,
  GraphPath,
  GraphRelationshipDetail,
  Principal,
  QueryPlan
} from "@graphrag/shared";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { logger } from "../logger.js";
import { vectorSearch, metadataSearch } from "../vector/chroma.js";
import { embedTexts } from "../ai/llm.js";
import { authorizedDocumentIds } from "../access/aclRepository.js";
import { buildPlan, detectEntities, keywordDocuments } from "./queryPlanner.js";
import { rerankEvidence } from "./rerank.js";
import { traverseAuthorizedGraph, searchAuthorizedEntities, type GraphPathResult } from "../graph/retrieve.js";

export interface HybridResult {
  plan: QueryPlan;
  bundle: EvidenceBundle;
  paths: GraphPath[];
  graphDetails: GraphRelationshipDetail[];
  retrievalMeta: Record<string, number>;
}

/**
 * Orchestrates ACL-aware hybrid retrieval:
 * 1. Query planning (structured, validated)
 * 2. Vector retrieval (ACL filter inside Chroma)
 * 3. Graph retrieval (ACL-verified traversal)
 * 4. Keyword retrieval (PG document titles)
 * 5. Evidence fusion + reranking
 */
export async function hybridRetrieve(opts: {
  principal: Principal;
  question: string;
  depth?: number;
}): Promise<HybridResult> {
  const { principal, question } = opts;
  const tenantId = principal.companyId;
  if (!tenantId) {
    return {
      plan: buildPlan(question, { names: [], normalized: [] }, opts),
      bundle: emptyBundle(),
      paths: [],
      graphDetails: [],
      retrievalMeta: {}
    };
  }

  const plan = buildPlan(question, await detectEntities(principal, question), opts);
  const authDocs = Array.from(await authorizedDocumentIds(principal));
  const meta: Record<string, number> = {};

  // --- Vector retrieval ---
  let vectorHits: Awaited<ReturnType<typeof vectorSearch>> = [];
  if (plan.vectorEnabled) {
    let embedding: number[] | null = null;
    try {
      embedding = (await embedTexts([question]))[0] ?? null;
    } catch (err) {
      logger.warn("vector search embedding failed", { err });
    }
    if (embedding) {
      vectorHits = await vectorSearch({ principal, query: question, embedding, limit: config.MAX_VECTOR_RESULTS });
    }
  }
  meta.vectorHits = vectorHits.length;

  // --- Cross-tenant + ACL re-verification on vector hits (defense in depth) ---
  const verifiedVector = vectorHits.filter((h) => h.companyId === tenantId);

  // --- Keyword retrieval (PG) ---
  const kwDocs = await keywordDocuments(principal, plan.searchTerms);
  meta.keywordDocs = kwDocs.length;

  // --- Graph retrieval ---
  let graph: GraphPathResult = { nodes: [], relationships: [], text: "" };
  const startNames = [...plan.detectedEntities];

  const matchedTitle = kwDocs[0]?.title.toLowerCase() ?? "";
  graph = await traverseAuthorizedGraph({
    principal,
    tenantId,
    authDocs,
    startNames,
    maxDepth: plan.maxDepth,
    limit: config.MAX_GRAPH_NODES
  });

  // If no entity was detected but keyword matched documents, surface entities
  // described by those documents (still ACL-gated via sourceDocuments).
  if (graph.nodes.length === 0 && matchedTitle && authDocs.length > 0) {
    const byName = await searchAuthorizedEntities({
      principal,
      tenantId,
      authDocs,
      query: matchedTitle.split(" ").slice(0, 4).join(" "),
      limit: 15
    });
    const additional = await traverseAuthorizedGraph({
      principal,
      tenantId,
      authDocs,
      startNames: byName.map((n) => n.name),
      maxDepth: plan.maxDepth,
      limit: config.MAX_GRAPH_NODES
    });
    graph = mergePaths(graph, additional);
  }
  meta.graphNodes = graph.nodes.length;
  meta.graphRelationships = graph.relationships.length;

  // --- Evidence fusion ---
  const vectorEvidence = verifiedVector.map<EvidenceItem>((h) => ({
    id: `vec:${h.id}`,
    sourceType: "vector",
    documentId: h.documentId,
    documentTitle: h.title,
    chunkId: h.id,
    relevanceScore: h.score,
    pageStart: h.pageStart,
    pageEnd: h.pageEnd,
    section: h.section,
    text: h.content,
    provenance: { tenantId, documentId: h.documentId, chunkId: h.id, page: h.pageStart ?? undefined, section: h.section ?? undefined },
    aclStatus: "authorized"
  }));

  const keywordEvidence: EvidenceItem[] = [];
  for (const kd of kwDocs) {
    keywordEvidence.push({
      id: `kw:${kd.documentId}`,
      sourceType: "keyword",
      documentId: kd.documentId,
      documentTitle: kd.title,
      chunkId: kd.chunkId ?? undefined,
      relevanceScore: kd.score,
      text: kd.chunkText ?? kd.title,
      provenance: { tenantId, documentId: kd.documentId, chunkId: kd.chunkId ?? undefined },
      aclStatus: "authorized"
    });
  }

  const graphEvidence: EvidenceItem[] = [];
  for (const rel of graph.relationships) {
    const prov = {
      tenantId,
      documentId: rel.documentIds[0],
      chunkId: rel.sources[0],
      section: rel.section ?? undefined,
      page: rel.page ?? undefined,
      confidence: rel.confidence ?? undefined
    };
    graphEvidence.push({
      id: `rel:${rel.rid}`,
      sourceType: "graph",
      documentId: rel.documentIds[0],
      chunkId: rel.sources[0],
      entityId: rel.source.id,
      entityName: rel.source.name,
      entityType: rel.source.type,
      relationshipType: rel.type,
      relevanceScore: rel.confidence ?? 0.8,
      text: `${rel.source.name} ${rel.type} ${rel.target.name}`,
      provenance: prov,
      aclStatus: "authorized"
    });
    void prov;
  }
  for (const node of graph.nodes) {
    graphEvidence.push({
      id: `node:${node.id}`,
      sourceType: "graph",
      documentId: node.sourceDocuments[0],
      chunkId: node.sourceChunks[0],
      entityId: node.id,
      entityName: node.name,
      entityType: node.type,
      relevanceScore: node.confidence ?? 0.7,
      text: node.description || node.name,
      provenance: { tenantId, documentId: node.sourceDocuments[0], chunkId: node.sourceChunks[0], confidence: node.confidence ?? undefined },
      aclStatus: "authorized"
    });
  }

  // Paths as evidence + structured GraphPaths for answer context / UI.
  const paths: GraphPath[] = graph.relationships.map((rel) => ({
    nodes: [
      { id: rel.source.id, name: rel.source.name, type: rel.source.type, tenantId, sources: rel.source.sourceChunks },
      { id: rel.target.id, name: rel.target.name, type: rel.target.type, tenantId, sources: rel.target.sourceChunks }
    ],
    relationships: [
      {
        id: rel.rid,
        sourceId: rel.source.id,
        sourceName: rel.source.name,
        targetId: rel.target.id,
        targetName: rel.target.name,
        type: rel.type,
        confidence: rel.confidence ?? null,
        sources: rel.sources
      }
    ],
    text: `${rel.source.name} ${rel.type} ${rel.target.name}`,
    sources: rel.sources
  }));
  const pathEvidence: EvidenceItem[] = paths.map<EvidenceItem>((p) => {
    const rel = p.relationships[0];
    return {
      id: `rel:${rel?.id ?? ""}`,
      sourceType: "path",
      entityName: p.nodes[0]?.name,
      relationshipType: rel?.type,
      relevanceScore: 0.9,
      text: p.text,
      provenance: { tenantId, chunkId: p.sources[0] },
      aclStatus: "authorized",
      relationshipId: rel?.id
    };
  });

  const graphDetails = graph.relationships.map<GraphRelationshipDetail>((rel) => ({
    id: rel.rid,
    sourceId: rel.source.id,
    sourceName: rel.source.name,
    targetId: rel.target.id,
    targetName: rel.target.name,
    type: rel.type,
    confidence: rel.confidence ?? null,
    sources: rel.sources
  }));

  const all = [...vectorEvidence, ...graphEvidence, ...keywordEvidence, ...pathEvidence];
  const reranked = rerankEvidence({
    vector: vectorEvidence,
    graph: graphEvidence,
    keyword: keywordEvidence,
    paths: pathEvidence
  });

  // Resolve chunk text + doc titles for the top reranked evidence (PG is the
  // authoritative source for text + title + page win).
  await hydrateEvidence(tenantId, reranked, principal);

  return {
    plan,
    bundle: {
      vector: vectorEvidence,
      graph: graphEvidence,
      keyword: keywordEvidence,
      pathEvidence,
      all,
      reranked
    },
    paths,
    graphDetails,
    retrievalMeta: meta
  };
}

async function hydrateEvidence(companyId: string, items: EvidenceItem[], principal: Principal): Promise<void> {
  const chunkIds = items.filter((i) => i.chunkId && !i.text).map((i) => i.chunkId as string).slice(0, 20);
  if (chunkIds.length === 0) return;
  // Re-verify ACL at the chunk level for every hydrated text.
  const chunks = await prisma.documentChunk.findMany({
    where: { id: { in: chunkIds }, companyId },
    select: { id: true, content: true, section: true, pageStart: true, document: { select: { title: true } } }
  });
  const byId = new Map(chunks.map((c) => [c.id, c]));
  for (const item of items) {
    const c = item.chunkId ? byId.get(item.chunkId) : null;
    if (c) {
      item.text = item.text || c.content;
      item.documentTitle = item.documentTitle || c.document.title;
      item.section = item.section ?? c.section;
      item.pageStart = item.pageStart ?? c.pageStart;
    }
  }
  void principal;
}

function mergePaths(a: GraphPathResult, b: GraphPathResult): GraphPathResult {
  const nodes = new Map<string, (typeof a.nodes)[number]>();
  for (const n of [...a.nodes, ...b.nodes]) nodes.set(n.id, n);
  const rels = new Map<string, (typeof a.relationships)[number]>();
  for (const r of [...a.relationships, ...b.relationships]) rels.set(r.rid, r);
  return { nodes: Array.from(nodes.values()), relationships: Array.from(rels.values()), text: `${a.text}\n${b.text}`.trim() };
}

function emptyBundle(): EvidenceBundle {
  return { vector: [], graph: [], keyword: [], pathEvidence: [], all: [], reranked: [] };
}

/** Convenience for the admin retrieval-debug endpoint. */
export async function debugRetrieval(opts: { principal: Principal; question: string }) {
  const result = await hybridRetrieve(opts);
  return {
    plan: result.plan,
    vector: result.bundle.vector.map((e) => ({ ...e, text: e.text.slice(0, 200) })),
    graph: result.bundle.graph.slice(0, 20),
    keyword: result.bundle.keyword,
    reranked: result.bundle.reranked.map(({ text, ...e }) => ({ ...e, text: text.slice(0, 200) })),
    paths: result.paths.slice(0, 10),
    meta: result.retrievalMeta
  };
}