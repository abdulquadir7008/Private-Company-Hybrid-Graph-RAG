import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { asyncHandler } from "../util/asyncHandler.js";
import { requireRootAdmin } from "../access/middleware.js";
import { hashPassword, verifyPassword } from "../auth/passwords.js";
import { signSessionToken, newSessionId } from "../auth/tokens.js";
import { Auditor } from "../audit/service.js";
import { ValidationError, NotFoundError, AppError } from "../errors.js";

export const rootRoutes = Router();
const auditor = new Auditor();

const rootLoginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });

rootRoutes.post(
  "/login",
  asyncHandler(async (req, res) => {
    const parsed = rootLoginSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(401, "Invalid credentials", "INVALID_CREDENTIALS");
    const root = await prisma.rootAdmin.findUnique({ where: { email: parsed.data.email.toLowerCase().trim() } });
    if (!root) throw new AppError(401, "Invalid credentials", "INVALID_CREDENTIALS");
    const ok = await verifyPassword(parsed.data.password, root.passwordHash);
    if (!ok) throw new AppError(401, "Invalid credentials", "INVALID_CREDENTIALS");
    const token = signSessionToken({
      sub: root.id,
      email: root.email,
      companyId: null,
      roleScope: "root",
      sessionId: newSessionId()
    });
    res.json({ token, rootAdmin: { id: root.id, email: root.email } });
  })
);

/** Platform-level root admin endpoints (no tenant content exposure). */
rootRoutes.get(
  "/companies",
  requireRootAdmin,
  asyncHandler(async (_req, res) => {
    const companies = await prisma.company.findMany({
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { users: true, documents: true } } }
    });
    res.json(companies);
  })
);

const companyStatusSchema = z.object({
  status: z.enum(["PENDING_VERIFICATION", "ACTIVE", "SUSPENDED"])
});

rootRoutes.patch(
  "/companies/:id/status",
  requireRootAdmin,
  asyncHandler(async (req, res) => {
    const parsed = companyStatusSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError("Invalid status");
    const company = await prisma.company.findUnique({ where: { id: req.params.id } });
    if (!company) throw new NotFoundError("Company not found");
    await prisma.company.update({ where: { id: company.id }, data: { status: parsed.data.status } });
    await auditor.record({
      companyId: company.id,
      action: "COMPANY_STATUS_CHANGE",
      detail: { status: parsed.data.status },
      requestId: req.requestId
    });
    res.json({ id: company.id, status: parsed.data.status });
  })
);

const rootPasswordSchema = z.object({ password: z.string().min(8).max(200) });

rootRoutes.post(
  "/change-password",
  requireRootAdmin,
  asyncHandler(async (req, res) => {
    const parsed = rootPasswordSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError("Password must be at least 8 characters");
    const rootId = (req as unknown as { rootAdminId?: string }).rootAdminId;
    await prisma.rootAdmin.update({
      where: { id: rootId! },
      data: { passwordHash: await hashPassword(parsed.data.password) }
    });
    res.json({ ok: true });
  })
);