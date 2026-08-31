import { describe, expect, it } from "vitest";
import { isEntityType, isRelationshipType, assertRelationshipSupported, RELATIONSHIP_SCHEMA } from "@graphrag/shared";

describe("ontology guards (from shared)", () => {
  it("validates known entity types", () => {
    expect(isEntityType("Product")).toBe(true);
    expect(isEntityType("Person")).toBe(true);
    expect(isEntityType("Nonsense")).toBe(false);
  });

  it("validates known relationship types", () => {
    expect(isRelationshipType("WORKS_FOR")).toBe(true);
    expect(isRelationshipType("HACKS_INTO")).toBe(false);
  });

  it("accepts a schema-valid relationship (source, type, target)", () => {
    expect(() => assertRelationshipSupported("Person", "WORKS_FOR", "Company")).not.toThrow();
  });

  it("rejects relations that violate the graph schema (fail-closed)", () => {
    expect(() => assertRelationshipSupported("Company", "WORKS_FOR", "Person")).toThrow();
    expect(() => assertRelationshipSupported("Person", "CONTAINS_SECTION", "Policy")).toThrow();
    expect(() => assertRelationshipSupported("Topic", "OWNS", "Person")).toThrow();
  });

  it("exposes a full schema with defined keys", () => {
    expect(Object.keys(RELATIONSHIP_SCHEMA).length).toBeGreaterThan(5);
  });
});