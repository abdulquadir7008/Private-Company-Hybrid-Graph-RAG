import { z } from "zod";
import { ENTITY_TYPES, RELATIONSHIP_TYPES, type EntityType, type RelationshipType } from "./ontology.js";
import type { LlmProviderId } from "./llm.js";

/* ------------------------------------------------------------------ *
 * Roles / permissions
 * ------------------------------------------------------------------ */

export const ROLES = ["ADMIN", "HR", "LEGAL", "MANAGER", "EMPLOYEE", "CONTRACTOR"] as const;
export type Role = (typeof ROLES)[number];

export const DEPARTMENTS = [
  "GENERAL",
  "ENGINEERING",
  "HR",
  "LEGAL",
  "FINANCE",
  "MARKETING",
  "SALES",
  "LEADERSHIP"
] as const;
export type Department = (typeof DEPARTMENTS)[number];

export const DOCUMENT_SENSITIVITY = ["PUBLIC", "INTERNAL", "CONFIDENTIAL", "RESTRICTED"] as const;
export type DocumentSensitivity = (typeof DOCUMENT_SENSITIVITY)[number];

/** Identity-only JWT payload. Roles/permissions are reloaded from PG per request. */
export interface JwtIdentity {
  sub: string;
  email: string;
  companyId: string | null;
  roleScope: "company" | "root";
  sessionId: string;
  iat?: number;
  exp?: number;
}

export interface Principal {
  userId: string;
  email: string;
  companyId: string | null;
  roles: Role[];
  department: Department | null;
  isRootAdmin: boolean;
}

/* ------------------------------------------------------------------ *
 * Evidence / retrieval
 * ------------------------------------------------------------------ */

export type EvidenceSourceType = "vector" | "graph" | "keyword" | "path";

export interface EvidenceItem {
  id: string;
  sourceType: EvidenceSourceType;
  documentId?: string;
  documentTitle?: string;
  chunkId?: string;
  entityId?: string;
  entityName?: string;
  entityType?: string;
  relationshipId?: string;
  relationshipType?: string;
  relevanceScore: number;
  pageStart?: number | null;
  pageEnd?: number | null;
  section?: string | null;
  text: string;
  provenance: {
    tenantId: string;
    documentId?: string;
    chunkId?: string;
    page?: number;
    section?: string;
    confidence?: number;
  };
  aclStatus: "authorized" | "denied";
}

export interface GraphPath {
  nodes: GraphNodeDetail[];
  relationships: GraphRelationshipDetail[];
  text: string;
  sources: string[];
}

export interface GraphNodeDetail {
  id: string;
  name: string;
  type: string;
  tenantId: string;
  description?: string | null;
  confidence?: number | null;
  sources: string[];
}

export interface GraphRelationshipDetail {
  id: string;
  sourceId: string;
  sourceName: string;
  targetId: string;
  targetName: string;
  type: string;
  confidence?: number | null;
  sources: string[];
}

export interface Citation {
  index: number;
  documentId: string;
  documentName: string;
  section?: string | null;
  page?: number | null;
  chunkId: string;
  text: string;
  url: string;
}

export interface GroundedAnswer {
  answer: string;
  grounded: boolean;
  confidence: number;
  sources: Citation[];
  graphEvidence: GraphRelationshipDetail[];
  paths: GraphPath[];
}

export interface EvidenceBundle {
  vector: EvidenceItem[];
  graph: EvidenceItem[];
  keyword: EvidenceItem[];
  pathEvidence: EvidenceItem[];
  all: EvidenceItem[];
  reranked: EvidenceItem[];
}

/* ------------------------------------------------------------------ *
 * Query plan
 * ------------------------------------------------------------------ */

export const QUERY_KINDS = [
  "semantic_lookup",
  "entity_lookup",
  "relationship_lookup",
  "multi_hop",
  "aggregation",
  "comparison",
  "hybrid"
] as const;
export type QueryKind = (typeof QUERY_KINDS)[number];

export interface QueryPlan {
  kind: QueryKind;
  question: string;
  detectedEntities: string[];
  searchTerms: string[];
  vectorEnabled: boolean;
  graphEnabled: boolean;
  keywordEnabled: boolean;
  maxDepth: number;
  validationErrors: string[];
}

/* ------------------------------------------------------------------ *
 * Natural-language -> Graph Query Plan
 * ------------------------------------------------------------------ */

export const GRAPH_QUERY_INTENTS = [
  "find_entities",
  "find_paths",
  "find_relationships",
  "neighborhood",
  "count",
  "unknown"
] as const;
export type GraphQueryIntent = (typeof GRAPH_QUERY_INTENTS)[number];

export interface GraphQueryPathStep {
  entityType?: EntityType;
  relationshipType?: RelationshipType;
}

/**
 * Structured, schema-validated graph query plan produced by the LLM and then
 * re-validated server-side before ANY Neo4j interaction. The LLM NEVER emits
 * Cypher; the server compiles this plan into a bounded, ACL-constrained query.
 */
export interface GraphQueryPlan {
  intent: GraphQueryIntent;
  targetEntityTypes: EntityType[];
  startEntityTypes?: EntityType[];
  startEntityNames?: string[];
  relationshipTypes?: RelationshipType[];
  path?: GraphQueryPathStep[];
  maxDepth?: number;
  limit?: number;
  explanation?: string;
}

export const GRAPH_QUERY_MAX_DEPTH = 4;
export const GRAPH_QUERY_MAX_LIMIT = 100;

export const graphQueryPathStepSchema = z
  .object({
    entityType: z.enum(ENTITY_TYPES).optional(),
    relationshipType: z.enum(RELATIONSHIP_TYPES).optional()
  })
  .strict();

export const graphQueryPlanSchema = z
  .object({
    intent: z.enum(GRAPH_QUERY_INTENTS),
    targetEntityTypes: z.array(z.enum(ENTITY_TYPES)).max(6).default([]),
    startEntityTypes: z.array(z.enum(ENTITY_TYPES)).max(6).optional(),
    startEntityNames: z.array(z.string().min(1).max(120)).max(10).optional(),
    relationshipTypes: z.array(z.enum(RELATIONSHIP_TYPES)).max(8).optional(),
    path: z.array(graphQueryPathStepSchema).max(12).optional(),
    maxDepth: z.number().int().min(1).max(GRAPH_QUERY_MAX_DEPTH).optional(),
    limit: z.number().int().min(1).max(GRAPH_QUERY_MAX_LIMIT).optional(),
    explanation: z.string().max(400).optional()
  })
  .strict();

/* ------------------------------------------------------------------ *
 * Entity / relationship extraction (LLM output validation)
 * ------------------------------------------------------------------ */

export const extractedEntitySchema = z.object({
  name: z.string().min(1).max(200),
  type: z.enum(ENTITY_TYPES),
  description: z.string().max(500).optional().default(""),
  confidence: z.number().min(0).max(1).default(0.8)
});

export const extractedRelationshipSchema = z.object({
  source: z.string().min(1),
  type: z.enum(RELATIONSHIP_TYPES),
  target: z.string().min(1),
  confidence: z.number().min(0).max(1).default(0.8)
});

export const extractionResultSchema = z.object({
  entities: z.array(extractedEntitySchema).max(40).default([]),
  relationships: z.array(extractedRelationshipSchema).max(60).default([])
});

export type ExtractedEntity = z.infer<typeof extractedEntitySchema>;
export type ExtractedRelationship = z.infer<typeof extractedRelationshipSchema>;
export type ExtractionResult = z.infer<typeof extractionResultSchema>;

/* ------------------------------------------------------------------ *
 * API response envelope
 * ------------------------------------------------------------------ */

export interface ApiError {
  error: string;
  code?: string;
  field?: string;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

/* ------------------------------------------------------------------ *
 * Per-user LLM/API provider configuration
 * ------------------------------------------------------------------ */

/** Saved config for a single provider (apiKey stored as an opaque string). */
export interface SavedLlmProviderConfig {
  provider: LlmProviderId;
  apiKey?: string;
  model: string;
  embeddingModel?: string;
  baseUrl?: string;
}

/**
 * What a provider/config returns to the client. The API key itself is NEVER
 * exposed (only whether the provider has been configured). The `save`
 * payload echoes back the same shape and the client replaces its own copy.
 */
export interface LlmConfigStateItem {
  provider: LlmProviderId;
  configured: boolean;
  model: string;
  embeddingModel?: string;
  baseUrl?: string;
}

export interface LlmConfigState {
  activeProvider: LlmProviderId | null;
  providers: Record<LlmProviderId, LlmConfigStateItem>;
  /** True when saving changed the embedding model and a reindex is underway. */
  reindexing?: boolean;
}

/** Allowed cost tiers for the model dropdown filter. */
export const MODEL_TIER_FILTERS: ModelTierSummary[] = ["free", "freetier", "paid", "all"] as const;
export type ModelTierSummary = "free" | "freetier" | "paid" | "all";