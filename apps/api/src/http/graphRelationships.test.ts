import { describe, expect, it } from "vitest";
import { toGraphRelationshipView, type GraphRelationshipView } from "./graphRoutes.js";

/**
 * Regression test for the Graph Explorer contract.
 *
 * The /graph/relationships endpoint previously returned FLAT objects
 * (sourceName / sourceType / targetName / targetType) while the frontend
 * consumed NESTED source/target objects — causing
 * "Cannot read properties of undefined (reading 'id')" when loading the
 * full authorized graph. These tests lock the canonical shape.
 */

describe("toGraphRelationshipView (flat Neo4j row -> nested relationship)", () => {
  it("builds nested source/target objects with real entity ids", () => {
    const view = toGraphRelationshipView({
      rid: "rel-1",
      type: "MANAGES",
      source: { id: "g_src", name: "Priya Sharma", type: "Employee" },
      target: { id: "g_tgt", name: "Remote Work Policy", type: "Policy" },
      confidence: 0.9,
      sources: ["chunk-1"]
    });
    expect(view).toEqual({
      rid: "rel-1",
      type: "MANAGES",
      source: { id: "g_src", name: "Priya Sharma", type: "Employee" },
      target: { id: "g_tgt", name: "Remote Work Policy", type: "Policy" },
      confidence: 0.9,
      sources: ["chunk-1"]
    });
  });

  it("every returned relationship has rid, type and nested source/target with id, name, type", () => {
    const rows: Parameters<typeof toGraphRelationshipView>[0][] = [
      { rid: "r1", type: "RELATED_TO", source: { id: "ga", name: "A", type: "Topic" }, target: { id: "gb", name: "B", type: "Policy" }, confidence: 0.5, sources: ["c1"] },
      { rid: "r2", type: "OWNS", source: { id: "gc", name: "C", type: "User" }, target: { id: "gd", name: "D", type: "Document" }, confidence: null, sources: [] }
    ];
    for (const view of rows.map(toGraphRelationshipView)) {
      expect(typeof view.rid).toBe("string");
      expect(typeof view.type).toBe("string");
      expect(typeof view.source.id).toBe("string");
      expect(typeof view.source.name).toBe("string");
      expect(typeof view.source.type).toBe("string");
      expect(typeof view.target.id).toBe("string");
      expect(typeof view.target.name).toBe("string");
      expect(typeof view.target.type).toBe("string");
    }
  });

  it("never emits undefined source/target (the original crash surface)", () => {
    // A row that is missing source/target properties must still yield nested
    // objects (with empty-string fallbacks) rather than undefined.
    const view = toGraphRelationshipView({ rid: "r3", type: "LINKED_TO", source: {}, target: {}, confidence: null, sources: null });
    expect(view.source).toBeDefined();
    expect(view.target).toBeDefined();
    expect(view.source.id).toBeDefined();
    expect(view.target.id).toBeDefined();
  });
});

/** Mirrors the frontend GraphPage.loadFullGraph() -> CanvasEdge transform. */
function toCanvasEdges(rels: GraphRelationshipView[]): { id: string; source: string; target: string; type: string }[] {
  return rels.map((r) => ({
    id: r.rid,
    source: r.source.id || r.source.name,
    target: r.target.id || r.target.name,
    type: r.type
  }));
}

describe("Graph Explorer full-graph transform (loadFullGraph -> CanvasEdge)", () => {
  it("transforms relationship items into CanvasEdge without throwing", () => {
    const rows: Parameters<typeof toGraphRelationshipView>[0][] = [
      { rid: "r1", type: "RELATED_TO", source: { id: "ga", name: "A", type: "Topic" }, target: { id: "gb", name: "B", type: "Policy" }, confidence: 0.6, sources: ["c1"] },
      { rid: "r2", type: "OWNS", source: { id: "gc", name: "C", type: "User" }, target: { id: "gd", name: "D", type: "Product" }, confidence: null, sources: [] }
    ];
    const views = rows.map(toGraphRelationshipView);
    const edges = toCanvasEdges(views);
    expect(edges).toHaveLength(2);
    for (const e of edges) {
      expect(e.id).toBeDefined();
      expect(e.source).toBeDefined();
      expect(e.target).toBeDefined();
      expect(e.type).toBeDefined();
    }
  });

  it("falls back to name when id is empty, keeping edges valid", () => {
    const view = toGraphRelationshipView({
      rid: "r4",
      type: "RELATED_TO",
      source: { id: "", name: "Source Only", type: "Topic" },
      target: { id: "gb", name: "Target", type: "Policy" },
      confidence: 0.4,
      sources: ["c1"]
    });
    const edge = toCanvasEdges([view])[0];
    expect(edge.source).toBe("Source Only");
    expect(edge.target).toBe("gb");
  });
});
