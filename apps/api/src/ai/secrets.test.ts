import { describe, it, expect } from "vitest";
import { encryptSecret, decryptSecret, maskSecret } from "./secrets.js";

describe("secrets (AES-256-GCM encryption)", () => {
  it("round-trips an api key", () => {
    const key = "sk-test-1234567890-abcd";
    const enc = encryptSecret(key);
    expect(enc).not.toContain(key);
    expect(enc).toMatch(/^[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]+$/);
    expect(decryptSecret(enc)).toBe(key);
  });

  it("produces a different ciphertext each time (random IV)", () => {
    const key = "sk-test-1234567890-abcd";
    expect(encryptSecret(key)).not.toBe(encryptSecret(key));
  });

  it("returns empty on tampered/garbage ciphertext (fail closed)", () => {
    expect(decryptSecret("not-a-valid-format")).toBe("");
    expect(decryptSecret("000000000000000000000000:00000000000000000000000000000000:deadbeef")).toBe("");
  });

  it("masks keys and never reveals more than a 4-char suffix", () => {
    expect(maskSecret("sk-abcdefghijklmnop")).toBe("sk-a…mnop");
    expect(maskSecret("")).toBe("");
  });
});