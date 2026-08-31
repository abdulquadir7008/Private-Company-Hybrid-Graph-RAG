/**
 * Controlled graph ontology.
 *
 * The knowledge graph only ever contains node types and relationship types
 * declared here. Every extraction is validated against this ontology before
 * being written to Neo4j. LLM-proposed schemas are never accepted.
 */

export const ENTITY_TYPES = [
  "Company",
  "User",
  "Employee",
  "Department",
  "Role",
  "Person",
  "Organization",
  "Document",
  "Chunk",
  "Policy",
  "Product",
  "Project",
  "Technology",
  "Requirement",
  "Procedure",
  "Location",
  "Event",
  "Topic"
] as const;

export type EntityType = (typeof ENTITY_TYPES)[number];

export const RELATIONSHIP_TYPES = [
  "WORKS_FOR",
  "BELONGS_TO",
  "HAS_ROLE",
  "MANAGES",
  "OWNS",
  "APPLIES_TO",
  "RELATED_TO",
  "DEPENDS_ON",
  "AFFECTS",
  "MENTIONS",
  "DEFINED_IN",
  "DESCRIBED_BY",
  "PART_OF",
  "REQUIRES",
  "USED_BY",
  "CREATED_BY",
  "UPDATED_BY"
] as const;

export type RelationshipType = (typeof RELATIONSHIP_TYPES)[number];

/**
 * Maps entity type -> relationship type -> allowed target entity types.
 * `*` means any ontology type. This is the schema validation layer used by
 * both extraction and graph writes (fail-closed).
 */
export const RELATIONSHIP_SCHEMA: Record<
  RelationshipType,
  { sourceTypes: readonly (EntityType | "*")[]; targetTypes: readonly (EntityType | "*")[] }
> = {
  WORKS_FOR: { sourceTypes: ["Person", "Employee"], targetTypes: ["Organization", "Company", "Department"] },
  BELONGS_TO: { sourceTypes: ["Employee", "Person", "Document", "Policy", "Product", "Project", "Department", "*"], targetTypes: ["Department", "Organization", "Company", "Project", "*"] },
  HAS_ROLE: { sourceTypes: ["Person", "Employee", "User"], targetTypes: ["Role"] },
  MANAGES: { sourceTypes: ["Person", "Employee", "Role", "Department"], targetTypes: ["Person", "Employee", "Department", "Project", "Policy"] },
  OWNS: { sourceTypes: ["Person", "Employee", "Department", "Role", "Organization", "Company"], targetTypes: ["Document", "Policy", "Project", "Product", "Procedure", "Requirement"] },
  APPLIES_TO: { sourceTypes: ["Policy", "Document", "Procedure", "Requirement"], targetTypes: ["Role", "Department", "Employee", "Person", "User", "Company", "Policy", "Project"] },
  RELATED_TO: { sourceTypes: ["*"], targetTypes: ["*"] },
  DEPENDS_ON: { sourceTypes: ["*"], targetTypes: ["*"] },
  AFFECTS: { sourceTypes: ["*"], targetTypes: ["*"] },
  MENTIONS: { sourceTypes: ["Chunk", "Document"], targetTypes: ["*"] },
  DEFINED_IN: { sourceTypes: ["Policy", "Requirement", "Procedure", "Role", "Technology", "Product"], targetTypes: ["Document", "Chunk"] },
  DESCRIBED_BY: { sourceTypes: ["*"], targetTypes: ["Document", "Chunk", "Topic"] },
  PART_OF: { sourceTypes: ["*"], targetTypes: ["*"] },
  REQUIRES: { sourceTypes: ["*"], targetTypes: ["*"] },
  USED_BY: { sourceTypes: ["Technology", "Product", "Project"], targetTypes: ["*"] },
  CREATED_BY: { sourceTypes: ["Person", "Employee", "Department", "User", "Role"], targetTypes: ["Document", "Policy", "Procedure", "Product", "Project", "Requirement"] },
  UPDATED_BY: { sourceTypes: ["Person", "Employee", "Department", "User", "Role"], targetTypes: ["Document", "Policy", "Procedure", "Product", "Project", "Requirement"] }
};

export function isEntityType(value: string): value is EntityType {
  return (ENTITY_TYPES as readonly string[]).includes(value);
}

export function isRelationshipType(value: string): value is RelationshipType {
  return (RELATIONSHIP_TYPES as readonly string[]).includes(value);
}

/** Throws if the relationship is not part of the controlled ontology. */
export function assertRelationshipSupported(sourceType: string, relType: string, targetType: string): void {
  if (!isRelationshipType(relType)) {
    throw new Error(`Unsupported relationship type "${relType}". Allowed: ${RELATIONSHIP_TYPES.join(", ")}`);
  }
  if (!isEntityType(sourceType)) {
    throw new Error(`Unsupported entity type "${sourceType}"`);
  }
  if (!isEntityType(targetType)) {
    throw new Error(`Unsupported entity type "${targetType}"`);
  }
  const rule = RELATIONSHIP_SCHEMA[relType];
  const srcOk = rule.sourceTypes.includes("*") || rule.sourceTypes.includes(sourceType as EntityType);
  const tgtOk = rule.targetTypes.includes("*") || rule.targetTypes.includes(targetType as EntityType);
  if (!srcOk) {
    throw new Error(`Relationship ${relType} does not allow source type "${sourceType}"`);
  }
  if (!tgtOk) {
    throw new Error(`Relationship ${relType} does not allow target type "${targetType}"`);
  }
}