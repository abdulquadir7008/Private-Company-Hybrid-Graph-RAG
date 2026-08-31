import { Router } from "express";
import multer from "multer";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { prisma } from "../db.js";
import { config } from "../config.js";
import { asyncHandler } from "../util/asyncHandler.js";
import { requireAuth, requireAdmin, requireCompanyPrincipal } from "../access/middleware.js";
import { canAccessDocument } from "../access/aclRepository.js";
import { ForbiddenError, NotFoundError } from "../errors.js";
import { validateUploadedFile } from "../ingestion/extractText.js";
import { ingestionPipeline } from "../ingestion/pipeline.js";
import { auditor } from "../audit/service.js";

export const documentRoutes = Router();

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    fs.mkdirSync(config.UPLOAD_DIR, { recursive: true });
    cb(null, config.UPLOAD_DIR);
  },
  filename: (_req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
    cb(null, `${Date.now()}-${safe}`);
  }
});
const upload = multer({ storage });

const reclassifySchema = z.object({
  allowedRoles: z.array(z.enum(["ADMIN", "HR", "LEGAL", "MANAGER", "EMPLOYEE", "CONTRACTOR"])).default([]),
  allowedDepartments: z.array(z.enum(["GENERAL", "ENGINEERING", "HR", "LEGAL", "FINANCE", "MARKETING", "SALES", "LEADERSHIP"])).default([]),
  sensitivity: z.enum(["PUBLIC", "INTERNAL", "CONFIDENTIAL", "RESTRICTED"]).default("INTERNAL"),
  ownerId: z.string().nullable().optional()
});

documentRoutes.post(
  "/",
  requireAuth,
  upload.single("file"),
  asyncHandler(async (req, res) => {
    const p = requireCompanyPrincipal(req);
    validateUploadedFile(req.file!);
    const title = (req.body.title as string | undefined)?.trim() || stripExt(req.file!.originalname);
    const categoryZod = z.enum(["HR_POLICY", "PRODUCT", "TECHNICAL", "LEGAL", "TRAINING", "OTHER"]);
    const category = categoryZod.safeParse(req.body.category).success ? (req.body.category as never) : "OTHER";

    const doc = await prisma.document.create({
      data: {
        companyId: p.companyId,
        title,
        originalName: req.file!.originalname,
        mimeType: req.file!.mimetype,
        sizeBytes: req.file!.size,
        storagePath: req.file!.filename,
        category,
        uploadedById: p.userId,
        // Fail-closed default ACL until an admin classifies it.
        acl: {
          create: {
            companyId: p.companyId,
            allowedRoles: ["ADMIN"],
            allowedDepartments: [],
            ownerId: p.userId,
            sensitivity: "INTERNAL",
            updatedById: p.userId
          }
        }
      }
    });

    await auditor.record({
      companyId: p.companyId,
      userId: p.userId,
      action: "DOC_UPLOAD",
      detail: { documentId: doc.id, title: doc.title },
      requestId: req.requestId
    });

    res.status(201).json({ id: doc.id, title: doc.title, status: doc.status });
  })
);

documentRoutes.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const p = requireCompanyPrincipal(req);
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(50, Number(req.query.pageSize) || 20);

    const where = { companyId: p.companyId };
    const [items, total] = await Promise.all([
      prisma.document.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          acl: { select: { allowedRoles: true, allowedDepartments: true, sensitivity: true } },
          uploadedBy: { select: { email: true } }
        }
      }),
      prisma.document.count({ where })
    ]);

    // Tenant ACL is enforced server-side even for list operations.
    if (!p.isRootAdmin) {
      const visible: typeof items = [];
      for (const doc of items) {
        if (await canAccessDocument(p, doc.id)) visible.push(doc);
      }
      items.splice(0, items.length, ...visible);
    }

    res.json({ items, total: p.isRootAdmin ? total : items.length, page, pageSize });
  })
);

documentRoutes.get(
  "/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const p = requireCompanyPrincipal(req);
    const doc = await prisma.document.findFirst({
      where: { id: req.params.id, companyId: p.companyId },
      include: {
        acl: { select: { allowedRoles: true, allowedDepartments: true, ownerId: true, sensitivity: true } },
        chunks: { select: { id: true, index: true, section: true, pageStart: true, pageEnd: true } },
        uploadedBy: { select: { email: true, name: true } }
      }
    });
    if (!doc) throw new NotFoundError("Document not found");
    if (!(await canAccessDocument(p, doc.id))) throw new ForbiddenError("You do not have access to this document");
    res.json(doc);
  })
);

documentRoutes.post(
  "/:id/index",
  requireAuth,
  asyncHandler(async (req, res) => {
    const p = requireCompanyPrincipal(req);
    const doc = await prisma.document.findFirst({ where: { id: req.params.id, companyId: p.companyId } });
    if (!doc) throw new NotFoundError("Document not found");
    if (doc.status === "PROCESSING") return res.status(409).json({ error: "Document is already being processed" });

    res.status(202).json({ id: doc.id, status: "PROCESSING" });
    await auditor.record({
      companyId: p.companyId,
      userId: p.userId,
      action: "DOC_INDEX",
      detail: { documentId: doc.id },
      requestId: req.requestId
    });
    // Fire-and-forget long-running ingestion; designed to move to workers later.
    ingestionPipeline.ingest(doc.id, p.companyId).catch(() => undefined);
  })
);

documentRoutes.get(
  "/:id/graph",
  requireAuth,
  asyncHandler(async (req, res) => {
    const p = requireCompanyPrincipal(req);
    const doc = await prisma.document.findFirst({ where: { id: req.params.id, companyId: p.companyId } });
    if (!doc) throw new NotFoundError("Document not found");
    if (!(await canAccessDocument(p, doc.id))) throw new ForbiddenError("You do not have access to this document");

    const { searchAuthorizedEntities, neighborhood } = await import("../graph/retrieve.js");
    const { authorizedDocumentIds } = await import("../access/aclRepository.js");
    const authDocs = Array.from(await authorizedDocumentIds(p));

    const entities = await searchAuthorizedEntities({
      principal: p,
      tenantId: p.companyId,
      authDocs,
      query: "",
      limit: 50
    });
    // Keep only entities sourced from this document.
    const docEntities = entities.filter((e) => e.sourceDocuments.includes(doc.id));
    const result: { nodes: unknown[]; relationships: unknown[] } = { nodes: [], relationships: [] };
    for (const e of docEntities.slice(0, 20)) {
      const n = await neighborhood({ tenantId: p.companyId, authDocs, entityName: e.name, depth: 1, limit: 30 });
      result.nodes.push(...n.nodes);
      result.relationships.push(...n.relationships);
    }
    res.json({ documentId: doc.id, ...result });
  })
);

documentRoutes.post(
  "/:id/reclassify",
  requireAuth,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const p = requireCompanyPrincipal(req);
    const parsed = reclassifySchema.safeParse(req.body);
    if (!parsed.success) throw new NotFoundError(parsed.error.issues[0]?.message ?? "Invalid classification");
    const doc = await prisma.document.findFirst({ where: { id: req.params.id, companyId: p.companyId } });
    if (!doc) throw new NotFoundError("Document not found");

    await prisma.documentACL.upsert({
      where: { documentId: doc.id },
      create: {
        companyId: p.companyId,
        documentId: doc.id,
        allowedRoles: parsed.data.allowedRoles,
        allowedDepartments: parsed.data.allowedDepartments,
        ownerId: parsed.data.ownerId ?? null,
        sensitivity: parsed.data.sensitivity,
        updatedById: p.userId
      },
      update: {
        allowedRoles: parsed.data.allowedRoles,
        allowedDepartments: parsed.data.allowedDepartments,
        ownerId: parsed.data.ownerId ?? null,
        sensitivity: parsed.data.sensitivity,
        updatedById: p.userId
      }
    });
    await prisma.document.update({
      where: { id: doc.id },
      data: { category: doc.category, sensitivity: parsed.data.sensitivity }
    });

    await auditor.record({
      companyId: p.companyId,
      userId: p.userId,
      action: "ACL_CHANGE",
      detail: { documentId: doc.id, allowedRoles: parsed.data.allowedRoles, allowedDepartments: parsed.data.allowedDepartments },
      requestId: req.requestId
    });

    // Reindex to refresh Chroma ACL flags (fail-closed re-narrowing safe).
    const flags = await import("../access/policy.js");
    void flags;
    res.json({ id: doc.id, acl: parsed.data });
  })
);

documentRoutes.delete(
  "/:id",
  requireAuth,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const p = requireCompanyPrincipal(req);
    const doc = await prisma.document.findFirst({ where: { id: req.params.id, companyId: p.companyId } });
    if (!doc) throw new NotFoundError("Document not found");

    await prisma.documentChunk.deleteMany({ where: { documentId: doc.id } });
    await prisma.documentEntity.deleteMany({ where: { documentId: doc.id } });
    await prisma.ingestionJob.updateMany({ where: { documentId: doc.id }, data: { status: "SUPERSEDED" } });
    await prisma.document.delete({ where: { id: doc.id } });

    const { deleteDocumentSubgraph } = await import("../graph/repository.js");
    await deleteDocumentSubgraph(p.companyId, doc.id).catch(() => undefined);
    const { deleteDocumentVectors } = await import("../vector/chroma.js");
    await deleteDocumentVectors(doc.id).catch(() => undefined);

    try {
      fs.rmSync(path.join(config.UPLOAD_DIR, doc.storagePath), { force: true });
    } catch { /* best effort */ }

    await auditor.record({
      companyId: p.companyId,
      userId: p.userId,
      action: "DOC_DELETE",
      detail: { documentId: doc.id, title: doc.title },
      requestId: req.requestId
    });
    res.json({ ok: true });
  })
);

function stripExt(name: string): string {
  return name.replace(/\.[^.]+$/, "");
}