import type { GraphQueryPlan, Principal, EntityType } from "@graphrag/shared";
import { graphQueryPlanSchema, ENTITY_TYPES, RELATIONSHIP_TYPES, GRAPH_QUERY_INTENTS, GRAPH_QUERY_MAX_DEPTH, GRAPH_QUERY_MAX_LIMIT } from "@graphrag/shared";
import { chatCompletion } from "../ai/llm.js";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { authorizedDocumentIds } from "../access/aclRepository.js";
import { searchAuthorizedEntities, traverseAuthorizedGraph, isEntityAuthorized } from "./retrieve.js";
import type { AuthorizedEntity, AuthorizedRelationship } from "./acl.js";

/**
 * Natural-language -> Graph Query capability.
 *
 * Security model (fail-closed):
 *  - The LLM only interprets the user's request into a structured GraphQueryPlan.
 *  - The plan is validated against the controlled ontology (entity/relationship
 *    types) with strict Zod — arbitrary/invented types and arbitrary Cypher are
 *    rejected outright.
 *  - The server (never the LLM) compiles the plan into a bounded Cypher query.
 *  - Every result node/edge is ACL + tenant verified at query time using the
 *    exact same predicates as the rest of the Graph Explorer. The AI can never
 *    decide permissions; the backend does.
 *
 * The LLM provider is the SAME one used by the rest of the application — no new
 * provider is introduced.
 */

export interface AiQueryResult {
  query: string;
  queryPlan: GraphQueryPlan;
  explanation: {
    summary: string;
    steps: string[];
  };
  nodes: AuthorizedEntity[];
  relationships: AuthorizedRelationship[];
  stats: { nodes: number; relationships: number };
  isEntitySearch: boolean;
  /**
   * Observable, non-sensitive metadata for the Explainable RAG layer — original
   * question, intent, depth, and candidate/authorized counts. It contains NO
   * chain-of-thought, hidden reasoning, or prompt content.
   */
  trace: {
    question: string;
    intent: GraphQueryPlan["intent"];
    path: NonNullable<GraphQueryPlan["path"]>;
    maxDepth: number;
    relationshipTypes: NonNullable<GraphQueryPlan["relationshipTypes"]>;
    candidateNodes: number;
    authorizedNodes: number;
    relationshipsReturned: number;
  };
}

/** Words that signal a natural-language graph question (vs. a bare entity name). */
const QUESTION_MARKERS = [
  "who", "what", "which", "where", "how", "does", "do", "show", "find", "list",
  "tell", "everyone", "every", "all", "related", "connected", "connect", "through",
  "between", "reports", "managed", "manages", "reporting", "chain", "belongs",
  "relationship", "relationships", "path", "work with", "works with", "employees",
  "associated", "affects", "depends", "mentions"
];

/**
 * Decide whether the input is (A) a plain entity search or (B) a natural-language
 * graph question. Deliberately simple: if it reads like a question/relationship
 * request, treat it as a graph query; otherwise treat short phrases as entity
 * search. When uncertain, defaults to a graph query.
 */
export function detectGraphQuery(question: string): boolean {
  const q = question.trim();
  if (!q) return false;
  const lower = ` ${q.toLowerCase()} `;

  // Whole-phrase quoted entity references are unambiguous entity lookups.
  if (/^["“”'`][^"“”'`]{2,80}["“”'`]$/.test(q)) return false;

  // Ends with a terminal question mark.
  if (/[?？]$/.test(q)) return true;

  // A question/relationship marker strongly signals a natural-language request.
  const isQuestion = QUESTION_MARKERS.some(
    (m) => lower.includes(` ${m} `) || lower.startsWith(` ${m} `) || lower.endsWith(` ${m} `)
  );
  if (isQuestion) return true;

  // Bare proper-noun phrases (entity names / titles) with no relation verbs are
  // treated as entity search. When genuinely uncertain we err toward entity
  // search so a multi-word name like "Remote Work Policy" still resolves.
  return false;
}

/**
 * Generate a structured graph query plan from a natural-language question using
 * the application's existing LLM provider. The prompt requests STRICT JSON that
 * conforms to the graphQueryPlanSchema; the model is told NOT to produce Cypher.
 * Returns null if the model output cannot be parsed/validated.
 */
export async function generateGraphQueryPlan(question: string): Promise<GraphQueryPlan | null> {
  const schemaBrief = buildSchemaBrief();
  const prompt =
    `You translate a natural-language question about a company knowledge graph into a ` +
    `structured graph query PLAN (NOT Cypher, NOT code). The graph stores entities and the ` +
    `relationships between them. A "path" is the ordered sequence of entity types the answer ` +
    `should start from and travel through to reach the target entities.\n\n` +
    schemaBrief +
    `\n\nRules:\n` +
    `- intent must be one of: find_entities, find_paths, find_relationships, neighborhood, count, unknown\n` +
    `- Use ONLY the entity and relationship types listed above. Never invent types.\n` +
    `- targetEntityTypes: the types of the entities the user wants to SEE / COUNT.\n` +
    `- startEntityTypes/startEntityNames: the concrete entities or types the query should start from (the anchor).\n` +
    `- path: the ordered chain of entity types from the anchor to the targets (e.g. [Policy] -> [Department] -> [Employee]).\n` +
    `- maxDepth: a small integer (1-${GRAPH_QUERY_MAX_DEPTH}). Use the minimum needed for the path.\n` +
    `- limit: a result cap (1-${GRAPH_QUERY_MAX_LIMIT}), default 50.\n` +
    `- explanation: a short human-readable summary like "Finding employees connected to security policies".\n` +
    `- If the question is too broad (e.g. "show me everything") set intent to "unknown".\n\n` +
    `Respond with ONLY a single JSON object, no markdown, no commentary.`;
  const system =
    "You are a strict graph query planner. You output JSON describing an intent and an entity-type path. " +
    "You never output Cypher, never bypass access controls, and never invent entity or relationship types.";

  try {
    const res = await chatCompletion(
      [
        { role: "system", content: system },
        { role: "user", content: `${prompt}\n\nQuestion: ${question}` }
      ],
      { temperature: 0, maxTokens: 700 }
    );
    const parsed = parsePlanJson(res.content);
    if (!parsed) return null;
    const normalized = normalizePlan(parsed);
    const validated = graphQueryPlanSchema.safeParse(normalized);
    if (!validated.success) {
      logger.warn("graph ai-query plan rejected by schema", { err: validated.error.flatten() });
      return null;
    }
    const plan = validated.data as GraphQueryPlan;
    // "unknown" means the question was too broad / not translatable; fail the
    // request rather than executing an unrestricted query.
    if (plan.intent === "unknown") return null;
    return plan;
  } catch (err) {
    // The LLM provider itself failed (network, exceeded plan credits, etc.).
    // Surface this honestly instead of the misleading "couldn't translate".
    logger.warn("graph ai-query LLM failure", { err: err instanceof Error ? err.message : String(err) });
    throw new GraphQueryError(
      "Your AI provider could not be reached (check your API key or plan credits), or no provider is configured. Open Manage API provider to set one up.",
      "AI_UNAVAILABLE"
    );
  }
}

/** Extract the JSON object from the LLM response, tolerating fences/spaces. */
export function parsePlanJson(content: string): unknown {
  if (!content) return null;
  let text = content.trim();
  // Strip markdown code fences if present.
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  const json = text.slice(start, end + 1);
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/** Fuzzy intent aliases the LLM may emit, mapped to the controlled enum. */
const INTENT_ALIASES: Record<string, GraphQueryPlan["intent"]> = {
  retrieve: "find_entities",
  fetch: "find_entities",
  get: "find_entities",
  search: "find_entities",
  find: "find_entities",
  list: "find_entities",
  entities: "find_entities",
  path: "find_paths",
  paths: "find_paths",
  relationship: "find_relationships",
  relationships: "find_relationships",
  neighborhood: "neighborhood",
  connected: "find_paths",
  count: "count",
  total: "count",
  how_many: "count"
};

/**
 * Coerce an LLM-declared entity type (may be plural, compound, or spaced like
 * "SecurityPolicy" / "security policies") to a controlled ontology type, or
 * undefined if it cannot be resolved. This lets a valid question survive LLM
 * naming variance while STILL rejecting genuinely invented types (no plan is
 * fabricated — resolution is one-to-one or not at all).
 */
export function normalizeEntityType(raw: string): EntityType | undefined {
  const input = String(raw ?? "").trim().toLowerCase();
  if (!input) return undefined;
  const compact = input.replace(/[^a-z]/g, "");
  const singular = compact.replace(/ies$/, "y").replace(/s$/, "");
  for (const t of ENTITY_TYPES) {
    const key = t.toLowerCase();
    if (compact === key || compact === key + "s" || singular === key || key.startsWith(compact) || compact.startsWith(key)) return t;
    // e.g. "securitypolicy" contains "policy"; accept when the type is a
    // clear substring that isn't a meaningless fragment.
    if (compact.length >= 4 && compact.includes(key) && key.length >= 4) return t;
  }
  return undefined;
}

function normalizeIntent(raw: unknown): GraphQueryPlan["intent"] {
  const v = String(raw ?? "").trim().toLowerCase();
  // Exact valid intent passes straight through.
  if ((GRAPH_QUERY_INTENTS as readonly string[]).includes(v)) return v as GraphQueryPlan["intent"];
  if (INTENT_ALIASES[v]) return INTENT_ALIASES[v];
  return "unknown";
}

/**
 * Coerce raw LLM output toward the strict schema. The output is TREATED AS
 * UNTRUSTED: unknown entity/relationship types and unknown intents are dropped
 * (mapping to "unknown"), path entries are normalized to {entityType}, and
 * bounds are re-validated by the strict Zod schema afterward. Normalization
 * never invents graph content — it only maps aliases one-to-one.
 */
export function normalizePlan(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null) return null;
  const src = raw as Record<string, unknown>;

  const targetEntityTypes = (Array.isArray(src.targetEntityTypes) ? src.targetEntityTypes : [])
    .map((t) => normalizeEntityType(String(t)))
    .filter((t): t is EntityType => !!t);

  const startEntityTypes = (Array.isArray(src.startEntityTypes) ? src.startEntityTypes : [])
    .map((t) => normalizeEntityType(String(t)))
    .filter((t): t is EntityType => !!t);

  const relationshipTypes = (Array.isArray(src.relationshipTypes) ? src.relationshipTypes : [])
    .filter((r): r is string => typeof r === "string" && (RELATIONSHIP_TYPES as readonly string[]).includes(r));

  // startEntityNames may be an array of names OR an object mapping type -> name(s).
  const startEntityNames = (() => {
    if (Array.isArray(src.startEntityNames)) {
      const names = src.startEntityNames.filter((n): n is string => typeof n === "string" && n.trim().length > 0);
      return names.length > 0 ? names.slice(0, 10) : undefined;
    }
    if (typeof src.startEntityNames === "object" && src.startEntityNames !== null) {
      const names = Object.values(src.startEntityNames as Record<string, unknown>)
        .flatMap((v) => (Array.isArray(v) ? v : [v]))
        .filter((n): n is string => typeof n === "string" && n.trim().length > 0);
      return names.length > 0 ? names.slice(0, 10) : undefined;
    }
    return undefined;
  })();

  // Coerce path entries of three possible shapes:
  //  - { entityType, relationshipType }
  //  - plain entity-type string "Policy"
  //  - { type: "Policy" }
  const path = Array.isArray(src.path)
    ? src.path
        .map((step) => {
          const asObj = typeof step === "object" && step !== null ? (step as Record<string, unknown>) : undefined;
          const rawType =
            (asObj?.entityType !== undefined ? asObj.entityType : asObj?.type) ?? (typeof step === "string" ? step : undefined);
          const entityType = normalizeEntityType(String(rawType ?? ""));
          if (!entityType) return { entityType: undefined, relationshipType: undefined as string | undefined };
          const relationshipType =
            asObj?.relationshipType !== undefined && typeof asObj.relationshipType === "string" &&
            (RELATIONSHIP_TYPES as readonly string[]).includes(asObj.relationshipType)
              ? asObj.relationshipType
              : undefined;
          return { entityType, relationshipType } as { entityType?: EntityType; relationshipType?: string };
        })
        .filter((s) => s.entityType || s.relationshipType)
    : undefined;

  return {
    intent: normalizeIntent(src.intent),
    targetEntityTypes,
    ...(startEntityTypes.length > 0 ? { startEntityTypes } : {}),
    ...(startEntityNames ? { startEntityNames } : {}),
    ...(relationshipTypes.length > 0 ? { relationshipTypes } : {}),
    ...(path && path.length > 0 ? { path } : {}),
    maxDepth: typeof src.maxDepth === "number" ? src.maxDepth : undefined,
    limit: typeof src.limit === "number" ? src.limit : undefined,
    explanation: typeof src.explanation === "string" ? src.explanation : undefined
  };
}

/**
 * Execute a validated GraphQueryPlan against the authorized tenant subgraph.
 * Reuses the existing authorized retrieval: resolves anchor entities with
 * searchAuthorizedEntities, then traverses with traverseAuthorizedGraph (bounded
 * depth). Re-verifies every returned node/edge in JS (defense in depth).
 */
export async function executeGraphQueryPlan(input: {
  principal: Principal;
  plan: GraphQueryPlan;
}): Promise<AiQueryResult> {
  const { principal, plan } = input;
  const tenantId = principal.companyId;
  const authDocs = Array.from(await authorizedDocumentIds(principal));

  const depth = plan.maxDepth ?? Math.min(config.MAX_GRAPH_DEPTH, GRAPH_QUERY_MAX_DEPTH);
  const limit = Math.min(plan.limit ?? 50, GRAPH_QUERY_MAX_LIMIT);

  const traceBase = {
    question: plan.explanation ?? "graph query",
    intent: plan.intent,
    path: (plan.path ?? []) as NonNullable<GraphQueryPlan["path"]>,
    maxDepth: depth,
    relationshipTypes: (plan.relationshipTypes ?? []) as NonNullable<GraphQueryPlan["relationshipTypes"]>,
    candidateNodes: 0,
    authorizedNodes: 0,
    relationshipsReturned: 0
  };

  if (!tenantId || authDocs.length === 0) {
    return {
      query: traceBase.question,
      queryPlan: plan,
      explanation: { summary: plan.explanation ?? "Finding authorized graph data", steps: [] },
      nodes: [],
      relationships: [],
      stats: { nodes: 0, relationships: 0 },
      isEntitySearch: false,
      trace: traceBase
    };
  }

  // --- Resolve anchor entities (authorized lookup only) ---
  const startNames = await resolveStartNames(principal, tenantId, authDocs, plan);

  if (startNames.length === 0) {
    // No authorized anchor matched. If the plan referenced explicit names, this
    // is a friendly "no matching entity" case; otherwise the graph is too broad.
    throw new GraphQueryError(
      plan.startEntityNames?.length
        ? `No authorized entity matched '${plan.startEntityNames.join(", ")}'.`
        : "This graph question is too broad. Try specifying an entity, policy, department, employee, or relationship.",
      "NO_MATCH"
    );
  }

  const allowedRelationships = plan.relationshipTypes?.length ? [...plan.relationshipTypes] : undefined;

  // --- One bounded authorized traversal (single pass, no redundant queries) ---
  const result = await traverseAuthorizedGraph({
    principal,
    tenantId,
    authDocs,
    startNames,
    maxDepth: depth,
    limit,
    allowedRelationships
  });

  // --- Re-verify JS-side (defense in depth); drop any unauthorized node/edge ---
  const nodes = result.nodes.filter((n) => isEntityAuthorized(n, authDocs));
  const rels = result.relationships.filter(
    (r) => isEntityAuthorized(r.source, authDocs) && isEntityAuthorized(r.target, authDocs)
  );

  const steps = buildSteps(plan);

  return {
    query: plan.explanation ?? (plan.path ? plan.path.map((s) => s.entityType ?? "any").join(" → ") : "related"),
    queryPlan: plan,
    explanation: {
      summary: plan.explanation ?? buildSteps(plan).join(" → "),
      steps
    },
    nodes,
    relationships: rels,
    stats: { nodes: nodes.length, relationships: rels.length },
    isEntitySearch: false,
    trace: {
      ...traceBase,
      candidateNodes: result.nodes.length,
      authorizedNodes: nodes.length,
      relationshipsReturned: rels.length
    }
  };
}

/** Resolve start/anchor entities, preferring explicit names then types. */
async function resolveStartNames(
  principal: Principal,
  tenantId: string,
  authDocs: string[],
  plan: GraphQueryPlan
): Promise<string[]> {
  const explicit: string[] = [];
  if (plan.startEntityNames?.length) {
    for (const name of plan.startEntityNames) {
      const matches = await searchAuthorizedEntities({ principal, tenantId, authDocs, query: name, limit: 5 });
      explicit.push(...matches.map((m) => m.name));
    }
  }
  if (explicit.length > 0) return Array.from(new Set(explicit));

  // Anchor by type: pick the most-connected authorized entity of that type.
  const types = plan.startEntityTypes?.length ? plan.startEntityTypes : inferAnchorTypes(plan);
  const names: string[] = [];
  for (const type of types) {
    const rows = await searchAuthorizedEntities({ principal, tenantId, authDocs, query: "", types: [type], limit: 5 });
    names.push(...rows.map((r) => r.name));
  }
  return Array.from(new Set(names));
}

/** If the plan gives no anchors, use the first populated entity type in the path. */
function inferAnchorTypes(plan: GraphQueryPlan): EntityType[] {
  const first = plan.path?.find((s) => s.entityType);
  return first?.entityType ? [first.entityType] : [];
}

function buildSteps(plan: GraphQueryPlan): string[] {
  const out: string[] = [];
  for (const step of plan.path ?? []) {
    out.push(step.entityType ?? "any");
  }
  if (out.length === 0 && plan.targetEntityTypes.length > 0) {
    out.push(...plan.targetEntityTypes);
  }
  if (out.length === 0) out.push("related entities");
  return out;
}

/** Compact schema description sent to the LLM (no secrets, no full DB). */
function buildSchemaBrief(): string {
  const entityTypes = ENTITY_TYPES.join(", ");
  const relTypes = RELATIONSHIP_TYPES.join(", ");
  return (
    `Available entity types: ${entityTypes}\n` +
    `Available relationship types: ${relTypes}\n`
  );
}

/** Domain error used to map to friendly HTTP responses without leaking internals. */
export class GraphQueryError extends Error {
  constructor(
    message: string,
    public readonly code: "NO_MATCH" | "TOO_BROAD" | "UNSUPPORTED" | "TOO_MANY" | "AI_UNAVAILABLE"
  ) {
    super(message);
    this.name = "GraphQueryError";
  }
}

export type { EntityType };