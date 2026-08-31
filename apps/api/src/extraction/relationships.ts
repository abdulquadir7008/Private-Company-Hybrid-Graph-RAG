import { assertRelationshipSupported } from "@graphrag/shared";
import type { ExtractedRelationship } from "@graphrag/shared";
import { logger } from "../logger.js";

/**
 * Relationship validation: rejects unsupported relationship types and
 * type-incompatible pairs before they ever reach the graph. Returns the
 * validated relationships (dropping invalid ones with a log).
 */
export function validateRelationships(
  extracted: ExtractedRelationship[],
  knownEntities: Map<string, string> // name -> EntityType
): ExtractedRelationship[] {
  const valid: ExtractedRelationship[] = [];
  const seen = new Set<string>();
  for (const rel of extracted) {
    const srcType = knownEntities.get(rel.source);
    const tgtType = knownEntities.get(rel.target);
    if (!srcType || !tgtType) {
      logger.warn("relationship references unknown entity, dropping", {
        meta: { source: rel.source, target: rel.target }
      });
      continue;
    }
    try {
      assertRelationshipSupported(srcType, rel.type, tgtType);
    } catch (err) {
      logger.warn("relationship rejected by ontology", { err, meta: { source: rel.source, type: rel.type, target: rel.target } });
      continue;
    }
    const key = `${rel.source}::${rel.type}::${rel.target}`;
    if (seen.has(key)) continue;
    seen.add(key);
    valid.push(rel);
  }
  return valid;
}