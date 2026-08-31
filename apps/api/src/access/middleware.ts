import type { NextFunction, Request, Response } from "express";
import type { Principal } from "@graphrag/shared";
import { prisma } from "../db.js";
import { extractBearerToken, verifySessionToken } from "../auth/tokens.js";
import { AppError, ForbiddenError, UnauthorizedError } from "../errors.js";
import { newRequestId } from "../logger.js";
import { Auditor } from "../audit/service.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      requestId: string;
      principal?: Principal;
      rootAdminId?: string;
      tenantId?: string;
    }
  }
}

export function attachRequestId(req: Request, _res: Response, next: NextFunction): void {
  req.requestId = newRequestId();
  next();
}

/** Metrics-friendly health check (no DB dependency). */
export function health(req: Request, res: Response): void {
  res.json({
    status: "ok",
    uptime: process.uptime(),
    services: {
      postgres: "check-required",
      neo4j: "check-required",
      chroma: "check-required"
    }
  });
}

/** Full dependency check for the compose healthcheck. */
export async function healthFull(req: Request, res: Response): Promise<void> {
  await prisma.$queryRaw`SELECT 1`;
  res.json({ status: "ok" });
}

/**
 * Central authentication middleware.
 * - Verifies the JWT (identity only)
 * - Reloads roles, department, company status from PostgreSQL on EVERY request
 * - Rejects suspended/restricted tenants and deactivated users
 */
export async function requireAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const token = extractBearerToken(req.headers.authorization);
    const identity = verifySessionToken(token);

    if (identity.roleScope === "root") {
      const root = await prisma.rootAdmin.findUnique({ where: { id: identity.sub } });
      if (!root) throw new UnauthorizedError("Root account not found");
      req.rootAdminId = root.id;
      req.principal = {
        userId: root.id,
        email: root.email,
        companyId: null,
        roles: [],
        department: null,
        isRootAdmin: true
      };
      return next();
    }

    const user = await prisma.user.findUnique({
      where: { id: identity.sub },
      include: { company: true, roles: { select: { role: true } } }
    });
    if (!user) throw new UnauthorizedError("Account no longer exists");

    if (!user.isActive) throw new ForbiddenError("Account is deactivated");
    if (user.companyId) {
      const company = await prisma.company.findUnique({ where: { id: user.companyId } });
      if (!company) throw new UnauthorizedError("Company no longer exists");
      if (company.status === "SUSPENDED") throw new ForbiddenError("Company account is suspended");
      if (company.status === "PENDING_VERIFICATION") throw new ForbiddenError("Company account is not yet active");
    }

    req.principal = {
      userId: user.id,
      email: user.email,
      companyId: user.companyId,
      roles: user.roles.map((r) => r.role),
      department: user.department,
      isRootAdmin: false
    };
    req.tenantId = user.companyId ?? undefined;
    next();
  } catch (err) {
    next(err);
  }
}

/** Convenience: rebuild principled context for downstream services. */
export function principalOf(req: Request): Principal {
  if (!req.principal) throw new UnauthorizedError("Authentication required");
  return req.principal;
}

export function requireCompanyPrincipal(req: Request): Principal & { companyId: string } {
  const p = principalOf(req);
  if (!p.companyId || p.isRootAdmin) {
    throw new AppError(400, "This endpoint requires a company session", "COMPANY_REQUIRED");
  }
  return p as Principal & { companyId: string };
}

/** Require that the principal holds at least one of the given roles. */
export function requireRole(...roles: ("ADMIN" | "HR" | "LEGAL" | "MANAGER" | "EMPLOYEE" | "CONTRACTOR")[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      const p = principalOf(req);
      if (p.isRootAdmin) {
        // Root admins manage platform, not tenant content.
        if (roles.includes("ADMIN") && req.tenantId) return next();
        return next(new ForbiddenError("Root admin cannot access tenant data"));
      }
      if (p.roles.some((r) => roles.includes(r))) return next();
      next(new ForbiddenError("Insufficient role"));
    } catch (err) {
      next(err);
    }
  };
}

export function requireAdmin(req: Request, _res: Response, next: NextFunction): void {
  return requireRole("ADMIN")(req, _res, next);
}

export function requireRootAdmin(req: Request, _res: Response, next: NextFunction): void {
  const p = principalOf(req);
  if (!p.isRootAdmin) return next(new ForbiddenError("Root admin access required"));
  next();
}

export function ensureTenantMatch(principal: { companyId: string | null }, tenantIdFromDb?: string | null): void {
  if (!principal.companyId) throw new ForbiddenError("No tenant context");
  if (tenantIdFromDb !== undefined && tenantIdFromDb !== null && tenantIdFromDb !== principal.companyId) {
    // Register with the Auditor? No - this is a plain authorization failure.
    throw new ForbiddenError("Cross-tenant access denied");
  }
}

export { Auditor };