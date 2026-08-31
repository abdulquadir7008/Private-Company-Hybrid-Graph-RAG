import { isEntityType, isRelationshipType } from "@graphrag/shared";

/**
 * Every Neo4j query goes through these guards. Labels and relationship types
 * are constants from the validated ontology — never user or LLM input.
 */

export const NODE_LABELS = {
  ENTITY: "Entity",
  DOCUMENT: "Document",
  CHUNK: "Chunk"
} as const;

export type NodeLabel = (typeof NODE_LABELS)[keyof typeof NODE_LABELS];

export function assertNodeLabel(label: string): NodeLabel {
  if (!Object.values(NODE_LABELS).includes(label as NodeLabel)) {
    throw new Error(`Unsafe node label: ${label}`);
  }
  return label as NodeLabel;
}

export function assertEntityType(type: string): string {
  if (!isEntityType(type)) {
    throw new Error(`Unsafe entity type: ${type}`);
  }
  return type;
}

export function assertRelationshipType(type: string): string {
  if (!isRelationshipType(type)) {
    throw new Error(`Unsafe relationship type: ${type}`);
  }
  return type;
}

/** Interpolate only validated constants into Cypher. */
export function relTypeLiteral(type: string): string {
  return `\`${assertRelationshipType(type)}\``;
}

export function labelLiteral(label: string): string {
  return `\`${assertNodeLabel(label)}\``;
}