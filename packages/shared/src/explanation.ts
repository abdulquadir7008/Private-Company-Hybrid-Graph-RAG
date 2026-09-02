/**
 * Explainable RAG — structured, ACL-aware answer explanation.
 *
 * The explanation is built from *observable retrieval/evidence metadata* that
 * the authenticated user was already authorized to see. It intentionally does
 * NOT contain any chain-of-thought, hidden reasoning, or model deliberation.
 *
 * Every evidence item surfaced here passed ACL verification during retrieval,
 * and is re-scoped to the requesting user's tenant + message on server read.
 */

export type EvidenceStrength = "HIGH" | "MEDIUM" | "LOW";

/** A single observation captured during query understanding. */
export interface ExplanationQueryInterpretation {
  question: string;
  normalizedQuestion: string;
  queryKind: string;
  detectedEntities: string[];
  searchTerms: string[];
  graphDepth: number;
  vectorEnabled: boolean;
  graphEnabled: boolean;
  keywordEnabled: boolean;
  validationErrors: string[];
}

/** Graph evidence that contributed, with per-edge provenance + ACL status. */
export interface ExplanationGraphEvidence {
  relationshipId: string;
  type: string;
  source: { id: string; name: string; type: string };
  target: { id: string; name: string; type: string };
  confidence: number | null;
  documents: string[];
  authorized: boolean;
}

/**
 * A concrete, ACL-authorized graph path surfaced to the user. Built from edges
 * that were ACTUALLY retrieved (never fabricated), and re-verified as fully
 * authorized before it is returned. Only fully-authorized paths are surfaced —
 * a partially authorized path is dropped entirely, never partially revealed.
 */
export interface ExplanationGraphPath {
  id: string;
  nodes: Array<{ id: string; name: string; type: string }>;
  edges: Array<{ id: string; sourceId: string; targetId: string; type: string }>;
  depth: number;
  relevance: number;
  sourceDocumentIds: string[];
  authorized: boolean;
}

/** Vector/document evidence that contributed. */
export interface ExplanationVectorEvidence {
  documentId: string;
  documentTitle: string;
  chunkId: string;
  section: string | null;
  page: number | null;
  similarity: number;
  rank: number;
  authorized: boolean;
}

/** Keyword/BM25 evidence that contributed. */
export interface ExplanationKeywordEvidence {
  documentId: string;
  documentTitle: string;
  chunkId: string | null;
  score: number;
  rank: number;
  authorized: boolean;
}

/** A retrieval pipeline stage's observable metrics. */
export interface ExplanationStageMetric {
  stage: string;
  before: number;
  after: number;
  note?: string;
}

/** Claim-to-evidence mapping for a specific sentence of the final answer. */
export interface ExplanationClaim {
  index: number;
  text: string;
  citationIndices: number[];
  graphRelationshipIds: string[];
  vectorChunkIds: string[];
}

/** Security/permission verification summary (never leaks unauthorized content). */
export interface ExplanationSecurity {
  tenantVerified: boolean;
  userAuthenticated: boolean;
  roleVerified: boolean;
  departmentVerified: boolean;
  documentClassificationVerified: boolean;
  graphEvidenceAuthorized: boolean;
  vectorEvidenceAuthorized: boolean;
  finalEvidenceReverified: boolean;
  excludedCount: number;
  /** Human-readable note about any exclusions WITHOUT revealing what was excluded. */
  exclusionNote: string | null;
}

/** Deterministic evidence-strength summary (NOT claimed as model certainty). */
export interface ExplanationEvidenceStrength {
  level: EvidenceStrength;
  supportingSources: number;
  graphSupport: boolean;
  vectorSupport: boolean;
  keywordSupport: boolean;
  citationCoverage: number; // 0..1 fraction of claims covered by a citation
  contradictionsDetected: boolean;
  note: string;
}

/** The full explanation trace. */
export interface AnswerExplanation {
  traceId: string;
  query: string;
  timestamp: string;
  retrievalPlan: ExplanationQueryInterpretation;
  graphEvidence: ExplanationGraphEvidence[];
  /** Ordered, connected, fully-authorized graph paths (each derived from graphEvidence edges actually used). */
  graphPaths: ExplanationGraphPath[];
  vectorEvidence: ExplanationVectorEvidence[];
  keywordEvidence: ExplanationKeywordEvidence[];
  pipelineMetrics: ExplanationStageMetric[];
  rerankedOrder: string[]; // evidence ids, top-first
  answerClaims: ExplanationClaim[];
  security: ExplanationSecurity;
  evidenceStrength: ExplanationEvidenceStrength;
  metrics: {
    graphCandidates: number;
    vectorCandidates: number;
    keywordCandidates: number;
    afterAclFiltering: number;
    afterFusion: number;
    afterReranking: number;
    usedForAnswer: number;
  };
}