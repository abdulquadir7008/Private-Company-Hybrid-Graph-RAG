import jwt from "jsonwebtoken";
import type { JwtIdentity } from "@graphrag/shared";
import { config } from "../config.js";
import { UnauthorizedError } from "../errors.js";
import { uuid } from "../util/ids.js";

export interface SessionToken extends JwtIdentity {}

/** Creates a signed JWT containing identity information only. */
export function signSessionToken(identity: JwtIdentity): string {
  return jwt.sign(
    {
      email: identity.email,
      companyId: identity.companyId,
      roleScope: identity.roleScope,
      sessionId: identity.sessionId
    },
    config.JWT_SECRET as jwt.Secret,
    {
      subject: identity.sub,
      expiresIn: config.JWT_EXPIRES_IN as jwt.SignOptions["expiresIn"]
    }
  );
}

export function newSessionId(): string {
  return uuid();
}

export function verifySessionToken(token: string): SessionToken {
  try {
    const decoded = jwt.verify(token, config.JWT_SECRET);
    if (typeof decoded === "string" || !decoded.sub) {
      throw new UnauthorizedError("Invalid session");
    }
    return {
      sub: decoded.sub,
      email: typeof decoded.email === "string" ? decoded.email : "",
      companyId: typeof decoded.companyId === "string" ? decoded.companyId : null,
      roleScope: decoded.roleScope === "root" ? "root" : "company",
      sessionId: typeof decoded.sessionId === "string" ? decoded.sessionId : ""
    };
  } catch {
    throw new UnauthorizedError("Invalid or expired session");
  }
}

export function extractBearerToken(header: string | undefined): string {
  if (!header || !header.startsWith("Bearer ")) {
    throw new UnauthorizedError("Missing bearer token");
  }
  return header.slice("Bearer ".length).trim();
}