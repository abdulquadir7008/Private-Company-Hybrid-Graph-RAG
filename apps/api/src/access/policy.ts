import type { Principal } from "@graphrag/shared";
import { DEPARTMENTS, ROLES } from "@graphrag/shared";

/**
 * Central RBAC/ACL decision core.
 *
 * Fail-closed: a document or chunk with no ACL row is accessible only to
 * ADMIN. Access is the additive union of the user's roles, their department,
 * and document ownership (private owner lane).
 */

export interface Acl {
  allowedRoles: string[];
  allowedDepartments: string[];
  ownerId?: string | null;
}

export function canAccess(principal: Pick<Principal, "userId" | "roles" | "department">, acl: Acl): boolean {
  if (isAdmin(principal)) return true;
  return (
    principal.roles.some((role) => acl.allowedRoles.includes(role)) ||
    (principal.department !== null && acl.allowedDepartments.includes(principal.department)) ||
    (acl.ownerId != null && acl.ownerId === principal.userId)
  );
}

export function isAdmin(principal: Pick<Principal, "roles">): boolean {
  return principal.roles.includes("ADMIN");
}

export function anyRoleMatch(roles: string[], allowedRoles: string[]): boolean {
  return roles.some((r) => allowedRoles.includes(r));
}

/** Compile an ACL into explicit Chroma metadata flags (never omitted keys). */
export function aclToChromaFlags(acl: Acl): Record<string, boolean | string> {
  const flags: Record<string, boolean | string> = {};
  for (const role of ROLES) {
    flags[`acl_role_${role}`] = role === "ADMIN" || acl.allowedRoles.includes(role);
  }
  for (const dept of DEPARTMENTS) {
    flags[`acl_dept_${dept}`] = acl.allowedDepartments.includes(dept);
  }
  flags.owner_id = acl.ownerId ?? "";
  return flags;
}

/**
 * Build a Chroma where-filter enforced inside similarity search.
 * Returns null when the principal can never match anything (-> zero results).
 */
export function buildChromaAccessFilter(principal: Principal): Record<string, unknown> | null {
  const companyClause = { companyId: principal.companyId };
  if (isAdmin(principal)) return companyClause;

  const grantClauses: Record<string, unknown>[] = [];
  for (const role of principal.roles) {
    grantClauses.push({ [`acl_role_${role}`]: { $eq: true } });
  }
  if (principal.department) {
    grantClauses.push({ [`acl_dept_${principal.department}`]: { $eq: true } });
  }
  grantClauses.push({ owner_id: { $eq: principal.userId } });

  if (grantClauses.length === 0) return null;
  const grant: Record<string, unknown> =
    grantClauses.length === 1 ? grantClauses[0] : { $or: grantClauses };
  return { $and: [companyClause, grant] };
}

/**
 * Returns true if a source context may be surfaced as evidence. Source
 * information originates in PostgreSQL; a context with no authorized document
 * backing is dropped for non-admins (fail-closed) so that relationship or
 * entity names can never leak unauthorized knowledge.
 */
export function isSourceAuthorized(
  principal: Pick<Principal, "roles">,
  sourceDocumentIds: string[] | undefined
): boolean {
  if (principal.roles.includes("ADMIN")) return true;
  return sourceDocumentIds !== undefined && sourceDocumentIds.length > 0;
}