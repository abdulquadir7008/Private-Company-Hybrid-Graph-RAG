import crypto from "node:crypto";
import { config } from "../config.js";

/** Deterministic 32-byte key derived from APP_ENC_KEY (supports dev value). */
function deriveKey(): Buffer {
  const raw = config.APP_ENC_KEY;
  return crypto.createHash("sha256").update(raw).digest();
}

/** Encrypt a plaintext API key. Returns `${ivHex}:${tagHex}:${ciphertextHex}`. */
export function encryptSecret(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", deriveKey(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("hex"), tag.toString("hex"), enc.toString("hex")].join(":");
}

/** Decrypt a value produced by encryptSecret. Returns "" on any failure. */
export function decryptSecret(encoded: string): string {
  try {
    const [ivHex, tagHex, dataHex] = encoded.split(":");
    if (!ivHex || !tagHex || !dataHex) return "";
    const decipher = crypto.createDecipheriv("aes-256-gcm", deriveKey(), Buffer.from(ivHex, "hex"));
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    const dec = Buffer.concat([decipher.update(Buffer.from(dataHex, "hex")), decipher.final()]);
    return dec.toString("utf8");
  } catch {
    return "";
  }
}

/** Mask an API key for logging / echo (never reveal more than 4 char suffix). */
export function maskSecret(value: string): string {
  if (!value) return "";
  if (value.length <= 6) return `${value.slice(0, 1)}…`;
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}