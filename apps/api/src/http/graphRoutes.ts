import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { asyncHandler } from "../util/asyncHandler.js";
import { requireAuth, requireCompanyPrincipal } from "../access/middleware.js";
import { authorizedDocumentIds } from "../access/aclRepository.js";
import { searchAuthorizedEntities, neighborhood, traverseAuthorizedGraph } from "../graph/retrieve.js";
import { graphStats } from "../graph/repository.js";
import { runQuery } from "../graph/driver.js";
import { Auditor } from "../audit/service.js";
import { buildPlan, detectEntities } from "../retrieval/queryPlanner.js";

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

graphRoutes.get(
  "/relationships",
  requireAuth,
  asyncHandler(async (req, res) => {
    const p = requireCompanyPrincipal(req);
    const authDocs = Array.from(await authorizedDocumentIds(p));
    const link = typeof req.query.link === "string" ? (req.query.link as never) : undefined;
    void link;
    const result: unknown = await runQuery(
      `MATCH (s:Entity {tenantId: $tenantId})-[r]->(t:Entity {tenantId: $tenantId})
       WHERE s.sourceDocuments IS NOT NULL AND all(d IN s.sourceDocuments WHERE d IN $authDocs)
         AND t.sourceDocuments IS NOT NULL AND all(d IN t.sourceDocuments WHERE d IN $authDocs)
       RETURN r.rid AS rid, type(r) AS type, s.name AS sourceName, s.type AS sourceType,
              t.name AS targetName, t.type AS targetType, r.confidence AS confidence, r.sources AS sources
       LIMIT 200`,
      { tenantId: p.companyId, authDocs }
    );
    res.json({ items: result });
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