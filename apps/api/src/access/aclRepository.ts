import type { Principal } from "@graphrag/shared";
import { prisma } from "../db.js";
import { canAccess, type Acl } from "./policy.js";

/**
 * Reads ACLs from PostgreSQL and evaluates them against a principal.
 * These helpers are used by every retrieval path and by the graph ACL
 * hardening layer, so authorization happens exactly once, in one place.
 */

export async function getDocumentAcl(companyId: string, documentId: string): Promise<Acl> {
  const doc = await prisma.documentACL.findUnique({
    where: { documentId },
    select: { allowedRoles: true, allowedDepartments: true, ownerId: true }
  });
  if (!doc) {
    // Fail-closed: unclassified documents are admin-only.
    return { allowedRoles: ["ADMIN"], allowedDepartments: [], ownerId: null };
  }
  return { allowedRoles: doc.allowedRoles, allowedDepartments: doc.allowedDepartments, ownerId: doc.ownerId };
}

export async function getChunkAcl(companyId: string, chunkId: string): Promise<Acl> {
  const chunk = await prisma.documentChunk.findUnique({
    where: { id: chunkId },
    select: { documentId: true, acl: { select: { allowedRoles: true, allowedDepartments: true, ownerId: true } } }
  });
  if (chunk?.acl) {
    return { allowedRoles: chunk.acl.allowedRoles, allowedDepartments: chunk.acl.allowedDepartments, ownerId: chunk.acl.ownerId };
  }
  if (chunk) return getDocumentAcl(companyId, chunk.documentId);
  return { allowedRoles: ["ADMIN"], allowedDepartments: [], ownerId: null };
}

export async function canAccessDocument(principal: Principal, documentId: string): Promise<boolean> {
  if (!principal.companyId) return false;
  const acl = await getDocumentAcl(principal.companyId, documentId);
  return canAccess(principal, acl);
}

/** The full set of document ids this principal may use as evidence sources. */
export async function authorizedDocumentIds(principal: Principal): Promise<Set<string>> {
  if (!principal.companyId) return new Set<string>();
  const rows = await prisma.documentACL.findMany({
    where: { companyId: principal.companyId },
    select: {
      documentId: true,
      allowedRoles: true,
      allowedDepartments: true,
      ownerId: true
    }
  });
  const ids = new Set<string>();
  if (principal.roles.includes("ADMIN")) {
    const all = await prisma.document.findMany({
      where: { companyId: principal.companyId },
      select: { id: true }
    });
    for (const d of all) ids.add(d.id);
    return ids;
  }
  for (const row of rows) {
    if (row.documentId && canAccess(principal, row)) ids.add(row.documentId);
  }
  return ids;
}

/** Whether an entity's source documents are all inside the authorized set. */
export function entitySourcesAuthorized(authorized: Set<string>, entitySourceDocuments: string[] | undefined): boolean {
  if (!entitySourceDocuments || entitySourceDocuments.length === 0) return false;
  return entitySourceDocuments.every((d) => authorized.has(d));
}