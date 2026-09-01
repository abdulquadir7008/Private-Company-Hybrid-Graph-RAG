import { describe, expect, it, vi, beforeEach } from "vitest";
import { traverseAuthorizedGraph } from "./retrieve.js";
import * as driver from "./driver.js";
import type { Principal } from "@graphrag/shared";

vi.mock("./driver.js", () => ({ runQuery: vi.fn() }));

const principal: Principal = {
  userId: "u1",
  email: "admin@acme.com",
  companyId: "t1",
  roles: ["ADMIN"],
  department: "GENERAL",
  isRootAdmin: false
};

const hood = (over: Record<string, unknown>) => ({
  name: "Remote Work Policy",
  id: "e1",
  tenantId: "t1",
  type: "Policy",
  normalizedName: "remote work policy",
  description: "policy",
  confidence: 0.9,
  sourceDocuments: ["d1"],
  sourceChunks: ["c1"],
  ...over
});

beforeEach(() => {
  vi.mocked(driver.runQuery).mockReset();
});

describe("traverseAuthorizedGraph", () => {
  it("finds incoming edges (owner OWNS the start entity) when the question starts at the policy", async () => {
    const s = hood({ name: "HR Department", id: "e9", type: "Department" });
    const t = hood({});
    vi.mocked(driver.runQuery).mockResolvedValue([
      {
        r: { rid: "r1", confidence: 0.99, sources: ["d1"], documentIds: ["d1"] },
        relType: "OWNS",
        s,
        t,
        neighbor: s // other endpoint of the edge, the BFS frontier advances to HR Department
      }
    ]);

    const result = await traverseAuthorizedGraph({
      principal,
      tenantId: "t1",
      authDocs: ["d1"],
      startNames: ["Remote Work Policy"],
      maxDepth: 1
    });

    expect(driver.runQuery).toHaveBeenCalledTimes(1);
    expect(result.relationships).toHaveLength(1);
    expect(result.relationships[0].type).toBe("OWNS");
    expect(result.relationships[0].source.name).toBe("HR Department");
    expect(result.relationships[0].target.name).toBe("Remote Work Policy");
    expect(result.nodes).toHaveLength(2);
  });

  it("advances the BFS frontier through the neighbor even when the start is the edge target", async () => {
    const hr = hood({ name: "HR Department", id: "e9", type: "Department" });
    const policy = hood({});
    vi.mocked(driver.runQuery)
      .mockResolvedValueOnce([
        {
          r: { rid: "r1", confidence: 0.99, sources: ["d1"], documentIds: ["d1"] },
          relType: "OWNS",
          s: hr,
          t: policy,
          neighbor: hr
        }
      ])
      .mockResolvedValueOnce([]);

    const result = await traverseAuthorizedGraph({
      principal,
      tenantId: "t1",
      authDocs: ["d1"],
      startNames: ["Remote Work Policy", "HR Department"],
      maxDepth: 2
    });

    expect(driver.runQuery).toHaveBeenCalledTimes(2);
    expect(result.relationships).toHaveLength(1);
    expect(result.relationships[0].source.name).toBe("HR Department");
  });

  it("returns an empty result when no entities are authorized", async () => {
    const s = hood({ name: "HR Department", id: "e9", type: "Department", sourceDocuments: ["dX"] });
    const t = hood({});
    vi.mocked(driver.runQuery).mockResolvedValue([
      { r: { rid: "r1", confidence: 0.99, sources: ["dX"], documentIds: ["dX"] }, relType: "OWNS", s, t, neighbor: s }
    ]);

    const result = await traverseAuthorizedGraph({
      principal,
      tenantId: "t1",
      authDocs: ["d1"],
      startNames: ["Remote Work Policy"],
      maxDepth: 1
    });

    expect(result.relationships).toHaveLength(0);
    expect(result.nodes).toHaveLength(0);
  });
});