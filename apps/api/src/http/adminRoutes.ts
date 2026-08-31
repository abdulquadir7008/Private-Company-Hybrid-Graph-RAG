import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { asyncHandler } from "../util/asyncHandler.js";
import { requireAuth, requireAdmin, requireCompanyPrincipal } from "../access/middleware.js";
import { Auditor } from "../audit/service.js";
import { hashPassword, generateTemporaryPassword } from "../auth/passwords.js";
import { temporaryPasswordEmail } from "../auth/email.js";
import { ValidationError, NotFoundError, ConflictError } from "../errors.js";
import { graphStats } from "../graph/repository.js";
import { findDuplicateEntities } from "../extraction/resolution.js";

export const adminRoutes = Router();
const auditor = new Auditor();

adminRoutes.get(
  "/users",
  requireAuth,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const p = requireCompanyPrincipal(req);
    const users = await prisma.user.findMany({
      where: { companyId: p.companyId },
      select: {
        id: true,
        email: true,
        name: true,
        department: true,
        isActive: true,
        emailVerifiedAt: true,
        mustChangePassword: true,
        createdAt: true,
        roles: { select: { role: true } }
      },
      orderBy: { createdAt: "asc" }
    });
    res.json({
      items: users.map((u) => ({ ...u, roles: u.roles.map((r) => r.role) }))
    });
  })
);

const createUserSchema = z.object({
  name: z.string().min(1).max(120),
  email: z.string().email(),
  roles: z.array(z.enum(["ADMIN", "HR", "LEGAL", "MANAGER", "EMPLOYEE", "CONTRACTOR"])).min(1),
  department: z.enum(["GENERAL", "ENGINEERING", "HR", "LEGAL", "FINANCE", "MARKETING", "SALES", "LEADERSHIP"]).default("GENERAL"),
  sendWelcome: z.boolean().default(true)
});

adminRoutes.post(
  "/users",
  requireAuth,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const p = requireCompanyPrincipal(req);
    const parsed = createUserSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid user payload");
    const email = parsed.data.email.toLowerCase().trim();
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) throw new ConflictError("A user with this email already exists", "email");

    const tempPassword = generateTemporaryPassword();
    const user = await prisma.user.create({
      data: {
        name: parsed.data.name,
        email,
        companyId: p.companyId,
        department: parsed.data.department,
        passwordHash: await hashPassword(tempPassword),
        mustChangePassword: true,
        roles: { create: parsed.data.roles.map((role) => ({ role, companyId: p.companyId })) }
      }
    });

    await new Auditor().record({
      companyId: p.companyId,
      userId: p.userId,
      action: "USER_CREATE",
      detail: { userId: user.id, email: user.email, roles: parsed.data.roles },
      requestId: req.requestId
    });
    if (parsed.data.sendWelcome) {
      await temporaryPasswordEmail(email, tempPassword).catch(() => undefined);
    }
    res.status(201).json({
      id: user.id,
      email: user.email,
      name: user.name,
      temporaryPassword: parsed.data.sendWelcome ? undefined : tempPassword
    });
  })
);

const updateUserSchema = z.object({
  roles: z.array(z.enum(["ADMIN", "HR", "LEGAL", "MANAGER", "EMPLOYEE", "CONTRACTOR"])).optional(),
  department: z.enum(["GENERAL", "ENGINEERING", "HR", "LEGAL", "FINANCE", "MARKETING", "SALES", "LEADERSHIP"]).optional(),
  isActive: z.boolean().optional()
});

adminRoutes.patch(
  "/users/:id",
  requireAuth,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const p = requireCompanyPrincipal(req);
    const parsed = updateUserSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError("Invalid update payload");
    const target = await prisma.user.findFirst({ where: { id: req.params.id, companyId: p.companyId } });
    if (!target) throw new NotFoundError("User not found");

    if (parsed.data.roles) {
      await prisma.userRole.deleteMany({ where: { userId: target.id } });
      await prisma.userRole.createMany({
        data: parsed.data.roles.map((role) => ({ userId: target.id, role, companyId: p.companyId }))
      });
    }
    await prisma.user.update({
      where: { id: target.id },
      data: {
        department: parsed.data.department ?? undefined,
        isActive: parsed.data.isActive ?? undefined
      }
    });
    await auditor.record({
      companyId: p.companyId,
      userId: p.userId,
      action: "ROLE_CHANGE",
      detail: { userId: target.id, roles: parsed.data.roles },
      requestId: req.requestId
    });
    res.json({ ok: true });
  })
);

adminRoutes.get(
  "/documents",
  requireAuth,
  requireAdmin,
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
          chunks: { select: { id: true } },
          uploadedBy: { select: { email: true } }
        }
      }),
      prisma.document.count({ where })
    ]);
    res.json({ items, total, page, pageSize });
  })
);

adminRoutes.get(
  "/graph",
  requireAuth,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const p = requireCompanyPrincipal(req);
    const [stats, dupes, pgStats] = await Promise.all([
      graphStats(p.companyId).catch(() => ({ entities: 0, relationships: 0, chunks: 0, documents: 0 })),
      findDuplicateEntities(p.companyId),
      prisma.graphStats.findUnique({ where: { companyId: p.companyId } })
    ]);
    res.json({ neo4j: stats, duplicates: dupes, postgres: pgStats ?? null });
  })
);

adminRoutes.get(
  "/audit",
  requireAuth,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const p = requireCompanyPrincipal(req);
    res.json(
      await auditor.search({
        companyId: p.companyId,
        action: typeof req.query.action === "string" ? req.query.action : undefined,
        userId: typeof req.query.userId === "string" ? req.query.userId : undefined,
        limit: Math.min(100, Number(req.query.limit) || 50),
        offset: Math.max(0, Number(req.query.offset) || 0)
      })
    );
  })
);

adminRoutes.get(
  "/ingestion",
  requireAuth,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const p = requireCompanyPrincipal(req);
    const jobs = await prisma.ingestionJob.findMany({
      where: { companyId: p.companyId },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { document: { select: { title: true, status: true, failureReason: true } } }
    });
    const failed = await prisma.ingestionJob.count({ where: { companyId: p.companyId, status: "FAILED" } });
    res.json({ jobs, failed });
  })
);

adminRoutes.get(
  "/feedback",
  requireAuth,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const p = requireCompanyPrincipal(req);
    const feedback = await prisma.answerFeedback.findMany({
      where: { companyId: p.companyId },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { user: { select: { email: true } }, message: { select: { content: true } } }
    });
    const helpful = feedback.filter((f) => f.rating === "HELPFUL").length;
    res.json({
      total: feedback.length,
      helpful,
      notHelpful: feedback.length - helpful,
      items: feedback.map((f) => ({
        id: f.id,
        rating: f.rating,
        reason: f.reason,
        email: f.user.email,
        answerPreview: f.message.content.slice(0, 150),
        createdAt: f.createdAt
      }))
    });
  })
);

adminRoutes.get(
  "/debug",
  requireAuth,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const p = requireCompanyPrincipal(req);
    const { debugRetrieval } = await import("../retrieval/hybrid.js");
    const parsed = z.object({ question: z.string().min(1).max(2000) }).safeParse(req.query);
    if (!parsed.success) throw new ValidationError("Question required");
    res.json(await debugRetrieval({ principal: p, question: parsed.data.question }));
  })
);