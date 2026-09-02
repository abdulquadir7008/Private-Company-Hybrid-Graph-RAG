import type { Principal } from "@graphrag/shared";
import { prisma } from "../db.js";
import { logger } from "../logger.js";

export type AuditAction =
  | "ASK"
  | "DOC_UPLOAD"
  | "DOC_INDEX"
  | "DOC_DELETE"
  | "DOC_DOWNLOAD"
  | "REGISTER"
  | "VERIFY_EMAIL"
  | "LOGIN"
  | "USER_CREATE"
  | "ROLE_CHANGE"
  | "RECLASSIFY"
  | "ACL_CHANGE"
  | "PASSWORD_CHANGE"
  | "PASSWORD_RESET"
  | "COMPANY_STATUS_CHANGE"
  | "GRAPH_TRAVERSE"
  | "GRAPH_PATH_VIEW"
  | "GRAPH_AI_QUERY"
  | "FEEDBACK"
  | "CONVERSATION_DELETE";

export interface AuditRecord {
  companyId?: string | null;
  userId?: string | null;
  action: AuditAction;
  detail?: Record<string, unknown> | null;
  ip?: string;
  requestId?: string;
}

export class Auditor {
  async record(entry: AuditRecord): Promise<void> {
    try {
      await prisma.auditLog.create({
        data: {
          companyId: entry.companyId ?? null,
          userId: entry.userId ?? null,
          action: entry.action as never,
          detail: (entry.detail ?? null) as never,
          ip: entry.ip,
          requestId: entry.requestId
        }
      });
    } catch (err) {
      // Auditing must never break the request path.
      logger.error("audit record failed", { err });
    }
  }

  wrap(principal?: Principal | null, requestId?: string): {
    record: (action: AuditAction, detail?: Record<string, unknown>) => Promise<void>;
  } {
    return {
      record: (action, detail = {}) =>
        this.record({
          companyId: principal?.companyId ?? null,
          userId: principal?.userId ?? null,
          action,
          detail,
          requestId
        })
    };
  }

  async search(opts: {
    companyId: string;
    action?: string;
    userId?: string;
    limit?: number;
    offset?: number;
  }) {
    const where: Record<string, unknown> = { companyId: opts.companyId };
    if (opts.action) where.action = opts.action;
    if (opts.userId) where.userId = opts.userId;
    const [items, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: opts.limit ?? 50,
        skip: opts.offset ?? 0,
        include: { user: { select: { email: true, name: true } } }
      }),
      prisma.auditLog.count({ where })
    ]);
    return { items, total };
  }
}

export const auditor = new Auditor();