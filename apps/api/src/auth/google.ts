import { OAuth2Client } from "google-auth-library";
import { prisma } from "../db.js";
import { config } from "../config.js";
import { AppError } from "../errors.js";
import { uniqueSlug } from "../util/slug.js";
import { auditor } from "../audit/service.js";

export interface GoogleProfile {
  googleId: string;
  email: string;
  name: string;
  verified: boolean;
}

export function googleConfigured(): boolean {
  return Boolean(config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET);
}

function buildClient(): OAuth2Client {
  return new OAuth2Client(
    config.GOOGLE_CLIENT_ID,
    config.GOOGLE_CLIENT_SECRET,
    config.GOOGLE_AUTH_REDIRECT_URI
  );
}

export function googleAuthUrl(state: string): string {
  const client = buildClient();
  return client.generateAuthUrl({
    access_type: "offline",
    scope: ["openid", "profile", "email"],
    state
  });
}

export async function exchangeCodeForProfile(code: string): Promise<GoogleProfile> {
  const client = buildClient();
  const { tokens } = await client.getToken(code);
  if (!tokens.id_token) {
    throw new AppError(401, "Google authentication failed", "GOOGLE_AUTH_FAILED");
  }
  const ticket = await client.verifyIdToken({
    idToken: tokens.id_token,
    audience: config.GOOGLE_CLIENT_ID
  });
  const payload = ticket.getPayload();
  if (!payload || !payload.email || !payload.sub) {
    throw new AppError(401, "Unable to read Google profile", "GOOGLE_AUTH_FAILED");
  }
  return {
    googleId: payload.sub,
    email: payload.email.toLowerCase().trim(),
    name: payload.name ?? payload.email.split("@")[0] ?? "",
    verified: Boolean(payload.email_verified)
  };
}

/**
 * Links a verified Google account to a user.
 *
 * - If a user already exists for the Google id, we reuse it.
 * - Otherwise the Google email is matched against an existing account and the
 *   Google id is attached (password-less users are treated as verified email).
 * - Otherwise a brand-new company + user is provisioned on first successful login.
 */
export async function upsertGoogleUser(profile: GoogleProfile, requestId?: string) {
  if (profile.verified === false) {
    throw new AppError(403, "Your Google email is not verified", "GOOGLE_EMAIL_UNVERIFIED");
  }

  let user = await prisma.user.findUnique({
    where: { googleId: profile.googleId },
    include: { company: true, roles: { select: { role: true } } }
  });

  if (!user) {
    const existingByEmail = await prisma.user.findUnique({
      where: { email: profile.email },
      include: { company: true, roles: { select: { role: true } } }
    });

    if (existingByEmail) {
      // Link Google identity to the existing account.
      user = await prisma.user.update({
        where: { id: existingByEmail.id },
        data: {
          googleId: profile.googleId,
          emailVerifiedAt: existingByEmail.emailVerifiedAt ?? new Date()
        },
        include: { company: true, roles: { select: { role: true } } }
      });
    } else {
      // First-time Google user: provision a new company.
      const companyName = profile.email.split("@")[1]?.split(".")[0] ?? "Company";
      const company = await prisma.company.create({
        data: {
          name: companyName,
          slug: await uniqueSlug(companyName, (slug) =>
            prisma.company.findUnique({ where: { slug } }).then(Boolean)
          ),
          status: config.isDemoSetupEnabled ? "ACTIVE" : "PENDING_VERIFICATION"
        }
      });
      user = await prisma.user.create({
        data: {
          email: profile.email,
          googleId: profile.googleId,
          name: profile.name,
          emailVerifiedAt: new Date(),
          companyId: company.id,
          department: "GENERAL",
          roles: { create: [{ role: "ADMIN", companyId: company.id }] }
        },
        include: { company: true, roles: { select: { role: true } } }
      });
    }
  }

  if (!user.isActive) {
    throw new AppError(403, "Account is deactivated", "ACCOUNT_INACTIVE");
  }
  if (user.company && user.company.status !== "ACTIVE") {
    throw new AppError(403, "Company account is not active", "COMPANY_INACTIVE");
  }

  await auditor.record({
    companyId: user.companyId,
    userId: user.id,
    action: "LOGIN",
    detail: { provider: "google" },
    requestId
  });

  return user;
}

export function emailAvailable(email: string): Promise<boolean> {
  return prisma.user.findUnique({ where: { email } }).then(Boolean);
}