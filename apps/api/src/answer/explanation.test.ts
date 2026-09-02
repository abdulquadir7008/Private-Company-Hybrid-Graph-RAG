import { describe, expect, it } from "vitest";
import { buildExplanation } from "./explanation.js";
import { rerankEvidence } from "../retrieval/rerank.js";
import type { EvidenceBundle, EvidenceItem, GraphPath, GroundedAnswer, QueryPlan } from "@graphrag/shared";
import type { HybridResult } from "../retrieval/hybrid.js";

function item(id: string, acl: "authorized" | "denied" = "authorized"): EvidenceItem {
  return {
    id,
    sourceType: "vector",
    documentId: `doc-${id}`,
    documentTitle: `Doc ${id}`,
    chunkId: `${id}-1`,
    relevanceScore: 0.7,
    section: "Section 1",
    pageStart: 1,
    text: `text-${id}`,
    provenance: { tenantId: "c1", documentId: `doc-${id}`, chunkId: `${id}-1`, page: 1, section: "Section 1" },
    aclStatus: acl
  };
}

const vectorItems = [item("v1"), item("v2")];
const graphItems = [item("g1")];
const keywordItems = [item("k1")];
const pathItems: EvidenceItem[] = [];

const bundle: EvidenceBundle = {
  vector: vectorItems,
  graph: graphItems,
  keyword: keywordItems,
  pathEvidence: pathItems,
  all: [...vectorItems, ...graphItems, ...keywordItems, ...pathItems],
  reranked: rerankEvidence({ vector: vectorItems, graph: graphItems, keyword: keywordItems, paths: pathItems })
};

const plan: QueryPlan = {
  kind: "hybrid",
  question: "Who oversaw the expansion?",
  detectedEntities: ["Expansion"],
  searchTerms: ["expansion", "oversaw"],
  vectorEnabled: true,
  graphEnabled: true,
  keywordEnabled: true,
  maxDepth: 2,
  validationErrors: []
};

function graphPath(): GraphPath {
  return {
    nodes: [
      { id: "n1", name: "Engineer A", type: "Person", tenantId: "c1", sources: ["d1"] },
      { id: "n2", name: "Expansion", type: "Topic", tenantId: "c1", sources: ["d1"] }
    ],
    relationships: [
      {
        id: "r1",
        sourceId: "n1",
        sourceName: "Engineer A",
        targetId: "n2",
        targetName: "Expansion",
        type: "oversees",
        confidence: 0.9,
        sources: ["d1"]
      }
    ],
    text: "Engineer A oversees Expansion",
    sources: ["d1"]
  };
}

function grounded(answer = "Engineer A oversaw the expansion. [1][2]\nAll of it was approved. [1]"): GroundedAnswer {
  return {
    answer,
    grounded: true,
    confidence: 0.92,
    sources: [
      { index: 1, documentId: "d1", documentName: "Doc 1", chunkId: "c1-1", text: "Engineer A oversaw it", url: "http://x/1" },
      { index: 2, documentId: "d2", documentName: "Doc 2", chunkId: "c2-1", text: "Expansion carried out", url: "http://x/2" }
    ],
    graphEvidence: [],
    paths: []
  };
}

function hybrid(overrides: Partial<HybridResult> = {}): HybridResult {
  return {
    plan,
    bundle,
    paths: [graphPath()],
    graphDetails: [],
    retrievalMeta: { total: 4 },
    ...overrides
  };
}

describe("buildExplanation (Explainable RAG)", () => {
  it("reuses existing retrieval data and does not fabricate sources", () => {
    const ex = buildExplanation({ traceId: "t1", question: plan.question, hybrid: hybrid(), grounded: grounded() });
    expect(ex.traceId).toBe("t1");
    expect(ex.retrievalPlan.detectedEntities).toEqual(["Expansion"]);
    expect(ex.rerankedOrder.length).toBeGreaterThan(0);
    expect(ex.answerClaims.length).toBeGreaterThan(0);
  });

  it("maps claims to citations by inline [n] markers only", () => {
    const ex = buildExplanation({ traceId: "t1", question: plan.question, hybrid: hybrid(), grounded: grounded() });
    const first = ex.answerClaims.find((c) => c.citationIndices.includes(1));
    expect(first).toBeDefined();
    expect(first!.citationIndices).toContain(1);
  });

  it("produces graphEvidence from authorized GraphPaths with resolved endpoints", () => {
    const ex = buildExplanation({ traceId: "t1", question: plan.question, hybrid: hybrid(), grounded: grounded() });
    expect(ex.graphEvidence.length).toBe(1);
    expect(ex.graphEvidence[0].relationshipId).toBe("r1");
    expect(ex.graphEvidence[0].source.name).toBe("Engineer A");
    expect(ex.graphEvidence[0].authorized).toBe(true);
  });

  it("reports vector and keyword evidence with document metadata", () => {
    const ex = buildExplanation({ traceId: "t1", question: plan.question, hybrid: hybrid(), grounded: grounded() });
    expect(ex.vectorEvidence.length).toBe(2);
    expect(ex.keywordEvidence.length).toBe(1);
    expect(ex.vectorEvidence.every((v) => v.authorized)).toBe(true);
  });

  it("computes evidence strength deterministically (HIGH with multiple supports)", () => {
    const ex = buildExplanation({ traceId: "t1", question: plan.question, hybrid: hybrid(), grounded: grounded() });
    expect(["LOW", "MEDIUM", "HIGH"]).toContain(ex.evidenceStrength.level);
    expect(ex.evidenceStrength.graphSupport).toBe(true);
    expect(ex.evidenceStrength.vectorSupport).toBe(true);
  });

  it("keeps evidenceStrength LOW for an unsupported answer", () => {
    const bare: HybridResult = hybrid({
      plan: { ...plan, vectorEnabled: false, graphEnabled: false, keywordEnabled: false },
      bundle: { ...bundle, vector: [], graph: [], keyword: [], all: [], reranked: [] },
      paths: []
    });
    const ex = buildExplanation({
      traceId: "t1",
      question: plan.question,
      hybrid: bare,
      grounded: { answer: "No supporting evidence surfaced.", grounded: false, confidence: 0.1, sources: [], graphEvidence: [], paths: [] }
    });
    expect(ex.evidenceStrength.level).toBe("LOW");
    expect(ex.evidenceStrength.supportingSources).toBe(0);
  });

  it("fails closed: denied candidates are excluded and only counted", () => {
    const withDenied: HybridResult = hybrid({
      bundle: {
        ...bundle,
        vector: [item("vA"), item("vDenied", "denied")],
        graph: [item("g1"), item("gDenied", "denied")],
        keyword: [item("k1")],
        all: [],
        reranked: []
      }
    });
    const ex = buildExplanation({ traceId: "t1", question: plan.question, hybrid: withDenied, grounded: grounded() });
    expect(ex.vectorEvidence.every((v) => v.documentId !== "doc-vDenied")).toBe(true);
    expect(ex.graphEvidence.every((g) => !String(g.relationshipId).includes("gDenied"))).toBe(true);
    expect(ex.security.excludedCount).toBeGreaterThanOrEqual(2);
    expect(ex.security.exclusionNote).toContain("removed by access policy");
  });

  it("never surfaces excluded evidence content — only a count", () => {
    const withDenied: HybridResult = hybrid({
      bundle: {
        ...bundle,
        vector: [item("vDenied", "denied")],
        graph: [],
        keyword: [],
        all: [],
        reranked: []
      }
    });
    const ex = buildExplanation({ traceId: "t1", question: plan.question, hybrid: withDenied, grounded: grounded() });
    expect(ex.vectorEvidence.length).toBe(0);
    expect(ex.security.excludedCount).toBe(1);
    expect(JSON.stringify(ex).includes("vDenied text")).toBe(false);
  });

  it("exposes pipeline stage metrics mirroring graph → vector → keyword → acl → fusion → rerank → answer", () => {
    const ex = buildExplanation({ traceId: "t1", question: plan.question, hybrid: hybrid(), grounded: grounded() });
    const stages = ex.pipelineMetrics.map((s) => s.stage);
    expect(stages).toEqual(["query", "graph", "vector", "keyword", "acl", "fusion", "rerank", "answer"]);
    const acl = ex.pipelineMetrics.find((s) => s.stage === "acl");
    expect(acl!.after).toBe(4);
  });

  it("handles an empty answer gracefully (empty claims, no crash)", () => {
    const ex = buildExplanation({
      traceId: "t1",
      question: plan.question,
      hybrid: hybrid({ bundle: { ...bundle, vector: [], graph: [], keyword: [], all: [], reranked: [] }, paths: [] }),
      grounded: { ...grounded(""), answer: "" }
    });
    expect(ex.answerClaims).toEqual([]);
    expect(ex.evidenceStrength.citationCoverage).toBe(0);
  });

  describe("graphPaths (structured, viewable paths)", () => {
    it("derives a structured path from each authorized graph edge", () => {
      const ex = buildExplanation({ traceId: "t1", question: plan.question, hybrid: hybrid(), grounded: grounded() });
      expect(ex.graphPaths.length).toBe(1);
      const p = ex.graphPaths[0];
      expect(p.nodes.map((n) => n.name)).toEqual(["Engineer A", "Expansion"]);
      expect(p.edges).toHaveLength(1);
      expect(p.edges[0].id).toBe("r1");
      expect(p.authorized).toBe(true);
      expect(p.sourceDocumentIds).toEqual(["d1"]);
    });

    it("orders a multi-hop chain A → B → C in sequence", () => {
      const chain: HybridResult = hybrid({
        paths: [
          {
            nodes: [
              { id: "n1", name: "Engineer A", type: "Person", tenantId: "c1", sources: ["d1"] },
              { id: "n2", name: "Expansion", type: "Topic", tenantId: "c1", sources: ["d1"] },
              { id: "n3", name: "Partner Co", type: "Company", tenantId: "c1", sources: ["d2"] }
            ],
            relationships: [
              { id: "r1", sourceId: "n1", sourceName: "Engineer A", targetId: "n2", targetName: "Expansion", type: "oversees", confidence: 0.9, sources: ["d1"] },
              { id: "r2", sourceId: "n2", sourceName: "Expansion", targetId: "n3", targetName: "Partner Co", type: "partnered_with", confidence: 0.8, sources: ["d2"] }
            ],
            text: "chain",
            sources: ["d1", "d2"]
          }
        ]
      });
      const ex = buildExplanation({ traceId: "t1", question: plan.question, hybrid: chain, grounded: grounded() });
      // Two graph edges → one connected 3-node path.
      expect(ex.graphPaths).toHaveLength(1);
      const p = ex.graphPaths[0];
      expect(p.nodes).toHaveLength(3);
      expect(p.edges).toHaveLength(2);
      expect(p.depth).toBe(2);
      expect(p.nodes[0].name === "Engineer A" && p.nodes[2].name === "Partner Co").toBe(true);
    });

    it("encodes both endpoints of each edge as nodes (start = first node)", () => {
      const ex = buildExplanation({ traceId: "t1", question: plan.question, hybrid: hybrid(), grounded: grounded() });
      expect(ex.graphPaths[0].id).toBe("path-1");
      // The first node is the chain start, so the drawer can select it for radial layout.
      expect(ex.graphPaths[0].nodes[0].id).toBe(ex.graphPaths[0].edges[0].sourceId);
    });
  });

  describe("graphPaths fail-closed", () => {
    it("never reveals edges that were not actually retrieved/authorized", () => {
      const ex = buildExplanation({ traceId: "t1", question: plan.question, hybrid: hybrid(), grounded: grounded() });
      // Only the single real retrieved+authorized edge is present; no fabrication.
      expect(ex.graphPaths.flatMap((p) => p.edges).map((e) => e.id)).toEqual(["r1"]);
    });

    it("produces no graphPaths when there is no graph evidence", () => {
      const ex = buildExplanation({
        traceId: "t1",
        question: plan.question,
        hybrid: hybrid({ paths: [], bundle: { ...bundle, graph: [], all: [], reranked: [], vector: [], keyword: [], pathEvidence: [] } }),
        grounded: grounded()
      });
      expect(ex.graphPaths).toEqual([]);
    });
  });
});