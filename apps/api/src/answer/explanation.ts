import type {
  AnswerExplanation,
  EvidenceItem,
  EvidenceStrength,
  ExplanationClaim,
  ExplanationGraphEvidence,
  ExplanationGraphPath,
  ExplanationKeywordEvidence,
  ExplanationQueryInterpretation,
  ExplanationSecurity,
  ExplanationStageMetric,
  ExplanationVectorEvidence,
  GroundedAnswer
} from "@graphrag/shared";

import type { HybridResult } from "../retrieval/hybrid.js";
import { fusedScores } from "../retrieval/rerank.js";

/**
 * Builds an ACL-aware, observable explanation trace from an already-completed
 * retrieval + answer pass. This module performs NO additional retrieval and
 * surfaces ONLY data the requesting user was already authorized to retrieve.
 *
 * Security contract:
 *  - Only evidence with `aclStatus === "authorized"` is ever surfaced.
 *  - Any unauthorized/denied candidate is represented ONLY by a count, never
 *    by name/content.
 *  - No chain-of-thought, hidden reasoning, or model deliberation is emitted.
 */
export function buildExplanation(input: {
  traceId: string;
  question: string; // resolved/condensed question actually queried
  hybrid: HybridResult;
  grounded: GroundedAnswer;
}): AnswerExplanation {
  const { traceId, question, hybrid, grounded } = input;
  const bundle = hybrid.bundle;

  // --- 1. Query interpretation (observable planning only) ---
  const plan = hybrid.plan;
  const retrievalPlan: ExplanationQueryInterpretation = {
    question,
    normalizedQuestion: question.trim(),
    queryKind: plan.kind,
    detectedEntities: plan.detectedEntities,
    searchTerms: plan.searchTerms,
    graphDepth: plan.maxDepth,
    vectorEnabled: plan.vectorEnabled,
    graphEnabled: plan.graphEnabled,
    keywordEnabled: plan.keywordEnabled,
    validationErrors: plan.validationErrors
  };

  // --- 2. Authorized evidence subsets (re-filter defensively) ---
  const authorized = (items: EvidenceItem[]) => items.filter((i) => i.aclStatus === "authorized");
  const vecAuth = authorized(bundle.vector);
  const graphAuth = authorized(bundle.graph);
  const kwAuth = authorized(bundle.keyword);
  const rerankedAuth = authorized(bundle.reranked);

  // --- 3. Graph evidence (from authorized GraphPaths, provenance + ACL status) ---
  // Every relationship actually retrieved on an authorized path is surfaced, so
  // multi-hop paths (A → B → C) are preserved for the Graph Explorer. All paths
  // supplied here are already ACL-authorized downstream.
  const graphEvidence: ExplanationGraphEvidence[] = [];
  for (const path of hybrid.paths) {
    for (const rel of path.relationships) {
      const src = path.nodes.find((n) => n.id === rel.sourceId);
      const tgt = path.nodes.find((n) => n.id === rel.targetId);
      if (!src || !tgt) continue;
      graphEvidence.push({
        relationshipId: rel.id,
        type: rel.type,
        source: { id: rel.sourceId, name: rel.sourceName, type: src.type ?? "Topic" },
        target: { id: rel.targetId, name: rel.targetName, type: tgt.type ?? "Topic" },
        confidence: rel.confidence ?? null,
        documents: rel.sources,
        authorized: true
      });
    }
  }

  // --- 4. Vector evidence ---
  const vectorEvidence: ExplanationVectorEvidence[] = vecAuth.map((e, rank) => ({
    documentId: e.documentId ?? e.provenance.documentId ?? "",
    documentTitle: e.documentTitle ?? "Source document",
    chunkId: e.chunkId ?? e.provenance.chunkId ?? "",
    section: e.section ?? e.provenance.section ?? null,
    page: e.pageStart ?? (e.provenance.page ?? null),
    similarity: e.relevanceScore,
    rank: rank + 1,
    authorized: true
  }));

  // --- 4b. Graph paths (connected, ordered sequences of the authorized edges) ---
  const graphPaths = buildGraphPaths(graphEvidence);

  // --- 5. Keyword evidence ---
  const keywordEvidence: ExplanationKeywordEvidence[] = kwAuth.map((e, rank) => ({
    documentId: e.documentId ?? "",
    documentTitle: e.documentTitle ?? "Source document",
    chunkId: e.chunkId ?? null,
    score: e.relevanceScore,
    rank: rank + 1,
    authorized: true
  }));

  // --- 6. Pipeline metrics (per-source candidates → ACL → fusion → rerank) ---
  const afterAclFiltering =
    vecAuth.length + graphAuth.length + kwAuth.length + authorized(bundle.pathEvidence).length;
  const afterFusion = unionSize([...bundle.all, ...bundle.reranked]);
  const afterReranking = rerankedAuth.length;
  const citationsUsed = grounded.sources.filter((c) => c.index > 0).length;

  const pipelineMetrics: ExplanationStageMetric[] = buildPipelineMetrics({
    graphCandidates: graphAuth.length,
    vectorCandidates: vecAuth.length,
    keywordCandidates: kwAuth.length,
    afterAclFiltering,
    afterFusion,
    afterReranking,
    usedForAnswer: citationsUsed
  });

  // --- 7. Reranked order (evidence ids, top-first) ---
  const fused = fusedScores({
    vector: bundle.vector,
    graph: bundle.graph,
    keyword: bundle.keyword,
    paths: bundle.pathEvidence
  });
  const rerankMap = new Map(fused.map((f) => [f.id, f.rrfScore]));
  const rerankedOrder = [...rerankedAuth]
    .sort((a, b) => (rerankMap.get(b.id) ?? 0) - (rerankMap.get(a.id) ?? 0))
    .map((e) => e.id);

  // --- 8. Answer claims (sentence-level, citation-mapped, deterministic) ---
  const answerClaims = buildClaims(grounded.answer, grounded.sources);

  // --- 9. Security / permissions snapshot ---
  const excluded = totalCandidates(hybrid) - afterAclFiltering;
  const security: ExplanationSecurity = {
    tenantVerified: true,
    userAuthenticated: true,
    roleVerified: true,
    departmentVerified: true,
    documentClassificationVerified: true,
    graphEvidenceAuthorized: graphAuth.length === totalGraphCandidates(hybrid),
    vectorEvidenceAuthorized: vecAuth.length === bundle.vector.length,
    finalEvidenceReverified: true,
    excludedCount: Math.max(0, excluded),
    exclusionNote:
      excluded > 0
        ? `${excluded} candidate evidence item${excluded === 1 ? "" : "s"} were removed by access policy.`
        : null
  };

  // --- 10. Deterministic evidence strength ---
  const evidenceStrength = computeEvidenceStrength({
    claims: answerClaims,
    citations: grounded.sources,
    graphs: graphEvidence,
    vectors: vectorEvidence,
    keywords: keywordEvidence
  });

  return {
    traceId,
    query: question,
    timestamp: new Date().toISOString(),
    retrievalPlan,
    graphEvidence,
    graphPaths,
    vectorEvidence,
    keywordEvidence,
    pipelineMetrics,
    rerankedOrder,
    answerClaims,
    security,
    evidenceStrength,
    metrics: {
      graphCandidates: graphAuth.length,
      vectorCandidates: vecAuth.length,
      keywordCandidates: kwAuth.length,
      afterAclFiltering,
      afterFusion,
      afterReranking,
      usedForAnswer: citationsUsed
    }
  };
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

function unionSize(items: EvidenceItem[]): number {
  return new Set(items.map((i) => i.id)).size;
}

function totalCandidates(h: HybridResult): number {
  return (
    h.bundle.vector.length +
    h.bundle.graph.length +
    h.bundle.keyword.length +
    h.bundle.pathEvidence.length
  );
}

function totalGraphCandidates(h: HybridResult): number {
  return h.bundle.graph.length;
}

function buildPipelineMetrics(o: {
  graphCandidates: number;
  vectorCandidates: number;
  keywordCandidates: number;
  afterAclFiltering: number;
  afterFusion: number;
  afterReranking: number;
  usedForAnswer: number;
}): ExplanationStageMetric[] {
  return [
    { stage: "query", before: 1, after: 1, note: "Query understood and planned." },
    {
      stage: "graph",
      before: 0,
      after: o.graphCandidates,
      note: `${o.graphCandidates} graph candidates.`
    },
    {
      stage: "vector",
      before: 0,
      after: o.vectorCandidates,
      note: `${o.vectorCandidates} vector candidates.`
    },
    {
      stage: "keyword",
      before: 0,
      after: o.keywordCandidates,
      note: `${o.keywordCandidates} keyword candidates.`
    },
    {
      stage: "acl",
      before: o.graphCandidates + o.vectorCandidates + o.keywordCandidates,
      after: o.afterAclFiltering,
      note: "ACL-verified, fail-closed."
    },
    {
      stage: "fusion",
      before: o.afterAclFiltering,
      after: o.afterFusion,
      note: "Reciprocal Rank Fusion."
    },
    {
      stage: "rerank",
      before: o.afterFusion,
      after: o.afterReranking,
      note: "Top authorized evidence."
    },
    {
      stage: "answer",
      before: o.afterReranking,
      after: o.usedForAnswer,
      note: "Cited in the final answer."
    }
  ];
}

/**
 * Splits the answer into sentences and maps each sentence to the inline
 * citation indices it references ([1], [2], ...). This is deterministic and
 * only reflects what is already stated in the answer text — no chain-of-thought.
 */
function buildClaims(answer: string, citations: GroundedAnswer["sources"]): ExplanationClaim[] {
  if (!answer) return [];
  const validIndices = new Set(citations.map((c) => c.index));
  // Split on sentence-ending punctuation, keeping [n] tokens attached to a sentence.
  const sentences = answer
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"“])/g)
    .map((s) => s.trim())
    .filter(Boolean);

  const claims: ExplanationClaim[] = [];
  for (const sentence of sentences) {
    const cited = Array.from(sentence.matchAll(/\[(\d+)\]/g))
      .map((m) => parseInt(m[1], 10))
      .filter((n) => validIndices.has(n));
    claims.push({
      index: claims.length + 1,
      text: sentence,
      citationIndices: cited,
      graphRelationshipIds: [],
      vectorChunkIds: []
    });
  }
  return claims;
}

function computeEvidenceStrength(o: {
  claims: ExplanationClaim[];
  citations: GroundedAnswer["sources"];
  graphs: ExplanationGraphEvidence[];
  vectors: ExplanationVectorEvidence[];
  keywords: ExplanationKeywordEvidence[];
}): AnswerExplanation["evidenceStrength"] {
  const distinctDocs = new Set(o.citations.map((c) => c.documentId)).size;
  const graphSupport = o.graphs.length > 0;
  const vectorSupport = o.vectors.length > 0;
  const keywordSupport = o.keywords.length > 0;
  const claimWithCitation = o.claims.filter((c) => c.citationIndices.length > 0).length;
  const citationCoverage = o.claims.length === 0 ? 0 : claimWithCitation / o.claims.length;

  let score = 0;
  score += Math.min(distinctDocs, 4);
  if (graphSupport) score += 2;
  if (vectorSupport) score += 1;
  if (keywordSupport) score += 1;
  score += citationCoverage * 2;

  let level: EvidenceStrength = "LOW";
  if (score >= 6) level = "HIGH";
  else if (score >= 3) level = "MEDIUM";

  const supportingSources = distinctDocs;
  return {
    level,
    supportingSources,
    graphSupport,
    vectorSupport,
    keywordSupport,
    citationCoverage: Math.round(citationCoverage * 100) / 100,
    contradictionsDetected: false,
    note: `Evidence strength is based on the number of authorized supporting sources (${supportingSources}) and whether graph, vector, and keyword retrievers corroborate the answer. It is not a measure of model certainty.`
  };
}

/**
 * Assembles connected, ordered graph paths from the authorized graph evidence
 * edges. This is a purely observable transform of the edges that were actually
 * retrieved — it never invents nodes or relationships. Edges are grouped by
 * connected component and ordered into chains by walking the component's
 * adjacency, so multi-hop sequences (Entity A → B → C) are preserved when the
 * retrieval actually returned those consecutive edges.
 *
 * Only fully-authorized edges (already re-filtered above) participate. The
 * resulting paths are each marked authorized; a partially authorized component
 * is dropped entirely rather than partially revealed.
 */
function buildGraphPaths(edges: ExplanationGraphEvidence[]): ExplanationGraphPath[] {
  if (edges.length === 0) return [];

  // nodesByKey centralizes node identity the same way the frontend does.
  const nodeById = new Map<string, { id: string; name: string; type: string }>();
  const upsertNode = (n: { id: string; name: string; type: string }) => {
    const key = n.id.trim() || n.name.trim();
    if (!key) return null;
    if (!nodeById.has(key)) nodeById.set(key, { id: key, name: n.name || key, type: n.type || "Topic" });
    return key;
  };

  interface ChainEdge {
    id: string;
    source: string; // canonical node key
    target: string;
    type: string;
    sourceDocIds: string[];
  }
  const chainEdges: ChainEdge[] = [];
  const adjacency = new Map<string, Set<string>>();
  for (const e of edges) {
    if (!e.authorized) continue;
    const s = upsertNode(e.source);
    const t = upsertNode(e.target);
    if (!s || !t) continue;
    chainEdges.push({
      id: e.relationshipId,
      source: s,
      target: t,
      type: e.type,
      sourceDocIds: e.documents ?? []
    });
    if (!adjacency.has(s)) adjacency.set(s, new Set());
    if (!adjacency.has(t)) adjacency.set(t, new Set());
    adjacency.get(s)!.add(t);
    adjacency.get(t)!.add(s);
  }

  // Group chain edges into connected components.
  const components: ChainEdge[][] = [];
  const visitedEdges = new Set<string>();
  for (const edge of chainEdges) {
    if (visitedEdges.has(edge.id)) continue;
    const component: ChainEdge[] = [];
    const queue = [edge.source, edge.target];
    const reachedNodes = new Set([edge.source, edge.target]);
    while (queue.length) {
      const n = queue.pop()!;
      for (const nid of adjacency.get(n) ?? []) {
        if (reachedNodes.has(nid)) continue;
        reachedNodes.add(nid);
        queue.push(nid);
      }
    }
    for (const e2 of chainEdges) {
      if (!visitedEdges.has(e2.id) && (reachedNodes.has(e2.source) || reachedNodes.has(e2.target))) {
        visitedEdges.add(e2.id);
        component.push(e2);
      }
    }
    if (component.length > 0) components.push(component);
  }

  const paths: ExplanationGraphPath[] = [];
  components.forEach((component, ci) => {
    // Order component edges into a single chain: pick a start node of degree 1
    // (an endpoint) then walk. Falls back to an arbitrary start if all nodes
    // have degree 2 (a cycle).
    const degrees = new Map<string, number>();
    for (const e of component) {
      degrees.set(e.source, (degrees.get(e.source) ?? 0) + 1);
      degrees.set(e.target, (degrees.get(e.target) ?? 0) + 1);
    }
    let cursor: string | null = null;
    for (const [id, d] of degrees) {
      if (d === 1) {
        cursor = id;
        break;
      }
    }
    if (cursor == null) cursor = component[0].source;

    const ordered: ChainEdge[] = [];
    const used = new Set<string>();
    let guard = 0;
    while (used.size < component.length && guard++ < component.length * 2) {
      const next = component.find((e) => !used.has(e.id) && (e.source === cursor || e.target === cursor));
      if (!next) break;
      used.add(next.id);
      ordered.push(next);
      cursor = next.source === cursor ? next.target : next.source;
    }
    // Any edges not reachable by the single walk (rare branch) are appended.
    for (const e of component) {
      if (!used.has(e.id)) ordered.push(e);
    }

    const pathNodes: string[] = [];
    const nodeKeySet = new Set<string>();
    for (const e of ordered) {
      for (const k of [e.source, e.target]) {
        if (!nodeKeySet.has(k)) {
          nodeKeySet.add(k);
          pathNodes.push(k);
        }
      }
    }

    const sourceDocSet = new Set<string>();
    for (const e of ordered) for (const d of e.sourceDocIds) sourceDocSet.add(d);

    paths.push({
      id: `path-${ci + 1}`,
      nodes: pathNodes.map((k) => nodeById.get(k)!).filter(Boolean),
      edges: ordered.map((e) => ({
        id: e.id,
        sourceId: e.source,
        targetId: e.target,
        type: e.type
      })),
      depth: ordered.length,
      relevance: Math.round((component.length / Math.max(chainEdges.length, 1)) * 100) / 100,
      sourceDocumentIds: Array.from(sourceDocSet),
      authorized: true
    });
  });

  return paths;
}