import { describe, expect, it } from "vitest";
import { buildCitations } from "./citations.js";
import type { EvidenceItem } from "@graphrag/shared";

function evidence(over: Partial<EvidenceItem> & { id: string }): EvidenceItem {
  return {
    sourceType: "vector",
    documentId: "doc1",
    chunkId: "chunk1",
    documentTitle: "Employee Handbook",
    section: "Onboarding",
    pageStart: 4,
    text: "sample text",
    relevanceScore: 0.9,
    provenance: { tenantId: "c1", documentId: "doc1", chunkId: "chunk1" },
    aclStatus: "authorized",
    ...over
  };
}

describe("buildCitations", () => {
  it("assigns sequential [n] indexes and preserves doc/chunk metadata", () => {
    const c = buildCitations([
      evidence({ id: "a", documentId: "d1", chunkId: "ch1" }),
      evidence({ id: "b", documentId: "d2", chunkId: "ch2" })
    ]);
    expect(c.map((x) => x.index)).toEqual([1, 2]);
    expect(c[0].documentId).toBe("d1");
    expect(c[0].chunkId).toBe("ch1");
    expect(c[0].documentName).toBe("Employee Handbook");
    expect(c[0].section).toBe("Onboarding");
    expect(c[0].page).toBe(4);
  });

  it("skips evidence without a chunk (no fabricated citations)", () => {
    const out = buildCitations([evidence({ id: "a", chunkId: undefined, documentId: "d1" })]);
    expect(out).toHaveLength(0);
  });

  it("skips evidence without a document", () => {
    const out = buildCitations([evidence({ id: "a", documentId: undefined })]);
    expect(out).toHaveLength(0);
  });

  it("never cites denied evidence", () => {
    const out = buildCitations([evidence({ id: "a", aclStatus: "denied" })]);
    expect(out).toHaveLength(0);
  });

  it("dedupes the same doc:chunk pair and caps at the limit", () => {
    const dupes = [
      evidence({ id: "a", documentId: "d1", chunkId: "ch1" }),
      evidence({ id: "b", documentId: "d1", chunkId: "ch1" }),
      evidence({ id: "c", documentId: "d2", chunkId: "ch2" })
    ];
    const out = buildCitations(dupes, 10);
    expect(out).toHaveLength(2);
    const capped = buildCitations(Array.from({ length: 20 }, (_, i) => evidence({ id: `${i}`, chunkId: `c${i}` })), 3);
    expect(capped).toHaveLength(3);
  });

  it("truncates citation text to 500 chars", () => {
    const long = "x".repeat(900);
    const out = buildCitations([evidence({ id: "a", text: long })]);
    expect(out[0].text.length).toBe(500);
  });
});