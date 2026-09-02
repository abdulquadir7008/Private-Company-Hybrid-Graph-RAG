import { describe, expect, it } from "vitest";
import { rerankEvidence, fusedScores } from "./rerank.js";
import type { EvidenceItem } from "@graphrag/shared";

function item(id: string, rollup: number): EvidenceItem {
  return {
    id,
    sourceType: "vector",
    relevanceScore: rollup,
    text: `text-${id}`,
    provenance: { tenantId: "c1" },
    aclStatus: "authorized"
  };
}

describe("rerankEvidence (deterministic RRF)", () => {
  it("merges vector/graph/keyword/path groups into one ordered list", () => {
    const out = rerankEvidence({
      vector: [item("v1", 0.9), item("v2", 0.8)],
      graph: [item("g1", 0.95)],
      keyword: [item("k1", 1)],
      paths: []
    });
    expect(out.length).toBe(4);
  });

  it("dedupes items that appear in multiple groups (e.g. graph + its path)", () => {
    const out = rerankEvidence({
      vector: [],
      graph: [item("rel:r1", 0.85)],
      keyword: [],
      paths: [item("rel:r1", 0.9)]
    });
    expect(out).toHaveLength(1);
  });

  it("caps at TOP_K_RERANKED", () => {
    const many = Array.from({ length: 100 }, (_, i) => item(`x${i}`, 0.5));
    const out = rerankEvidence({ vector: many, graph: [], keyword: [], paths: [] });
    expect(out.length).toBeLessThanOrEqual(10);
  });

  it("items ranked in every list rank higher (reciprocal rank fusion)", () => {
    const out = rerankEvidence({
      vector: [item("a", 0.5), item("b", 0.9)],
      graph: [item("a", 0.5)],
      keyword: [],
      paths: []
    });
    expect(out[0].id).toBe("a");
  });
});

describe("fusedScores (deterministic RRF explanation detail)", () => {
  it("reports sources + fused rrfScore + relevanceScore per evidence id", () => {
    const out = fusedScores({
      vector: [item("a", 0.9)],
      graph: [item("a", 0.8)],
      keyword: [],
      paths: []
    });
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("a");
    expect(out[0].sources.sort()).toEqual(["graph", "vector"]);
    // vector weight 1.0 / (60+0) + graph weight 0.85 / (60+0)
    expect(out[0].rrfScore).toBeCloseTo(1.0 / 60 + 0.85 / 60, 4);
    expect(out[0].relevanceScore).toBe(0.9);
  });

  it("orders by descending fused rrfScore (multi-source outranks single-source)", () => {
    const out = fusedScores({
      vector: [item("multi", 0.5)],
      graph: [item("multi", 0.5)],
      keyword: [item("single", 0.99), item("multi", 0.6)],
      paths: []
    });
    // "multi" appears in 3 lists -> highest fused rrfScore regardless of relevance.
    expect(out[0].id).toBe("multi");
    expect(out[0].sources.sort()).toEqual(["graph", "keyword", "vector"]);
    expect(out[1].id).toBe("single");
    expect(out[1].sources).toEqual(["keyword"]);
  });

  it("tracks multiple contributed sources for one id and maxes relevance", () => {
    const out = fusedScores({
      vector: [item("x", 0.4), item("y", 0.9)],
      graph: [item("x", 0.7)],
      keyword: [item("x", 0.95)],
      paths: []
    });
    const x = out.find((s) => s.id === "x");
    expect(x).toBeDefined();
    expect(x!.sources.sort()).toEqual(["graph", "keyword", "vector"]);
    expect(x!.relevanceScore).toBe(0.95);
  });
});