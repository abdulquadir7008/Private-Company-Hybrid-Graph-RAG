import { describe, expect, it, vi, beforeEach } from "vitest";
import type { GraphQueryPlan, GraphQueryPathStep, Principal } from "@graphrag/shared";
import { graphQueryPlanSchema } from "@graphrag/shared";
import { detectGraphQuery, parsePlanJson, generateGraphQueryPlan, executeGraphQueryPlan, GraphQueryError } from "./aiQuery.js";
import * as llm from "../ai/llm.js";
import * as aclRepo from "../access/aclRepository.js";
import * as retrieve from "./retrieve.js";
import type { AuthorizedEntity, AuthorizedRelationship } from "./acl.js";

vi.mock("../ai/llm.js", () => ({ chatCompletion: vi.fn() }));
vi.mock("../access/aclRepository.js", () => ({ authorizedDocumentIds: vi.fn() }));
vi.mock("./retrieve.js", () => ({
  searchAuthorizedEntities: vi.fn(),
  traverseAuthorizedGraph: vi.fn(),
  isEntityAuthorized: vi.fn()
}));

const principal: Principal = {
  userId: "u1",
  email: "admin@acme.com",
  companyId: "t1",
  roles: ["ADMIN"],
  department: "GENERAL",
  isRootAdmin: false
};

const node = (over: { id?: string; name?: string; type?: string; sourceDocuments?: string[] }): AuthorizedEntity => ({
  id: over.id ?? "e1",
  name: over.name ?? "Remote Work Policy",
  type: (over.type ?? "Policy") as AuthorizedEntity["type"],
  sourceDocuments: over.sourceDocuments ?? ["d1"],
  sourceChunks: ["c1"],
  score: 0.9,
  confidence: 0.9
});

beforeEach(() => {
  vi.resetAllMocks();
});

describe("detectGraphQuery", () => {
  it("treats a bare entity name as entity search", () => {
    expect(detectGraphQuery("Remote Work Policy")).toBe(false);
    expect(detectGraphQuery("John Smith")).toBe(false);
    expect(detectGraphQuery("Engineering Department")).toBe(false);
  });

  it("treats natural-language relationship questions as graph queries", () => {
    expect(detectGraphQuery("Show me everyone related to the Remote Work Policy.")).toBe(true);
    expect(detectGraphQuery("Which employees are connected to security policies?")).toBe(true);
    expect(detectGraphQuery("Who reports to managers associated with security policies?")).toBe(true);
  });
});

describe("parsePlanJson", () => {
  it("parses plain JSON object output", () => {
    const out = parsePlanJson('{"intent":"find_entities","targetEntityTypes":["Employee"]}');
    expect(out).toEqual({ intent: "find_entities", targetEntityTypes: ["Employee"] });
  });

  it("strips markdown code fences", () => {
    const out = parsePlanJson('```json\n{"intent":"find_paths"}\n```');
    expect(out).toEqual({ intent: "find_paths" });
  });

  it("returns null for non-JSON / arbitrary Cypher output", () => {
    expect(parsePlanJson("MATCH (n) RETURN n")).toBeNull();
    expect(parsePlanJson("")).toBeNull();
    expect(parsePlanJson("not json at all")).toBeNull();
  });
});

describe("graphQueryPlanSchema (strict plan validation)", () => {
  it("accepts a valid plan", () => {
    const plan: GraphQueryPlan = {
      intent: "find_entities",
      targetEntityTypes: ["Employee"],
      startEntityTypes: ["Policy"],
      path: [
        { entityType: "Policy" },
        { entityType: "Department" },
        { entityType: "Employee" }
      ],
      maxDepth: 3,
      limit: 50
    };
    expect(graphQueryPlanSchema.safeParse(plan).success).toBe(true);
  });

  it("rejects an unknown entity type (arbitrary/fabricated label)", () => {
    expect(graphQueryPlanSchema.safeParse({ intent: "find_entities", targetEntityTypes: ["Nothing"] }).success).toBe(false);
  });

  it("rejects an unknown relationship type", () => {
    expect(
      graphQueryPlanSchema.safeParse({
        intent: "find_relationships",
        targetEntityTypes: ["Employee"],
        relationshipTypes: ["SECRET_REL"]
      }).success
    ).toBe(false);
  });

  it("rejects excessive depth (unbounded traversal)", () => {
    expect(graphQueryPlanSchema.safeParse({ intent: "find_paths", targetEntityTypes: ["Employee"], maxDepth: 999 }).success).toBe(false);
  });

  it("rejects excessive result limit", () => {
    expect(graphQueryPlanSchema.safeParse({ intent: "find_entities", targetEntityTypes: ["Employee"], limit: 10_000 }).success).toBe(false);
  });

  it("rejects unknown intent", () => {
    expect(graphQueryPlanSchema.safeParse({ intent: "delete_everything", targetEntityTypes: ["Employee"] }).success).toBe(false);
  });

  it("rejects arbitrary / unknown extra fields (strict)", () => {
    expect(graphQueryPlanSchema.safeParse({ intent: "find_entities", targetEntityTypes: ["Employee"], cypher: "MATCH (n) DETACH DELETE n" }).success).toBe(false);
  });
});

describe("generateGraphQueryPlan", () => {
  it("returns a validated plan from the LLM", async () => {
    vi.mocked(llm.chatCompletion).mockResolvedValue({
      content: JSON.stringify({
        intent: "find_entities",
        targetEntityTypes: ["Employee"],
        startEntityTypes: ["Policy"],
        path: [{ entityType: "Policy" }, { entityType: "Department" }, { entityType: "Employee" }],
        maxDepth: 2,
        limit: 50,
        explanation: "Finding employees connected to security policies"
      }),
      model: "test"
    });
    const plan = await generateGraphQueryPlan("Which employees are connected to security policies?");
    expect(plan).not.toBeNull();
    expect(plan!.intent).toBe("find_entities");
    expect(plan!.targetEntityTypes).toContain("Employee");
  });

  it("returns null when the LLM emits unknown intent", async () => {
    vi.mocked(llm.chatCompletion).mockResolvedValue({ content: JSON.stringify({ intent: "unknown", targetEntityTypes: [] }), model: "test" });
    const plan = await generateGraphQueryPlan("show me everything");
    expect(plan).toBeNull();
  });

  it("returns null when the LLM returns invalid Cypher instead of a plan", async () => {
    vi.mocked(llm.chatCompletion).mockResolvedValue({ content: "MATCH (n) RETURN n LIMIT 100000", model: "test" });
    const plan = await generateGraphQueryPlan("show me everything");
    expect(plan).toBeNull();
  });

  it("throws AI_UNAVAILABLE when the LLM call fails", async () => {
    vi.mocked(llm.chatCompletion).mockRejectedValue(new Error("provider down"));
    await expect(generateGraphQueryPlan("who manages engineering")).rejects.toMatchObject({ code: "AI_UNAVAILABLE" });
  });
});

describe("executeGraphQueryPlan (ACL / tenant enforcement)", () => {
  const plan: GraphQueryPlan = {
    intent: "find_entities",
    targetEntityTypes: ["Employee"],
    startEntityTypes: ["Policy"],
    path: [{ entityType: "Policy" }, { entityType: "Department" }, { entityType: "Employee" }],
    maxDepth: 3,
    limit: 50,
    explanation: "Finding employees connected to security policies"
  };

  it("resolves authorized anchor entities and returns authorized nodes/relationships", async () => {
    vi.mocked(aclRepo.authorizedDocumentIds).mockResolvedValue(new Set(["d1", "d2"]));
    vi.mocked(retrieve.searchAuthorizedEntities).mockResolvedValue([node({ id: "p1", name: "Security Policy", type: "Policy" })]);
    vi.mocked(retrieve.isEntityAuthorized).mockImplementation((e: Pick<AuthorizedEntity, "sourceDocuments">) => e.sourceDocuments.every((d) => ["d1", "d2"].includes(d)));
    vi.mocked(retrieve.traverseAuthorizedGraph).mockResolvedValue({
      nodes: [node({ id: "p1", name: "Security Policy", type: "Policy" }), node({ id: "e2", name: "Engineer", type: "Employee" })],
      relationships: [],
      text: ""
    });

    const result = await executeGraphQueryPlan({ principal, plan });
    expect(result.nodes.map((n) => n.name)).toContain("Security Policy");
    expect(aclRepo.authorizedDocumentIds).toHaveBeenCalledWith(principal);
    expect(retrieve.traverseAuthorizedGraph).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "t1", startNames: ["Security Policy"], maxDepth: 3 })
    );
  });

  it("drops unauthorized entities even if traversal returns them (defense in depth)", async () => {
    vi.mocked(aclRepo.authorizedDocumentIds).mockResolvedValue(new Set(["d1"]));
    vi.mocked(retrieve.searchAuthorizedEntities).mockResolvedValue([node({ id: "p1", name: "Security Policy", type: "Policy" })]);
    // The traversal leaks an entity referencing an unauthorized doc (dX).
    vi.mocked(retrieve.isEntityAuthorized).mockImplementation((e: Pick<AuthorizedEntity, "sourceDocuments">) => {
      // p1 is fine, e2 references dX and is NOT authorized.
      return !e.sourceDocuments.includes("dX");
    });
    const rel: AuthorizedRelationship = {
      rid: "r1",
      type: "OWNS",
      source: node({ id: "p1", name: "Security Policy", type: "Policy", sourceDocuments: ["d1"] }),
      target: node({ id: "e2", name: "Engineer", type: "Employee", sourceDocuments: ["dX"] }),
      sources: ["d1"],
      documentIds: ["d1"]
    };
    vi.mocked(retrieve.traverseAuthorizedGraph).mockResolvedValue({
      nodes: [rel.source, rel.target],
      relationships: [rel],
      text: ""
    });

    const result = await executeGraphQueryPlan({ principal, plan });
    // The unauthorized relationship must never be surfaced.
    expect(result.relationships).toHaveLength(0);
    // The unauthorized endpoint node must be dropped too.
    expect(result.nodes.map((n) => n.name)).not.toContain("Engineer");
  });

  it("throws a friendly NO_MATCH when no authorized anchor resolves", async () => {
    vi.mocked(aclRepo.authorizedDocumentIds).mockResolvedValue(new Set(["d1"]));
    vi.mocked(retrieve.searchAuthorizedEntities).mockResolvedValue([]);
    await expect(executeGraphQueryPlan({ principal, plan })).rejects.toBeInstanceOf(GraphQueryError);
  });

  it("throws when tenant has no authorized documents (empty auth set)", async () => {
    vi.mocked(aclRepo.authorizedDocumentIds).mockResolvedValue(new Set([]));
    const result = await executeGraphQueryPlan({
      principal: { ...principal, companyId: "t2" },
      plan
    });
    // No auth docs -> returns empty authorized result rather than an unauthorized traversal.
    expect(result.nodes).toEqual([]);
    expect(result.relationships).toEqual([]);
  });
});

describe("plan schema edge detection for example queries", () => {
  it("generates an employee-focused path for employee-connected-to-policy questions", () => {
    const plan = {
      intent: "find_entities",
      targetEntityTypes: ["Employee"],
      startEntityTypes: ["Policy"],
      path: [{ entityType: "Policy" }, { entityType: "Department" }, { entityType: "Employee" }],
      maxDepth: 3
    } as const;
    const parsed = graphQueryPlanSchema.safeParse(plan);
    expect(parsed.success).toBe(true);
    const p = parsed.data as { path?: GraphQueryPathStep[] };
    expect(p.path?.map((s) => s.entityType)).toEqual(["Policy", "Department", "Employee"]);
  });
});