import type { NextFunction, Request, RequestHandler, Response } from "express";

/** Wrap an async handler so rejected promises reach the error middleware. */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

export function resolveId(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw Object.assign(new Error("Invalid resource id"), { status: 404 });
  }
  return value;
}