import { describe, expect, it } from "vitest";
import { repairJson, heuristicEntities, heuristicRelationships } from "./entities.js";

const HR_SAMPLE = `Remote Work Policy The Remote Work Policy applies to full-time employees and approved contractors. Priya Sharma owns the Remote Work Policy. The HR department administers the policy. Employees may work remotely up to three days per week with manager approval.`;

describe("repairJson", () => {
  it("parses clean JSON unchanged", () => {
    const out = repairJson('{"entities":[],"relationships":[]}');
    expect(JSON.parse(out)).toEqual({ entities: [], relationships: [] });
  });

  it("strips surrounding markdown code fences", () => {
    const raw = '```json\n{"entities":[{"name":"Remote Work Policy","type":"Policy"}],"relationships":[]}\n```';
    expect(JSON.parse(repairJson(raw))).toEqual({
      entities: [{ name: "Remote Work Policy", type: "Policy" }],
      relationships: []
    });
  });

  it("strips leading/trailing prose around the JSON object", () => {
    const raw = 'Here is the result:\n{"entities":[],"relationships":[]}\n\nHope this helps.';
    expect(JSON.parse(repairJson(raw))).toEqual({ entities: [], relationships: [] });
  });

  it("recovers truncated output by closing the unclosed arrays/objects", () => {
    const raw = '{"entities":[{"name":"A","type":"Policy"}],"relationships":[{"source":"A","type":"RELATED_TO","target":"B"';
    const repaired = repairJson(raw);
    const parsed = JSON.parse(repaired);
    expect(parsed.relationships[0].target).toBe("B");
  });

  it("throws when no JSON object is present", () => {
    expect(() => repairJson("no json here at all")).toThrow(/No JSON object found/);
  });
});

describe("heuristicEntities", () => {
  it("extracts real proper-noun entities, not whole sentences", () => {
    const entities = heuristicEntities(HR_SAMPLE);
    const names = entities.map((e) => e.name);
    expect(names).toContain("Remote Work Policy");
    expect(names).toContain("Priya Sharma");
    expect(names).not.toContain(HR_SAMPLE.trim());
    expect(entities.every((e) => e.name.length < 60)).toBe(true);
  });

  it("types entities by keyword", () => {
    const entities = heuristicEntities(HR_SAMPLE);
    const byName = Object.fromEntries(entities.map((e) => [e.name, e.type]));
    expect(byName["Remote Work Policy"]).toBe("Policy");
    expect(byName["HR department"]).toBe("Department");
    expect(byName["Priya Sharma"]).toBe("Person");
  });

  it("does not treat prose openers as entities", () => {
    const entities = heuristicEntities("The quick brown fox jumps over the lazy dog.");
    expect(entities.map((e) => e.name)).not.toContain("The quick brown fox");
  });
});

describe("heuristicRelationships", () => {
  it("links only entities that co-occur in the same sentence", () => {
    const entities = heuristicEntities(HR_SAMPLE);
    const rels = heuristicRelationships(HR_SAMPLE, entities);
    expect(rels.length).toBeGreaterThan(0);
    for (const r of rels) {
      expect(entities.map((e) => e.name)).toContain(r.source);
      expect(entities.map((e) => e.name)).toContain(r.target);
    }
  });

  it("produces no edges for entities that never co-occur", () => {
    const rels = heuristicRelationships("Remote Work Policy is alone in this sentence. Priya Sharma later appears here.", [
      { name: "Remote Work Policy", type: "Policy" as const, description: "", confidence: 0.5 },
      { name: "Priya Sharma", type: "Person" as const, description: "", confidence: 0.5 }
    ]);
    expect(rels).toEqual([]);
  });
});
