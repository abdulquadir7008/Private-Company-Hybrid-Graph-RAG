import type { EntityType } from "@graphrag/shared";
import { runQuery } from "../graph/driver.js";
import { logger } from "../logger.js";

/**
 * Entity resolution / normalization.
 *
 * - Normalizes names into a canonical key, tenant-scoped and type-scoped.
 * - Prefers to merge via aliases rather than auto-merging on similarity.
 * - Only merges when the normalized key collides (high precision) or when
 *   embedding similarity exceeds a high threshold (optional).
 * - Never merges across companies.
 */

const EMBED_MERGE_THRESHOLD = 0.96;
const PERSON_PATTERN = /^(?:mr\.?|mrs\.?|ms\.?|dr\.?|prof\.?)\s+/i;

export function normalizeName(name: string, type: EntityType): string {
  let clean = name.trim().replace(/\s+/g, " ");
  if (type === "Person") {
    clean = clean.replace(PERSON_PATTERN, "");
    // "John A. Smith" -> "John Smith" (drop middle initials, keep long middle names)
    const parts = clean.split(" ");
    if (parts.length >= 3) {
      const middle = parts.slice(1, -1).filter((p) => !/^[a-z]\.$/i.test(p));
      if (middle.length === 0) {
        clean = `${parts[0]} ${parts[parts.length - 1]}`;
      }
    }
  }
  return clean
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function candidateKey(type: EntityType, name: string): string {
  return `${type}:${normalizeName(name, type)}`;
}

export interface ResolutionInput {
  tenantId: string;
  name: string;
  type: EntityType;
  normalizedName: string;
}

/**
 * Resolves an extracted entity against the tenant graph:
 * returns the id of an existing node when the normalized key collides,
 * otherwise null (caller creates a fresh node).
 */
export async function resolveEntity(
  input: ResolutionInput,
  opts: { similarity?: (a: string, b: string) => Promise<number> | number } = {}
): Promise<string | null> {
  const existing = await runQuery<{ e: { id: string; name?: string; aliases?: string[]; normalizedName?: string } }>(
    `MATCH (e:Entity {tenantId: $tenantId, type: $type})
     WHERE e.normalizedName = $normalized
        OR toLower(e.name) = toLower($name)
        OR $normalized IN e.aliases
     RETURN properties(e) AS e LIMIT 1`,
    { tenantId: input.tenantId, type: input.type, normalized: input.normalizedName, name: input.name }
  );

  if (existing.length > 0) {
    const rec = existing[0];
    // Optional embedding-based merge: only merge when confidence is high.
    if (opts.similarity) {
      const sim = await opts.similarity(input.name, String(rec.e.name ?? ""));
      if (typeof sim === "number" && sim < EMBED_MERGE_THRESHOLD) {
        logger.debug("entity resolution: embedding below merge threshold", {
          meta: { name: input.name, existing: rec.e.name, sim }
        });
        return null;
      }
    }
    return String(rec.e.id ?? "");
  }
  return null;
}

/** Report near-duplicate entities for admin / graph stats. */
export async function findDuplicateEntities(tenantId: string, types?: EntityType[]): Promise<{ name: string; type: string; count: number }[]> {
  const typeFilter = types?.length ? "AND e.type IN $types" : "";
  const rows = await runQuery<{ n: string; t: string; count: number }>(
    `MATCH (e:Entity {tenantId: $tenantId})
     WHERE e.normalizedName IS NOT NULL ${typeFilter}
     WITH e.type AS t, e.normalizedName AS key, collect(e.name) AS names
     WHERE size(names) > 1
     RETURN names[0] AS n, t, size(names) AS count
     ORDER BY count DESC LIMIT 25`,
    { tenantId, ...(types ? { types } : {}) }
  );
  return rows.map((r) => ({ name: String(r.n), type: String(r.t), count: Number(r.count) }));
}