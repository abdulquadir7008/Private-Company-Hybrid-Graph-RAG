import { createHash, randomBytes, randomUUID } from "node:crypto";
import { ValidationError } from "../errors.js";

export function newId(prefix = "id"): string {
  return `${prefix}_${randomBytes(8).toString("hex")}`;
}

export function graphId(): string {
  return `g_${randomBytes(12).toString("hex")}`;
}

export function uuid(): string {
  return randomUUID();
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function requireNonEmpty(value: string | undefined, field: string, max = 500): string {
  const trimmed = value?.trim();
  if (!trimmed) throw new ValidationError(`${field} is required`, field);
  if (trimmed.length > max) throw new ValidationError(`${field} exceeds maximum length`, field);
  return trimmed;
}