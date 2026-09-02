// Frontend-only mirrors of the API response shapes. Kept decoupled from the
// shared package so the web build is self-contained.

export interface MeUser {
  id: string;
  email: string;
  name?: string | null;
  department?: string | null;
  roles: string[];
  company?: { id: string; name: string; status: string } | null;
  mustChangePassword?: boolean;
  isRootAdmin?: boolean;
}

export interface LoginResponse {
  token: string;
  mustChangePassword: boolean;
  user: {
    id: string;
    email: string;
    name?: string | null;
    department?: string | null;
    roles: string[];
  };
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

export interface GraphNode {
  id: string;
  name: string;
  type: string;
  description?: string | null;
  confidence?: number | null;
  sourceDocuments?: string[];
  sourceChunks?: string[];
}

export interface GraphRelationship {
  rid: string;
  type: string;
  source: { id: string; name: string; type?: string };
  target: { id: string; name: string; type?: string };
  sourceId?: string;
  targetId?: string;
  confidence?: number | null;
  sources?: string[];
}

export interface GraphPath {
  nodes: GraphNode[];
  relationships: GraphRelationship[];
  text: string;
  sources: string[];
}

export interface QueryPlan {
  kind: string;
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
 * Natural-language -> Graph Query (mirrors of the API contract)
 * ------------------------------------------------------------------ */

export type GraphQueryIntent = "find_entities" | "find_paths" | "find_relationships" | "neighborhood" | "count" | "unknown";

export interface GraphQueryPlan {
  intent: GraphQueryIntent;
  targetEntityTypes: string[];
  startEntityTypes?: string[];
  startEntityNames?: string[];
  relationshipTypes?: string[];
  path?: Array<{ entityType?: string; relationshipType?: string }>;
  maxDepth?: number;
  limit?: number;
  explanation?: string;
}

export interface GraphQueryExplanation {
  summary: string;
  steps: string[];
}

export interface AiGraphQueryResponse {
  query: string;
  queryPlan: GraphQueryPlan | null;
  explanation: GraphQueryExplanation;
  isEntitySearch: boolean;
  items?: { id: string; name: string; type: string; description?: string | null; confidence?: number | null }[];
  relationships: GraphRelationship[];
  isolatedNodes?: { id: string; name: string; type: string; description?: string | null; confidence?: number | null }[];
  stats: { nodes: number; relationships: number };
  trace?: {
    question: string;
    intent: string;
    path: Array<{ entityType?: string; relationshipType?: string }>;
    maxDepth: number;
    relationshipTypes: string[];
    candidateNodes: number;
    authorizedNodes: number;
    relationshipsReturned: number;
  };
}

export interface ChatResponse {
  conversationId: string;
  messageId: string;
  question: string;
  answer: string;
  grounded: boolean;
  confidence: number;
  sources: Citation[];
  graphEvidence: GraphRelationship[];
  paths: GraphPath[];
  entities: string[];
  explanationId?: string;
  explanation?: AnswerExplanation | null;
  retrievalMeta: { plan: QueryPlan; stats: Record<string, unknown> };
}

export interface ChatMessage {
  id: string;
  role: string;
  content: string;
  citations?: Citation[] | null;
  graphEvidence?: { relationships?: GraphRelationship[]; paths?: GraphPath[] } | null;
  retrievalMeta?: Record<string, unknown> | null;
  explanation?: AnswerExplanation | null;
  explanationId?: string | null;
  createdAt?: string;
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages?: ChatMessage[];
}

export interface DocumentSummary {
  id: string;
  title: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  category: string;
  sensitivity: string;
  status: string;
  chunkCount?: number;
  entityCount?: number;
  createdAt: string;
  uploadedBy?: { email: string } | null;
  acl?: { allowedRoles: string[]; allowedDepartments: string[]; sensitivity: string };
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface GraphStats {
  entities: number;
  relationships: number;
  chunks: number;
  documents: number;
  unavailable?: boolean;
}

export interface EntityDetail {
  entity: GraphNode;
  relatedEntities: GraphNode[];
  relationships: GraphRelationship[];
  sourceDocuments: { id: string; title: string; category: string; sensitivity: string; status: string }[];
  sourceChunks: { id: string; documentId: string; section: string | null; pageStart: number | null; index: number }[];
  permissions: { visibleToYou: boolean; sourceCount: number };
}

export interface AdminGraph {
  neo4j: GraphStats;
  duplicates: { name: string; count: number }[];
  postgres: {
    id: string;
    entityCount: number;
    relationshipCount: number;
    documentCount: number;
    orphanCount: number;
    duplicateEntityCount: number;
    avgConfidence: number;
    failedExtractionCount: number;
  } | null;
}

export interface AdminUser {
  id: string;
  email: string;
  name: string | null;
  department: string | null;
  roles: string[];
  isActive: boolean;
  mustChangePassword: boolean;
  emailVerifiedAt: string | null;
  createdAt: string;
}

export interface AuditEntry {
  id: string;
  action: string;
  detail: unknown;
  userId: string | null;
  ip: string | null;
  createdAt: string;
}

export interface FeedbackItem {
  id: string;
  rating: "HELPFUL" | "NOT_HELPFUL";
  reason?: string | null;
  email: string;
  answerPreview: string;
  createdAt: string;
}

export interface FeedbackSummary {
  total: number;
  helpful: number;
  notHelpful: number;
  items: FeedbackItem[];
}

export interface IngestionJob {
  id: string;
  status: string;
  stage: string | null;
  progress: number;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
  document: { title: string; status: string; failureReason: string | null };
}

/* ------------------------------------------------------------------ *
 * Explainable RAG — mirrors of the explanation trace
 * ------------------------------------------------------------------ */

export type EvidenceStrength = "HIGH" | "MEDIUM" | "LOW";

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

export interface ExplanationGraphEvidence {
  relationshipId: string;
  type: string;
  source: { id: string; name: string; type: string };
  target: { id: string; name: string; type: string };
  confidence: number | null;
  documents: string[];
  authorized: boolean;
}

export interface ExplanationGraphPath {
  id: string;
  nodes: Array<{ id: string; name: string; type: string }>;
  edges: Array<{ id: string; sourceId: string; targetId: string; type: string }>;
  depth: number;
  relevance: number;
  sourceDocumentIds: string[];
  authorized: boolean;
}

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

export interface ExplanationKeywordEvidence {
  documentId: string;
  documentTitle: string;
  chunkId: string | null;
  score: number;
  rank: number;
  authorized: boolean;
}

export interface ExplanationStageMetric {
  stage: string;
  before: number;
  after: number;
  note?: string;
}

export interface ExplanationClaim {
  index: number;
  text: string;
  citationIndices: number[];
  graphRelationshipIds: string[];
  vectorChunkIds: string[];
}

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
  exclusionNote: string | null;
}

export interface ExplanationEvidenceStrength {
  level: EvidenceStrength;
  supportingSources: number;
  graphSupport: boolean;
  vectorSupport: boolean;
  keywordSupport: boolean;
  citationCoverage: number;
  contradictionsDetected: boolean;
  note: string;
}

export interface AnswerExplanation {
  traceId: string;
  query: string;
  timestamp: string;
  retrievalPlan: ExplanationQueryInterpretation;
  graphEvidence: ExplanationGraphEvidence[];
  graphPaths: ExplanationGraphPath[];
  vectorEvidence: ExplanationVectorEvidence[];
  keywordEvidence: ExplanationKeywordEvidence[];
  pipelineMetrics: ExplanationStageMetric[];
  rerankedOrder: string[];
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