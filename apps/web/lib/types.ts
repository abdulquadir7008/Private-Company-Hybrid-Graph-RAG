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
  retrievalMeta: { plan: QueryPlan; stats: Record<string, unknown> };
}

export interface ChatMessage {
  id: string;
  role: string;
  content: string;
  citations?: Citation[] | null;
  graphEvidence?: { relationships?: GraphRelationship[]; paths?: GraphPath[] } | null;
  retrievalMeta?: Record<string, unknown> | null;
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