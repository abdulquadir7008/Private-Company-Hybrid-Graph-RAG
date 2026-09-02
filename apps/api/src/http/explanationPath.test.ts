import { describe, expect, it } from "vitest";
import { findExplanationPath, nodeIsAuthorized } from "./graphRoutes.js";
import type { ExplanationGraphPath } from "@graphrag/shared";

function path(overrides: Partial<ExplanationGraphPath> = {}): ExplanationGraphPath {
  return {
    id: "path-1",
    nodes: [
      { id: "n1", name: "Engineer A", type: "Person" },
      { id: "n2", name: "Expansion", type: "Topic" }
    ],
    edges: [{ id: "r1", sourceId: "n1", targetId: "n2", type: "oversees" }],
    depth: 1,
    relevance: 1,
    sourceDocumentIds: ["d1"],
    authorized: true,
    ...overrides
  };
}

describe("nodeIsAuthorized (fail-closed read-time ACL)", () => {
  it("authorizes a node whose every source document is in the caller's set", () => {
    expect(nodeIsAuthorized(["d1", "d2"], new Set(["d1", "d2", "d3"]))).toBe(true);
  });

  it("fails closed when any source document is unauthorized (access revoked since answer generation)", () => {
    expect(nodeIsAuthorized(["d1", "d2"], new Set(["d2"]))).toBe(false);
  });

  it("fails closed when the node has no source documents", () => {
    expect(nodeIsAuthorized([], new Set(["d1"]))).toBe(false);
  });

  it("fails closed when the authorized set is empty", () => {
    expect(nodeIsAuthorized(["d1"], new Set())).toBe(false);
  });
});

describe("findExplanationPath (explanation-path lookup)", () => {
  const trace = { graphPaths: [path()] };

  it("returns the requested path when present in the trace", () => {
    expect(findExplanationPath(trace, "path-1")).not.toBeNull();
  });

  it("returns null for an invalid/unknown path id (404 surface)", () => {
    expect(findExplanationPath(trace, "path-999")).toBeNull();
  });

  it("returns null when the trace has no graphPaths", () => {
    expect(findExplanationPath({ graphPaths: [] }, "path-1")).toBeNull();
  });

  it("returns null when there is no explanation trace at all", () => {
    expect(findExplanationPath(null, "path-1")).toBeNull();
    expect(findExplanationPath(undefined, "path-1")).toBeNull();
  });

  it("falls back to an empty array when graphPaths is malformed", () => {
    expect(findExplanationPath({} as { graphPaths?: ExplanationGraphPath[] }, "path-1")).toBeNull();
  });
});