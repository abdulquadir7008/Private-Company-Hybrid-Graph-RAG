import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { asyncHandler } from "../util/asyncHandler.js";
import { requireAuth, requireCompanyPrincipal } from "../access/middleware.js";
import { authorizedDocumentIds } from "../access/aclRepository.js";
import { searchAuthorizedEntities, neighborhood, traverseAuthorizedGraph } from "../graph/retrieve.js";
import { graphStats } from "../graph/repository.js";
import { runQuery } from "../graph/driver.js";
import { authPredicate } from "../graph/acl.js";
import { Auditor } from "../audit/service.js";
import { buildPlan, detectEntities } from "../retrieval/queryPlanner.js";
import type { ExplanationGraphPath, GraphQueryPlan } from "@graphrag/shared";
import { NotFoundError } from "../errors.js";
import { detectGraphQuery, generateGraphQueryPlan, executeGraphQueryPlan, GraphQueryError } from "../graph/aiQuery.js";
import type { AiQueryResult } from "../graph/aiQuery.js";
import { withLlmUser } from "../ai/llm.js";

export const graphRoutes = Router();

const searchSchema = z.object({
  query: z.string().max(200).optional().default(""),
  types: z.array(z.string()).max(10).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional()
});

graphRoutes.get(
  "/stats",
  requireAuth,
  asyncHandler(async (req, res) => {
    const p = requireCompanyPrincipal(req);
    try {
      const stats = await graphStats(p.companyId, Array.from(await authorizedDocumentIds(p)));
      res.json(stats);
    } catch {
      res.json({ entities: 0, relationships: 0, chunks: 0, documents: 0, unavailable: true });
    }
  })
);

graphRoutes.get(
  "/entities",
  requireAuth,
  asyncHandler(async (req, res) => {
    const p = requireCompanyPrincipal(req);
    const parsed = searchSchema.safeParse({ query: req.query.query ?? "", types: req.query.types ? String(req.query.types).split(",") : undefined });
    const entities = await searchAuthorizedEntities({
      principal: p,
      tenantId: p.companyId,
      authDocs: Array.from(await authorizedDocumentIds(p)),
      query: parsed.success ? parsed.data.query : "",
      types: parsed.success ? parsed.data.types : undefined,
      limit: parsed.success ? parsed.data.limit ?? 30 : 30
    });
    res.json({ items: entities, total: entities.length });
  })
);

const entityDetailSchema = z.object({ depth: z.coerce.number().int().min(1).max(3).optional() });

graphRoutes.get(
  "/entities/:name",
  requireAuth,
  asyncHandler(async (req, res) => {
    const p = requireCompanyPrincipal(req);
    const depth = entityDetailSchema.safeParse(req.query).success ? entityDetailSchema.parse(req.query).depth ?? 1 : 1;
    const authDocs = Array.from(await authorizedDocumentIds(p));

    const matches = await searchAuthorizedEntities({
      principal: p,
      tenantId: p.companyId,
      authDocs,
      query: req.params.name,
      limit: 1
    });
    if (matches.length === 0) return res.status(404).json({ error: "Entity not found or not authorized" });

    const entity = matches[0];
    const ctx = await neighborhood({ tenantId: p.companyId, authDocs, entityName: entity.name, depth, limit: 60 });

    // Provenance: only authorized source documents/chunks are returned.
    const sourceDocs = await prisma.document.findMany({
      where: { id: { in: entity.sourceDocuments }, companyId: p.companyId },
      select: { id: true, title: true, category: true, sensitivity: true, status: true }
    });
    const sourceChunks = await prisma.documentChunk.findMany({
      where: { id: { in: entity.sourceChunks }, companyId: p.companyId },
      select: { id: true, documentId: true, section: true, pageStart: true, index: true }
    });

    res.json({
      entity,
      relatedEntities: ctx.nodes.filter((n) => n.id !== entity.id),
      relationships: ctx.relationships,
      sourceDocuments: sourceDocs,
      sourceChunks: sourceChunks.slice(0, 25),
      permissions: {
        visibleToYou: true,
        sourceCount: entity.sourceDocuments.length
      }
    });
  })
);

const traverseSchema = z.object({
  start: z.array(z.string().min(1).max(120)).min(1).max(10),
  depth: z.coerce.number().int().min(1).max(5).optional(),
  tryValidation: z.boolean().optional()
});

const relTypeList = z.array(z.enum(["WORKS_FOR", "BELONGS_TO", "HAS_ROLE", "MANAGES", "OWNS", "APPLIES_TO", "RELATED_TO", "DEPENDS_ON", "AFFECTS", "MENTIONS", "DEFINED_IN", "DESCRIBED_BY", "PART_OF", "REQUIRES", "USED_BY", "CREATED_BY", "UPDATED_BY"]));

graphRoutes.post(
  "/search",
  requireAuth,
  asyncHandler(async (req, res) => {
    const p = requireCompanyPrincipal(req);
    const parsed = searchSchema.extend({ query: z.string().max(200).default("") }).safeParse(req.body);
    const query = parsed.success ? parsed.data.query : "";
    const entities = await searchAuthorizedEntities({
      principal: p,
      tenantId: p.companyId,
      authDocs: Array.from(await authorizedDocumentIds(p)),
      query,
      limit: parsed.success ? parsed.data.limit ?? 30 : 30
    });
    res.json({ items: entities });
  })
);

graphRoutes.post(
  "/traverse",
  requireAuth,
  asyncHandler(async (req, res) => {
    const p = requireCompanyPrincipal(req);
    const parsed = traverseSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid traverse request" });

    const authDocs = Array.from(await authorizedDocumentIds(p));
    const depth = parsed.data.depth ?? 3;
    const result = await traverseAuthorizedGraph({
      principal: p,
      tenantId: p.companyId,
      authDocs,
      startNames: parsed.data.start,
      maxDepth: depth,
      limit: 60
    });
    await new Auditor().record({
      companyId: p.companyId,
      userId: p.userId,
      action: "GRAPH_TRAVERSE",
      detail: { start: parsed.data.start, depth, nodesReturned: result.nodes.length },
      requestId: req.requestId
    });
    res.json(result);
  })
);

/** Authorized relationship as exposed to the Graph Explorer (full-graph mode). */
export interface GraphRelationshipView {
  rid: string;
  type: string;
  source: { id: string; name: string; type: string };
  target: { id: string; name: string; type: string };
  confidence: number | null;
  sources: string[];
}

interface RelationshipRow {
  rid: string | null;
  type: string | null;
  source: Record<string, unknown>;
  target: Record<string, unknown>;
  confidence: number | null;
  sources: unknown;
}

function nodeView(props: Record<string, unknown>): { id: string; name: string; type: string } {
  return {
    id: props.id != null ? String(props.id) : "",
    name: props.name != null ? String(props.name) : "",
    type: props.type != null ? String(props.type) : ""
  };
}

export function toGraphRelationshipView(row: RelationshipRow): GraphRelationshipView {
  return {
    rid: String(row.rid ?? ""),
    type: String(row.type ?? ""),
    source: nodeView(row.source ?? {}),
    target: nodeView(row.target ?? {}),
    confidence: row.confidence != null ? Number(row.confidence) : null,
    sources: Array.isArray(row.sources) ? row.sources.map(String) : []
  };
}

graphRoutes.get(
  "/relationships",
  requireAuth,
  asyncHandler(async (req, res) => {
    const p = requireCompanyPrincipal(req);
    const authDocs = Array.from(await authorizedDocumentIds(p));
    const rows = await runQuery<RelationshipRow>(
      `MATCH (s:Entity {tenantId: $tenantId})-[r]->(t:Entity {tenantId: $tenantId})
       WHERE s.sourceDocuments IS NOT NULL AND all(d IN s.sourceDocuments WHERE d IN $authDocs)
         AND t.sourceDocuments IS NOT NULL AND all(d IN t.sourceDocuments WHERE d IN $authDocs)
       RETURN r.rid AS rid, type(r) AS type, properties(s) AS source, properties(t) AS target,
              r.confidence AS confidence, r.sources AS sources
       LIMIT 200`,
      { tenantId: p.companyId, authDocs }
    );
    const items: GraphRelationshipView[] = rows.map(toGraphRelationshipView);
    res.json({ items });
  })
);

/**
 * GET /graph/explanation-path
 *
 * Returns ONE ACL-authorized graph path from a stored explanation trace so the
 * Graph Explorer can render + highlight the exact route used to generate an
 * answer. Security:
 *  - Authenticated + tenant + conversation-owner scoped.
 *  - The path is read from the persisted, already-ACL-filtered trace.
 *  - Every node's source documents are RE-verified against the caller's current
 *    authorized document set at read time (access may have changed since the
 *    answer was generated). A path that is not fully authorized is NOT returned.
 *  - Never trusts client-provided node/edge lists as proof of authorization.
 */
const explanationPathQuery = z.object({
  message: z.string().min(1),
  path: z.string().min(1)
});

graphRoutes.get(
  "/explanation-path",
  requireAuth,
  asyncHandler(async (req, res) => {
    const p = requireCompanyPrincipal(req);
    const parsed = explanationPathQuery.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: "message and path are required" });

    const { message: messageId, path: pathId } = parsed.data;
    const message = await prisma.message.findFirst({
      where: {
        id: messageId,
        companyId: p.companyId,
        role: "assistant",
        conversation: { userId: p.userId }
      },
      select: { explanation: true }
    });
    if (!message || !message.explanation) throw new NotFoundError("Explanation not found");

    const trace = message.explanation as { graphPaths?: ExplanationGraphPath[] } | null | undefined;
    const path = findExplanationPath(trace, pathId);
    if (!path) throw new NotFoundError("Path not found in explanation trace");

    const authDocs = await authorizedDocumentIds(p);

    // Re-authorize every node in the path against the caller's current access.
    // A node is authorized only if it exists in the caller's tenant and every
    // source document it references is still in the caller's authorized set.
    // A path missing a single authorized node is dropped entirely — never
    // partially revealed.
    const authSets = await graphPathNodeAuthorization({
      tenantId: p.companyId,
      authDocs,
      pathNodes: path.nodes
    });
    const allAuthorized = path.nodes.length > 0 && path.nodes.every((n) => authSets.get(nodeKey(n)) === true);
    if (!allAuthorized) {
      res.status(403).json({ error: "Graph path is not authorized for the current user", code: "PATH_UNAUTHORIZED" });
      return;
    }

    const nodeIdSet = new Set(path.nodes.map((n) => nodeKey(n)));
    const nodes = path.nodes.filter((n) => nodeIdSet.has(nodeKey(n)));
    const edges = path.edges.filter((e) => nodeIdSet.has(e.sourceId) && nodeIdSet.has(e.targetId));

    await new Auditor().record({
      companyId: p.companyId,
      userId: p.userId,
      action: "GRAPH_PATH_VIEW",
      detail: { messageId, pathId, nodes: nodes.length, edges: edges.length },
      requestId: req.requestId
    });

    res.json({ path: { id: path.id, nodes, edges, depth: path.depth, relevance: path.relevance, authorized: true } });
  })
);

/** Retrieve-and-debug endpoint used by the admin dashboard. */
graphRoutes.post(
  "/query/plan",
  requireAuth,
  asyncHandler(async (req, res) => {
    const p = requireCompanyPrincipal(req);
    const parsed = z.object({ question: z.string().min(1).max(2000) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Question required" });
    const detection = await detectEntities(p, parsed.data.question);
    const plan = buildPlan(parsed.data.question, detection);
    res.json({ plan, detection });
  })
);

/**
 * POST /graph/ai-query — Natural-language -> Graph Query.
 *
 * Distinguishes a plain entity search from a natural-language graph question.
 * For graph questions: generates a structured GraphQueryPlan with the LLM,
 * validates it strictly (ontology + bounds), then executes a single bounded,
 * tenant- and ACL-constrained traversal. The LLM NEVER decides permissions and
 * NEVER emits Cypher; the server compiles the validated plan into Cypher.
 *
 * Returns the authorized result as canonical GraphRelationshipView[], plus the
 * human-readable plan/explanation for the AI-native graph UI. Any unauthorized
 * or cross-tenant data is dropped before returning — never fabricated.
 */
graphRoutes.post(
  "/ai-query",
  requireAuth,
  asyncHandler(async (req, res) => {
    const p = requireCompanyPrincipal(req);
    const parsed = z.object({ query: z.string().min(1).max(2000).trim() }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Question required" });

    const question = parsed.data.query;

    // Branch A: plain entity search (existing behavior, existing endpoint).
    if (!detectGraphQuery(question)) {
      const authDocs = Array.from(await authorizedDocumentIds(p));
      const items = await searchAuthorizedEntities({ principal: p, tenantId: p.companyId, authDocs, query: question, limit: 20 });
      return res.json({
        query: question,
        queryPlan: null,
        explanation: { summary: `Searching for '${question}'`, steps: ["Authorized entity search"] },
        isEntitySearch: true,
        items: items.map((i) => ({ id: i.id, name: i.name, type: i.type, description: i.description ?? null, confidence: i.confidence ?? null })),
        relationships: [],
        stats: { nodes: items.length, relationships: 0 }
      });
    }

    // Branch B: natural-language graph question.
    let plan: GraphQueryPlan | null;
    try {
      plan = await withLlmUser(p.userId, () => generateGraphQueryPlan(question));
    } catch (err) {
      if (err instanceof GraphQueryError && err.code === "AI_UNAVAILABLE") {
        return res.status(503).json({ error: err.message, code: "AI_UNAVAILABLE" });
      }
      throw err;
    }
    if (!plan || plan.intent === "unknown") {
      return res.status(422).json({ error: "I couldn't translate that into a supported graph query.", code: "UNSUPPORTED" });
    }

    let result: AiQueryResult;
    try {
      result = await executeGraphQueryPlan({ principal: p, plan });
    } catch (err) {
      if (err instanceof GraphQueryError) {
        const status = err.code === "NO_MATCH" ? 404 : 422;
        return res.status(status).json({ error: err.message, code: err.code });
      }
      throw err;
    }

    // Cap the graph shown (spec: bounded result counts); broad results are
    // surfaced as a friendly "too broad" rather than an unbounded dump.
    const relationships = result.relationships;
    const nodes = result.nodes;
    if (relationships.length + nodes.length > 120) {
      return res.status(422).json({
        error: "The query returned too many results. Try narrowing your question.",
        code: "TOO_MANY"
      });
    }

    await new Auditor().record({
      companyId: p.companyId,
      userId: p.userId,
      action: "GRAPH_AI_QUERY",
      detail: {
        query: question,
        intent: plan.intent,
        targetTypes: plan.targetEntityTypes,
        depth: plan.maxDepth ?? 3,
        nodesReturned: nodes.length,
        relationshipsReturned: relationships.length
      },
      requestId: req.requestId
    });

    // Build canonical relationship views for the existing GraphCanvas, keyed off
    // authorized relationships; orphan authorized nodes are added as isolated
    // nodes so the frontend normalizeGraph has complete endpoints.
    const views = relationships.map((r) =>
      toGraphRelationshipView({
        rid: r.rid,
        type: r.type,
        source: { id: r.source.id, name: r.source.name, type: r.source.type },
        target: { id: r.target.id, name: r.target.name, type: r.target.type },
        confidence: r.confidence != null ? Number(r.confidence) : null,
        sources: r.sources
      })
    );

    const referenced = new Set<string>([...relationships.flatMap((r) => [r.source.id, r.target.id])]);
    const isolated = nodes.filter((n) => !referenced.has(n.id));

    res.json({
      query: question,
      queryPlan: plan,
      explanation: { summary: result.explanation.summary, steps: result.explanation.steps },
      isEntitySearch: false,
      relationships: views,
      isolatedNodes: isolated.map((n) => ({ id: n.id, name: n.name, type: n.type, description: n.description ?? null, confidence: n.confidence ?? null })),
      stats: { nodes: nodes.length, relationships: relationships.length },
      trace: result.trace
    });
  })
);

/** Canonical node key used on both API and client (id, falling back to name). */
function nodeKey(n: { id: string; name: string }): string {
  return n.id.trim() || n.name.trim();
}

/**
 * Re-verifies (fail-closed) that every node in an explanation path is still
 * authorized for the caller. Queries the caller's tenant subgraph with the same
 * ACL predicate used across retrieval; a node is authorized only when it exists
 * and all of its source documents are in the caller's current authorized set.
 * Returns a Map<key, boolean> for every requested node.
 */
async function graphPathNodeAuthorization(opts: {
  tenantId: string;
  authDocs: Set<string>;
  pathNodes: Array<{ id: string; name: string }>;
}): Promise<Map<string, boolean>> {
  const result = new Map<string, boolean>();
  const authList = Array.from(opts.authDocs);
  for (const n of opts.pathNodes) {
    const key = nodeKey(n);
    const rows = await runQuery<{ e: Record<string, unknown> }>(
      `MATCH (e:Entity {tenantId: $tenantId, id: $id})
       WHERE ${authPredicate("e")}
       RETURN properties(e) AS e LIMIT 1`,
      { tenantId: opts.tenantId, id: key, authDocs: authList }
    );
    const entity = rows[0]?.e as Record<string, unknown> | undefined;
    if (!entity) {
      result.set(key, false);
      continue;
    }
    const srcDocs = Array.isArray(entity.sourceDocuments) ? entity.sourceDocuments.map(String) : [];
    result.set(key, nodeIsAuthorized(srcDocs, opts.authDocs));
  }
  return result;
}

/**
 * Fail-closed node-authorization decision for an explained graph path.
 *
 * A node is authorized ONLY when it exists AND references at least one source
 * document that is ALL still in the caller's current authorized set. This rule
 * is re-checked at read time against the caller's *current* access, never trust
 * client-supplied proof — so access revoked since the answer was generated
 * correctly fails the path closed.
 */
export function nodeIsAuthorized(nodeSourceDocuments: string[], authorizedDocumentIds: Set<string>): boolean {
  return nodeSourceDocuments.length > 0 && nodeSourceDocuments.every((d) => authorizedDocumentIds.has(d));
}

/** End the module with the router export after helper definitions. */
export function findExplanationPath(
  trace: { graphPaths?: ExplanationGraphPath[] } | null | undefined,
  pathId: string
): ExplanationGraphPath | null {
  return (trace?.graphPaths ?? []).find((pth) => pth.id === pathId) ?? null;
}