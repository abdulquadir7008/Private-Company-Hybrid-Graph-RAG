import { describe, expect, it } from "vitest";
import type { Principal } from "@graphrag/shared";
import { authPredicate, tenantAuthPredicate, rowToEntity, assertPrincipalForTenant, type AuthorizedEntity } from "./acl.js";
import { isEntityAuthorized, clampDepth } from "./retrieve.js";

describe("authPredicate / tenantAuthPredicate", () => {
  it("requires sourceDocuments to exist and every doc to be in $authDocs", () => {
    const p = authPredicate("e");
    expect(p).toContain("e.sourceDocuments IS NOT NULL");
    expect(p).toContain("all(d IN e.sourceDocuments WHERE d IN $authDocs)");
  });

  it("tenantAuthPredicate also pins the tenant id (parametrized)", () => {
    expect(tenantAuthPredicate("e", "c1")).toContain("e.tenantId = $tenantId");
    expect(tenantAuthPredicate("e", "c1")).toContain("all(d IN e.sourceDocuments WHERE d IN $authDocs)");
  });
});

describe("rowToEntity", () => {
  it("maps Neo4j flat property maps into AuthorizedEntity", () => {
    const e = rowToEntity({
      id: "g1",
      name: "Project Atlas",
      type: "Product",
      description: "flagship",
      confidence: 0.9,
      sourceDocuments: ["d1"],
      sourceChunks: ["ch1"],
      aliases: ["project_atlas"]
    });
    expect(e).toMatchObject({
      id: "g1",
      name: "Project Atlas",
      type: "Product",
      confidence: 0.9,
      sourceDocuments: ["d1"],
      sourceChunks: ["ch1"]
    });
  });

  it("defaults to empty arrays and Topic type for sparse rows", () => {
    const e = rowToEntity({});
    expect(e.name).toBe("");
    expect(e.type).toBe("Topic");
    expect(e.sourceDocuments).toEqual([]);
    expect(e.sourceChunks).toEqual([]);
  });
});

describe("isEntityAuthorized (graph ACL re-verification)", () => {
  const entity = (docs: string[]): AuthorizedEntity => ({
    id: "g1",
    name: "X",
    type: "Topic",
    sourceDocuments: docs,
    sourceChunks: [],
    score: 0
  });

  it("true when EVERY source document is authorized", () => {
    expect(isEntityAuthorized(entity(["d1", "d2"]), ["d1", "d2", "d3"])).toBe(true);
  });

  it("false when ANY source document is missing from the authorized set", () => {
    expect(isEntityAuthorized(entity(["d1", "d2"]), ["d1"])).toBe(false);
  });

  it("fail-closed on entities with no source documents", () => {
    expect(isEntityAuthorized(entity([]), ["d1"])).toBe(false);
  });
});

describe("assertPrincipalForTenant", () => {
  const p: Principal = { userId: "u1", email: "u1@example.com", companyId: "c1", roles: [], department: null, isRootAdmin: false };
  it("passes for the same tenant", () => {
    expect(() => assertPrincipalForTenant(p, "c1")).not.toThrow();
  });
  it("throws on tenant mismatch", () => {
    expect(() => assertPrincipalForTenant(p, "other-company")).toThrow(/Tenant mismatch/);
  });
});

describe("clampDepth", () => {
  it("caps depth at the configured maximum and floors at 1", () => {
    expect(clampDepth(1)).toBe(1);
    expect(clampDepth(0)).toBe(1);
    expect(clampDepth(3)).toBe(3);
    expect(clampDepth(99)).toBe(3);
  });
});