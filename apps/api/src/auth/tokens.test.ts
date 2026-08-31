import { describe, expect, it } from "vitest";
import { signSessionToken, verifySessionToken, newSessionId, extractBearerToken } from "./tokens.js";
import { hashPassword, verifyPassword, generateTemporaryPassword } from "./passwords.js";
import { UnauthorizedError } from "../errors.js";

describe("session tokens (identity-only JWT)", () => {
  const identity = {
    sub: "user-1",
    email: "a@example.com",
    companyId: "company-1",
    roleScope: "company" as const,
    sessionId: "sess-1"
  };

  it("signs and verifies a round trip", () => {
    const token = signSessionToken(identity);
    expect(token).toBeTruthy();
    const decoded = verifySessionToken(token);
    expect(decoded.sub).toBe("user-1");
    expect(decoded.companyId).toBe("company-1");
    expect(decoded.roleScope).toBe("company");
  });

  it("rejects a tampered/foreign token", () => {
    const token = signSessionToken(identity);
    const tampered = token.slice(0, -4) + "aaaa";
    expect(() => verifySessionToken(tampered)).toThrow(UnauthorizedError);
  });

  it("rejects an empty/garbage token", () => {
    expect(() => verifySessionToken("not.a.jwt")).toThrow(UnauthorizedError);
  });

  it("generates unique session ids", () => {
    expect(newSessionId()).not.toBe(newSessionId());
  });
});

describe("extractBearerToken", () => {
  it("parses a Bearer header", () => {
    expect(extractBearerToken("Bearer abc.def.ghi")).toBe("abc.def.ghi");
  });
  it("rejects non-canonical prefixes (case-sensitive per RFC 6750)", () => {
    expect(() => extractBearerToken("bearer xyz")).toThrow(UnauthorizedError);
  });
  it("returns empty or throws for missing/malformed headers", () => {
    expect(() => extractBearerToken(undefined)).toThrow(UnauthorizedError);
    expect(() => extractBearerToken("Basic abc")).toThrow(UnauthorizedError);
    expect(extractBearerToken("Bearer ")).toBe("");
  });
});

describe("password hashing", () => {
  it("hashes and verifies correct passwords", async () => {
    const hash = await hashPassword("Sup3rSecret!");
    expect(hash).not.toContain("Sup3rSecret");
    expect(await verifyPassword("Sup3rSecret!", hash)).toBe(true);
  });

  it("rejects wrong passwords", async () => {
    const hash = await hashPassword("right-password");
    expect(await verifyPassword("wrong-password", hash)).toBe(false);
  });

  it("generates a non-trivial temporary password", () => {
    expect(generateTemporaryPassword().length).toBeGreaterThanOrEqual(12);
  });
});