import { randomUUID } from "node:crypto";

export type LogLevel = "debug" | "info" | "warn" | "error";

interface LogEntry {
  level: LogLevel;
  message: string;
  requestId?: string;
  tenantId?: string;
  userId?: string;
  scope?: string;
  durationMs?: number;
  meta?: Record<string, unknown>;
  err?: unknown;
}

const LEVEL_RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = (process.env.LOG_LEVEL as LogLevel) || (configIsTest() ? "warn" : "info");

function configIsTest(): boolean {
  return process.env.NODE_ENV === "test";
}

function serializeError(err: unknown): unknown {
  if (err instanceof Error) {
    return { name: err.name, message: err.message, stack: err.stack?.split("\n").slice(0, 4) };
  }
  return err;
}

export function log(entry: LogEntry): void {
  if (LEVEL_RANK[entry.level] < LEVEL_RANK[threshold]) return;
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level: entry.level,
    msg: entry.message,
    requestId: entry.requestId,
    tenantId: entry.tenantId,
    userId: entry.userId,
    scope: entry.scope,
    durationMs: entry.durationMs,
    meta: entry.meta,
    err: entry.err !== undefined ? serializeError(entry.err) : undefined
  });
  if (entry.level === "error") console.error(line);
  else if (entry.level === "warn") console.warn(line);
  else console.log(line);
}

export function newRequestId(): string {
  return randomUUID();
}

/** Timing helper: wraps a call and logs its duration. */
export async function timed<T>(
  scope: string,
  fn: () => Promise<T>,
  opts: { requestId?: string; tenantId?: string; meta?: Record<string, unknown> } = {}
): Promise<T> {
  const start = performance.now();
  try {
    const result = await fn();
    log({ level: "info", message: "completed", scope, requestId: opts.requestId, tenantId: opts.tenantId, durationMs: performance.now() - start, meta: opts.meta });
    return result;
  } catch (err) {
    log({ level: "error", message: "failed", scope, requestId: opts.requestId, tenantId: opts.tenantId, durationMs: performance.now() - start, meta: opts.meta, err });
    throw err;
  }
}

export const logger = {
  debug: (message: string, opts: Omit<LogEntry, "level" | "message"> = {}) => log({ level: "debug", message, ...opts }),
  info: (message: string, opts: Omit<LogEntry, "level" | "message"> = {}) => log({ level: "info", message, ...opts }),
  warn: (message: string, opts: Omit<LogEntry, "level" | "message"> = {}) => log({ level: "warn", message, ...opts }),
  error: (message: string, opts: Omit<LogEntry, "level" | "message"> = {}) => log({ level: "error", message, ...opts })
};