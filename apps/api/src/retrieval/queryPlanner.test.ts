import { describe, expect, it } from "vitest";
import {
  classifyKind,
  extractSearchTerms,
  extractEntityNameCandidates,
  buildPlan
} from "./queryPlanner.js";

describe("classifyKind", () => {
  it("relationship lookups", () => {
    expect(classifyKind("Who manages the HR Department?")).toBe("relationship_lookup");
    expect(classifyKind("who owns the payroll policy")).toBe("relationship_lookup");
  });
  it("comparisons", () => {
    expect(classifyKind("Compare the remote work policy with the leave policy")).toBe("comparison");
  });
  it("aggregations", () => {
    expect(classifyKind("How many employees work at Acme?")).toBe("aggregation");
  });
  it("multi-hop", () => {
    expect(classifyKind("What is connected to Project Atlas?")).toBe("multi_hop");
  });
  it("semantic / generic", () => {
    expect(classifyKind("What is the remote work policy?")).toBe("hybrid");
    expect(classifyKind("Summarize the onboarding guide")).toBe("hybrid");
  });
});

describe("extractSearchTerms", () => {
  it("lowercases, dedupes, drops stopwords", () => {
    expect(extractSearchTerms("Who is John Smith and who manages HR?")).not.toContain("who");
    expect(extractSearchTerms("Who is John Smith and who manages HR?").length).toBeGreaterThan(2);
  });
  it("handles empty input", () => {
    expect(extractSearchTerms("the and or")).toEqual([]);
  });
});

describe("extractEntityNameCandidates", () => {
  it("detects multi-word proper nouns separately (run breaking on lowercase words)", () => {
    const out = extractEntityNameCandidates("Who is John Smith and what does Project Atlas depend on?");
    expect(out).toContain("john smith");
    expect(out).toContain("project atlas");
    expect(out.some((c) => c.includes("smith project"))).toBe(false);
  });

  it("works for questions without uppercase references (returns empty)", () => {
    expect(extractEntityNameCandidates("what is the leave policy?")).toEqual([]);
  });

  it("detects single capitalized nouns of sufficient length", () => {
    expect(extractEntityNameCandidates("Is Kubernetes part of Project Atlas?")).toContain("kubernetes");
  });

  it("ignores question stems (Who/What/Where)", () => {
    const out = extractEntityNameCandidates("Where is Kubernetes deployed?");
    expect(out).toContain("kubernetes");
    expect(out.some((c) => c.startsWith("where"))).toBe(false);
  });

  it("handles quoted entity names", () => {
    expect(extractEntityNameCandidates('Show me the "Executive Compensation Plan"')).toContain("executive compensation plan");
  });
});

describe("buildPlan", () => {
  it("produces a bounded, validated plan", () => {
    const plan = buildPlan("Who manages Project Atlas?", {
      names: ["Project Atlas"],
      normalized: ["project atlas"]
    });
    expect(plan.kind).toBe("relationship_lookup");
    expect(plan.detectedEntities).toEqual(["Project Atlas"]);
    expect(plan.graphEnabled).toBe(true);
    expect(plan.maxDepth).toBeGreaterThanOrEqual(1);
    expect(plan.validationErrors).toHaveLength(0);
  });

  it("caps depth to the configured maximum", () => {
    const plan = buildPlan("What is X?", { names: [], normalized: [] }, { depth: 99 });
    expect(plan.maxDepth).toBe(3);
  });
});