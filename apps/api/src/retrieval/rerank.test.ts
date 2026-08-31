import { describe, expect, it } from "vitest";
import { rerankEvidence } from "./rerank.js";
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