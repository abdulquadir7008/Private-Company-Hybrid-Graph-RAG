import { describe, expect, it } from "vitest";
import { generateGroundedAnswer } from "./generate.js";
import type { HybridResult } from "../retrieval/hybrid.js";
import type { EvidenceItem, QueryPlan } from "@graphrag/shared";

function baseHybrid(over: Partial<HybridResult> = {}): HybridResult {
  return {
    plan: {
      kind: "hybrid",
      question: "q",
      detectedEntities: [],
      searchTerms: ["q"],
      vectorEnabled: false,
      graphEnabled: false,
      keywordEnabled: false,
      maxDepth: 2,
      validationErrors: []
    } satisfies QueryPlan,
    bundle: {
      vector: [],
      graph: [],
      keyword: [],
      pathEvidence: [],
      all: [],
      reranked: []
    },
    paths: [],
    graphDetails: [],
    retrievalMeta: {},
    ...over
  };
}

function ev(id: string, text: string): EvidenceItem {
  return {
    id,
    sourceType: "graph",
    documentId: "d1",
    chunkId: "c1",
    documentTitle: "Employee Handbook",
    entityName: "Project Atlas",
    relationshipType: "USED_BY",
    relevanceScore: 0.9,
    text,
    provenance: { tenantId: "c1", documentId: "d1", chunkId: "c1" },
    aclStatus: "authorized"
  };
}

describe("generateGroundedAnswer", () => {
  it("NEVER guesses when there is no authorized evidence", async () => {
    const out = await generateGroundedAnswer({ question: "secret?", hybrid: baseHybrid(), history: [] });
    expect(out.grounded).toBe(false);
    expect(out.confidence).toBe(0);
    expect(out.answer.toLowerCase()).toContain("could not find");
    expect(out.sources).toEqual([]);
  });

  it("produces a grounded answer with citations when evidence exists (deterministic, no LLM key)", async () => {
    const hybrid = baseHybrid({
      bundle: {
        vector: [],
        graph: [],
        keyword: [],
        pathEvidence: [],
        all: [ev("e1", "Project Atlas USED_BY React")],
        reranked: [ev("e1", "Project Atlas USED_BY React")]
      },
      paths: [
        {
          nodes: [{ id: "n1", name: "Project Atlas", type: "Product", tenantId: "c1", sources: ["c1"] }],
          relationships: [],
          text: "Project Atlas",
          sources: ["c1"]
        }
      ],
      graphDetails: []
    });
    const out = await generateGroundedAnswer({ question: "what does project atlas use?", hybrid, history: [] });
    expect(out.grounded).toBe(true);
    expect(out.answer.length).toBeGreaterThan(0);
    expect(out.answer).toContain("[1]");
    // GraphDetail wiring is passed through for UI graph rendering.
    expect(out.graphEvidence).toEqual([]);
    expect(out.paths).toHaveLength(1);
  });
});