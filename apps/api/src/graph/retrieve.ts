import type { Principal } from "@graphrag/shared";
import { config } from "../config.js";
import { runQuery } from "./driver.js";
import { assertRelationshipType } from "./ontologyGuard.js";
import {
  authPredicate,
  tenantAuthPredicate,
  type AuthorizedEntity,
  type AuthorizedRelationship
} from "./acl.js";
import { rowToEntity } from "./acl.js";

export interface GraphPathResult {
  nodes: AuthorizedEntity[];
  relationships: AuthorizedRelationship[];
  text: string;
}

export interface TraversalInput {
  principal: Principal;
  tenantId: string;
  authDocs: string[];
  startNames: string[];
  maxDepth: number;
  limit?: number;
  allowedRelationships?: string[];
}

/** Validate depth is within configured bounds (never execute unbounded CYPHER). */
export function clampDepth(requested: number): number {
  const bound = Math.min(requested, config.MAX_GRAPH_DEPTH);
  return Math.max(1, bound);
}

/**
 * Traverse the authorized subgraph from the matched start entities for up to
 * maxDepth hops. Both start nodes and every intermediate node are constrained
 * to the authorized document set at query time; results are re-verified in JS
 * before being returned (defense in depth).
 */
export async function traverseAuthorizedGraph(input: TraversalInput): Promise<GraphPathResult> {
  const depth = clampDepth(input.maxDepth);
  if (input.startNames.length === 0) return { nodes: [], relationships: [], text: "" };
  const limit = input.limit ?? 50;

  const relFilter = input.allowedRelationships?.length
    ? input.allowedRelationships.map((t) => `type(r) = '${assertRelationshipType(t)}'`).join(" OR ")
    : null;

  const relClause =
    relFilter && depth === 1
      ? `AND (${relFilter})`
      : "";

  // Layered BFS so intermediate nodes are individually ACL-verified.
  let currentNames = input.startNames;
  const seenNodeIds = new Set<string>();
  const seenRelKeys = new Set<string>();
  const nodes = new Map<string, AuthorizedEntity>();
  const relationships = new Map<string, AuthorizedRelationship>();

  for (let hop = 0; hop < depth; hop++) {
    const current = [...currentNames];
    if (current.length === 0) break;
    // Traverse both edge directions: ownership/management edges commonly point
    // INTO the entity a question starts from (e.g. "HR Department OWNS Remote
    // Work Policy" when the question starts at the policy). startNode/endNode
    // preserve the stored source->target orientation for evidence text, while
    // `neighbor` advances the BFS frontier.
const rels = await runQuery<{ r: Record<string, unknown>; relType: string; s: Record<string, unknown>; t: Record<string, unknown>; neighbor: Record<string, unknown> }>(
      // startNode/endNode may not be called inside ORDER BY (Neo4j rejects it);
      // compute the incoming-edge priority in RETURN and order by the alias.
      `MATCH (a:Entity {tenantId: $tenantId})-[r]-(b:Entity {tenantId: $tenantId})
       WHERE a.name IN $current AND ${authPredicate("a")} AND ${authPredicate("b")}
       RETURN properties(r) AS r, type(r) AS relType,
              properties(startNode(r)) AS s, properties(endNode(r)) AS t,
              properties(b) AS neighbor,
              CASE WHEN startNode(r).name = b.name THEN 0 ELSE 1 END AS incoming
       ORDER BY incoming, r.confidence DESC
       LIMIT toInteger($limit)`,
      { tenantId: input.tenantId, authDocs: input.authDocs, current, limit }
    );

    const next: string[] = [];
    for (const row of rels) {
      const s = rowToEntity(row.s as Record<string, unknown>);
      const t = rowToEntity(row.t as Record<string, unknown>);
      // Re-verify in JS: sourceDocuments must be fully authorized.
      if (!isEntityAuthorized(s, input.authDocs) || !isEntityAuthorized(t, input.authDocs)) continue;
      const relType = String(row.relType ?? "");
      const rid = String(row.r.rid ?? "");
      if (!relType || !isValidRelType(relType)) continue;

      nodes.set(s.id, { ...sPort(s), ...s });
      nodes.set(t.id, { ...tPort(t), ...t });
      const key = `${rid}`;
      if (!seenRelKeys.has(key)) {
        seenRelKeys.add(key);
        relationships.set(key, {
          rid,
          type: relType,
          source: s,
          target: t,
          confidence: row.r.confidence != null ? Number(row.r.confidence) : null,
          sources: Array.isArray(row.r.sources) ? row.r.sources.map(String) : [],
          documentIds: Array.isArray(row.r.documentIds) ? row.r.documentIds.map(String) : [],
          sourceText: row.r.sourceText != null ? String(row.r.sourceText) : null,
          section: row.r.section != null ? String(row.r.section) : null,
          page: row.r.page != null ? Number(row.r.page) : null
        });
      }
      const nb = rowToEntity(row.neighbor as Record<string, unknown>);
      if (nb.name && !seenNodeIds.has(nb.id)) {
        seenNodeIds.add(nb.id);
        next.push(nb.name);
      }
    }
    currentNames = next;
    if (currentNames.length === 0) break;
  }

  const nodeList = Array.from(nodes.values());
  const relList = Array.from(relationships.values());
  const text = buildPathText(nodeList, relList);
  return { nodes: nodeList, relationships: relList, text };
}

/** Entity search across the authorized tenant subgraph. */
export async function searchAuthorizedEntities(opts: {
  principal: Principal;
  tenantId: string;
  authDocs: string[];
  query: string;
  types?: string[];
  limit?: number;
}): Promise<AuthorizedEntity[]> {
  const limit = opts.limit ?? 30;
  const q = opts.query.trim().toLowerCase();
  let typeFilter = "";
  const params: Record<string, unknown> = { tenantId: opts.tenantId, authDocs: opts.authDocs, limit };
  if (opts.types?.length) {
    typeFilter = "AND e.type IN $types";
    params.types = opts.types;
  }
  // If no query string, list entities most connected to the auth subgraph.
  const rows =
    q.length > 0
      ? await runQuery<{ e: Record<string, unknown> }>(
          `MATCH (e:Entity {tenantId: $tenantId})
           WHERE ${authPredicate("e")} ${typeFilter}
           AND (toLower(e.name) CONTAINS $q OR e.normalizedName CONTAINS $q)
           RETURN properties(e) AS e ORDER BY e.confidence DESC LIMIT toInteger($limit)`,
          { ...params, q }
        )
      : await runQuery<{ e: Record<string, unknown> }>(
          `MATCH (e:Entity {tenantId: $tenantId}) ${typeFilter ? "WHERE " + authPredicate("e") + " " + typeFilter : `WHERE ${authPredicate("e")}`}
           RETURN properties(e) AS e ORDER BY e.confidence DESC LIMIT toInteger($limit)`,
          params
        );
  return rows.map((r) => rowToEntity(r.e));
}

/** One-hop neighborhood for the Graph Explorer, ACL-filtered. */
export async function neighborhood(opts: {
  tenantId: string;
  authDocs: string[];
  entityName: string;
  depth?: number;
  limit?: number;
}): Promise<GraphPathResult> {
  const depth = clampDepth(opts.depth ?? 1);
  const rows = await runQuery<{ r: Record<string, unknown>; relType: string; s: Record<string, unknown>; t: Record<string, unknown> }>(
    `MATCH (s:Entity {tenantId: $tenantId, name: $name})-[r]-(t:Entity {tenantId: $tenantId})
     WHERE ${authPredicate("s")} AND ${authPredicate("t")}
     WITH r, s, t, startNode(r) AS rn, endNode(r) AS re
     RETURN properties(r) AS r, type(r) AS relType, properties(rn) AS s, properties(re) AS t LIMIT toInteger($limit)`,
    { tenantId: opts.tenantId, name: opts.entityName, authDocs: opts.authDocs, limit: opts.limit ?? 50 }
  );
  const nodes = new Map<string, AuthorizedEntity>();
  const relationships = new Map<string, AuthorizedRelationship>();
  for (const row of rows) {
    const s = rowToEntity(row.s as Record<string, unknown>);
    const t = rowToEntity(row.t as Record<string, unknown>);
    if (!isEntityAuthorized(s, opts.authDocs) || !isEntityAuthorized(t, opts.authDocs)) continue;
    const relType = String(row.relType ?? "");
    if (!relType || !isValidRelType(relType)) continue;
    nodes.set(s.id, s);
    nodes.set(t.id, t);
    const rid = String(row.r.rid ?? `${s.name}-${relType}-${t.name}`);
    relationships.set(rid, {
      rid,
      type: relType,
      source: s,
      target: t,
      confidence: row.r.confidence != null ? Number(row.r.confidence) : null,
      sources: Array.isArray(row.r.sources) ? row.r.sources.map(String) : [],
      documentIds: Array.isArray(row.r.documentIds) ? row.r.documentIds.map(String) : [],
      sourceText: row.r.sourceText != null ? String(row.r.sourceText) : null,
      section: row.r.section != null ? String(row.r.section) : null,
      page: row.r.page != null ? Number(row.r.page) : null
    });
  }
  return { nodes: Array.from(nodes.values()), relationships: Array.from(relationships.values()), text: buildPathText(Array.from(nodes.values()), Array.from(relationships.values())) };
}

export function isEntityAuthorized(e: { sourceDocuments: string[] }, authDocs: string[]): boolean {
  if (!e.sourceDocuments || e.sourceDocuments.length === 0) return false;
  const auth = new Set(authDocs);
  return e.sourceDocuments.every((d) => auth.has(d));
}

function sPort(e: AuthorizedEntity): { sourceDocuments: string[]; sourceChunks: string[] } {
  return { sourceDocuments: e.sourceDocuments, sourceChunks: e.sourceChunks };
}

function tPort(e: AuthorizedEntity): { sourceDocuments: string[]; sourceChunks: string[] } {
  return { sourceDocuments: e.sourceDocuments, sourceChunks: e.sourceChunks };
}

function isValidRelType(type: string): boolean {
  return ["WORKS_FOR", "BELONGS_TO", "HAS_ROLE", "MANAGES", "OWNS", "APPLIES_TO", "RELATED_TO", "DEPENDS_ON", "AFFECTS", "MENTIONS", "DEFINED_IN", "DESCRIBED_BY", "PART_OF", "REQUIRES", "USED_BY", "CREATED_BY", "UPDATED_BY"].includes(type);
}

export function buildPathText(nodes: AuthorizedEntity[], rels: AuthorizedRelationship[]): string {
  const lines: string[] = [];
  for (const r of rels) {
    lines.push(`${r.source.name} ${r.type} ${r.target.name}`);
  }
  return lines.join("\n");
}

export function getGraphEgressFields() {
  return { maxDepth: config.MAX_GRAPH_DEPTH };
}