import { describe, expect, it } from "vitest";
import {
  canAccess,
  isAdmin,
  aclToChromaFlags,
  buildChromaAccessFilter,
  isSourceAuthorized,
  type Acl
} from "./policy.js";
import type { Principal } from "@graphrag/shared";

function principal(over: Partial<Principal>): Principal {
  return {
    userId: "u1",
    email: "u1@example.com",
    companyId: "c1",
    roles: [],
    department: null,
    isRootAdmin: false,
    ...over
  };
}

describe("canAccess (RBAC/ACL core, fail-closed)", () => {
  const acl: Acl = { allowedRoles: ["HR"], allowedDepartments: ["HR"], ownerId: null };

  it("grants on the ADMIN role regardless of ACL", () => {
    expect(canAccess(principal({ roles: ["ADMIN"] }), { allowedRoles: [], allowedDepartments: [], ownerId: null })).toBe(true);
  });

  it("grants when a user role matches an allowed role", () => {
    expect(canAccess(principal({ roles: ["HR"] }), acl)).toBe(true);
  });

  it("grants when the user department matches", () => {
    expect(canAccess(principal({ roles: [], department: "HR" }), acl)).toBe(true);
  });

  it("grants document ownership through the private owner lane", () => {
    expect(
      canAccess(principal({ roles: [] }), {
        allowedRoles: [],
        allowedDepartments: [],
        ownerId: "u1"
      })
    ).toBe(true);
  });

  it("DENIES when no role, department, or ownership matches (fail-closed)", () => {
    expect(canAccess(principal({ roles: ["CONTRACTOR"], department: "ENGINEERING" }), acl)).toBe(false);
  });

  it("denies anonymous/no-role users", () => {
    expect(canAccess(principal({ roles: [] }), { allowedRoles: ["HR"], allowedDepartments: [], ownerId: "someone-else" })).toBe(false);
  });
});

describe("isAdmin", () => {
  it("true for ADMIN role", () => expect(isAdmin(principal({ roles: ["ADMIN"] }))).toBe(true));
  it("false otherwise", () => expect(isAdmin(principal({ roles: ["HR", "CONTRACTOR"] }))).toBe(false));
});

describe("aclToChromaFlags", () => {
  it("always emits every role/department key + owner (never omits keys)", () => {
    const flags = aclToChromaFlags({ allowedRoles: ["HR"], allowedDepartments: [], ownerId: "o1" });
    expect(flags.acl_role_ADMIN).toBe(true);
    expect(flags.acl_role_HR).toBe(true);
    expect(flags.acl_role_CONTRACTOR).toBe(false);
    expect(flags.acl_dept_ENGINEERING).toBe(false);
    expect(flags.acl_dept_LEGAL).toBe(false);
    expect(flags.owner_id).toBe("o1");
  });
});

describe("buildChromaAccessFilter", () => {
  const filterParts = (p: Principal): unknown[] => {
    const raw = buildChromaAccessFilter(p);
    const f = raw as { $and?: unknown[]; companyId?: string };
    if (f.$and) return f.$and;
    return [f];
  };

  it("admin sees the whole company (no grid grant clauses)", () => {
    const raw = buildChromaAccessFilter(principal({ roles: ["ADMIN"] }));
    expect(raw).toEqual({ companyId: "c1" });
  });

  it("scopes non-admins to their company first (tenant isolation)", () => {
    const [companyClause] = filterParts(principal({ roles: ["HR"], department: "HR" }));
    expect(companyClause).toEqual({ companyId: "c1" });
  });

  it("non-admins get an OR of role/dept/owner grants", () => {
    const [, grant] = filterParts(principal({ roles: ["HR"], department: "HR" }));
    const or = (grant as { $or: Record<string, unknown>[] }).$or;
    expect(or).toContainEqual({ acl_role_HR: { $eq: true } });
    expect(or).toContainEqual({ acl_dept_HR: { $eq: true } });
    expect(or).toContainEqual({ owner_id: { $eq: "u1" } });
  });

  it("a principal always gets an owner grant fallback (no roles/department)", () => {
    const [, grant] = filterParts(principal({ roles: [], department: null }));
    expect(grant).toEqual({ owner_id: { $eq: "u1" } });
  });

  it("cross-tenant principal is locked to the other company", () => {
    const [companyClause] = filterParts(principal({ roles: ["HR"], companyId: "c2" }));
    expect(companyClause).toEqual({ companyId: "c2" });
  });
});

describe("isSourceAuthorized", () => {
  it("ADMIN is always allowed", () => {
    expect(isSourceAuthorized(principal({ roles: ["ADMIN"] }), undefined)).toBe(true);
  });
  it("non-admin needs a non-empty source set (fail-closed)", () => {
    expect(isSourceAuthorized(principal({ roles: [] }), undefined)).toBe(false);
    expect(isSourceAuthorized(principal({ roles: [] }), [])).toBe(false);
    expect(isSourceAuthorized(principal({ roles: [] }), ["doc1"])).toBe(true);
  });
});