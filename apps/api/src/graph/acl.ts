import type { Principal } from "@graphrag/shared";
import type { EntityType } from "@graphrag/shared";
import { runQuery } from "./driver.js";

/**
 * Graph ACL hardening.
 *
 * Authorization source of truth is PostgreSQL. Every Entity node stores
 * `sourceDocuments` (pg doc ids). A node is only reachable/visible when its
 * ENTIRE source set is within the principal's authorized document set. This
 * is fail-closed: a partially-shared entity can never leak the existence or
 * content of a document the user cannot see.
 */

export interface AuthorizedEntity {
  id: string;
  name: string;
  type: EntityType;
  description?: string | null;
  confidence?: number | null;
  normalizedName?: string;
  aliases?: string[];
  sourceDocuments: string[];
  sourceChunks: string[];
  score: number;
}

export interface AuthorizedRelationship {
  rid: string;
  type: string;
  source: AuthorizedEntity;
  target: AuthorizedEntity;
  confidence?: number | null;
  sources: string[];
  documentIds: string[];
  sourceText?: string | null;
  section?: string | null;
  page?: number | null;
}

/** Cypher predicate: every source document of the node must be authorized. */
export function authPredicate(variable: string): string {
  return `${variable}.sourceDocuments IS NOT NULL AND all(d IN ${variable}.sourceDocuments WHERE d IN $authDocs)`;
}

/** Also require the node to be inside the tenant. */
export function tenantAuthPredicate(variable: string, tenantId: string): string {
  return `${variable}.tenantId = $tenantId AND ${authPredicate(variable)}`;
}

/**
 * Fetch entities that are (a) tenant-scoped and (b) fully authorized, matched
 * by exact name or normalized name. Names come from the query planner's
 * entity detection output.
 */
export async function findAuthorizedEntitiesByNames(
  principal: Principal,
  tenantId: string,
  authDocs: string[],
  names: string[],
  limit = 30
): Promise<AuthorizedEntity[]> {
  if (names.length === 0) return [];
  const rows = await runQuery<{ e: Record<string, unknown> }>(
    `MATCH (e:Entity {tenantId: $tenantId})
     WHERE ${authPredicate("e")} AND (e.name IN $names OR e.normalizedName IN $names OR e.normalizedName IN $normNames)
     RETURN properties(e) AS e ORDER BY e.confidence DESC LIMIT toInteger($limit)
    `,
    { tenantId, authDocs, names, normNames: names.map((n) => n.toLowerCase()), limit }
  );
  return rows.map((r) => rowToEntity(r.e));
}

/** Stub to keep principal usage explicit (tenant isolation + ACL). */
export function assertPrincipalForTenant(principal: Principal, tenantId: string): void {
  if (principal.companyId !== tenantId) {
    throw new Error("Tenant mismatch");
  }
}

export function rowToEntity(e: Record<string, unknown>): AuthorizedEntity {
  return {
    id: String(e.id ?? ""),
    name: String(e.name ?? ""),
    type: (e.type as EntityType) ?? "Topic",
    description: e.description != null ? String(e.description) : null,
    confidence: e.confidence != null ? Number(e.confidence) : null,
    normalizedName: e.normalizedName != null ? String(e.normalizedName) : undefined,
    aliases: Array.isArray(e.aliases) ? e.aliases.map(String) : undefined,
    sourceDocuments: Array.isArray(e.sourceDocuments) ? e.sourceDocuments.map(String) : [],
    sourceChunks: Array.isArray(e.sourceChunks) ? e.sourceChunks.map(String) : [],
    score: Number(e.scoreMod ?? 0)
  };
}