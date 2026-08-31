import { Router } from "express";
import { z } from "zod";
import rateLimit from "express-rate-limit";
import { prisma } from "../db.js";
import { config } from "../config.js";
import { asyncHandler } from "../util/asyncHandler.js";
import { verifyPassword, hashPassword } from "../auth/passwords.js";
import { signSessionToken, newSessionId } from "../auth/tokens.js";
import { createVerificationCode, verifyEmailCode } from "../auth/codes.js";
import { createPasswordResetToken, consumePasswordResetToken, resetPasswordForUser } from "../auth/passwordReset.js";
import { verificationEmail, passwordResetEmail } from "../auth/email.js";
import { AppError, ConflictError, ValidationError } from "../errors.js";
import { requireAuth, principalOf } from "../access/middleware.js";
import { slugify } from "../util/slug.js";
import { auditor } from "../audit/service.js";

export const authRoutes = Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 50,
  standardHeaders: true,
  legacyHeaders: false,
  message: "Too many authentication attempts. Try again later."
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: "Too many login attempts. Try again later."
});

const registerSchema = z.object({
  name: z.string().min(1).max(120),
  email: z.string().email().max(254),
  password: z.string().min(8).max(200),
  companyName: z.string().min(2).max(120)
});

authRoutes.post(
  "/register",
  authLimiter,
  asyncHandler(async (req, res) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid registration input", parsed.error.issues[0]?.path?.[0]?.toString());
    const { name, email, password, companyName } = parsed.data;

    const normalizedEmail = email.toLowerCase().trim();
    const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existing) throw new ConflictError("An account with this email already exists", "email");

    const company = await prisma.company.create({
      data: {
        name: companyName,
        slug: slugify(companyName),
        status: config.isDemoSetupEnabled ? "ACTIVE" : "PENDING_VERIFICATION"
      }
    });

    const user = await prisma.user.create({
      data: {
        email: normalizedEmail,
        name,
        passwordHash: await hashPassword(password),
        companyId: company.id,
        department: "GENERAL",
        roles: { create: [{ role: "ADMIN", companyId: company.id }] }
      }
    });

    const { code, digest } = await createVerificationCode(user.id);
    void digest;
    await verificationEmail(normalizedEmail, code).catch(() => undefined);

    await auditor.record({
      companyId: company.id,
      userId: user.id,
      action: "REGISTER",
      requestId: req.requestId
    });

    res.status(201).json({ message: "Registration successful. Check your email for a verification code." });
  })
);

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
});

const SHAPE_ERROR = "Invalid email or password";

authRoutes.post(
  "/login",
  loginLimiter,
  asyncHandler(async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError(SHAPE_ERROR);

    const { email, password } = parsed.data;
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
      include: { company: true, roles: { select: { role: true } } }
    });

    const fail = () => {
      throw new AppError(401, SHAPE_ERROR, "INVALID_CREDENTIALS");
    };
    if (!user || !user.passwordHash || !user.companyId) return fail();
    if (!user.isActive || user.company?.status !== "ACTIVE") return fail();

    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) return fail();

    if (user.emailVerifiedAt == null) {
      // Resend code as convenience; error shape stays constant.
      const { code } = await createVerificationCode(user.id);
      await verificationEmail(user.email, code).catch(() => undefined);
      throw new AppError(403, "Please verify your email first", "EMAIL_NOT_VERIFIED");
    }

    const token = signSessionToken({
      sub: user.id,
      email: user.email,
      companyId: user.companyId,
      roleScope: "company",
      sessionId: newSessionId()
    });

    await auditor.record({
      companyId: user.companyId,
      userId: user.id,
      action: "LOGIN",
      detail: { mustChangePassword: user.mustChangePassword },
      requestId: req.requestId
    });

    res.json({
      token,
      mustChangePassword: user.mustChangePassword,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        department: user.department,
        roles: user.roles.map((r) => r.role)
      }
    });
  })
);

const verifySchema = z.object({
  email: z.string().email(),
  code: z.string().regex(/^\d{6}$/)
});

authRoutes.post(
  "/verify",
  authLimiter,
  asyncHandler(async (req, res) => {
    const parsed = verifySchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError("Verification code must be 6 digits", "code");
    const user = await prisma.user.findUnique({ where: { email: parsed.data.email.toLowerCase().trim() } });
    throwerIfNull(user);
    await verifyEmailCode(user.id, parsed.data.code);
    await auditor.record({ companyId: user.companyId, userId: user.id, action: "VERIFY_EMAIL", requestId: req.requestId });
    res.json({ message: "Email verified" });
  })
);

const forgotSchema = z.object({ email: z.string().email() });

authRoutes.post(
  "/forgot-password",
  authLimiter,
  asyncHandler(async (req, res) => {
    const parsed = forgotSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError("Valid email required", "email");
    const user = await prisma.user.findUnique({ where: { email: parsed.data.email.toLowerCase().trim() } });
    if (user) {
      const token = await createPasswordResetToken(user.id);
      const link = `${config.WEB_URL}/reset-password?token=${token}`;
      await passwordResetEmail(user.email, link).catch(() => undefined);
    }
    // Constant-shape response regardless of whether the account exists.
    res.json({ message: "If that email exists, a reset link has been sent." });
  })
);

const resetSchema = z.object({
  token: z.string().min(10),
  password: z.string().min(8).max(200)
});

authRoutes.post(
  "/reset-password",
  authLimiter,
  asyncHandler(async (req, res) => {
    const parsed = resetSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError("Password must be at least 8 characters", "password");
    const userId = await consumePasswordResetToken(parsed.data.token);
    await resetPasswordForUser(userId, parsed.data.password);
    await auditor.record({ userId, action: "PASSWORD_RESET", requestId: req.requestId });
    res.json({ message: "Password reset successful. You can now log in." });
  })
);

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(200)
});

authRoutes.post(
  "/change-password",
  requireAuth,
  asyncHandler(async (req, res) => {
    const parsed = changePasswordSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError("New password must be at least 8 characters", "newPassword");
    const p = principalOf(req);
    const user = await prisma.user.findUnique({ where: { id: p.userId } });
    throwerIfNull(user);
    if (!user.passwordHash) throw new ValidationError("This account has no password set", "currentPassword");
    const ok = await verifyPassword(parsed.data.currentPassword, user.passwordHash);
    if (!ok) throw new AppError(400, "Current password is incorrect", "WRONG_PASSWORD", "currentPassword");
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(parsed.data.newPassword), mustChangePassword: false }
    });
    await auditor.record({ companyId: user.companyId, userId: user.id, action: "PASSWORD_CHANGE", requestId: req.requestId });
    res.json({ message: "Password updated" });
  })
);

authRoutes.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const p = principalOf(req);
    if (p.isRootAdmin) {
      return res.json({ id: p.userId, email: p.email, isRootAdmin: true });
    }
    const user = await prisma.user.findUnique({
      where: { id: p.userId },
      include: { company: { select: { id: true, name: true, status: true } }, roles: { select: { role: true } } }
    });
    throwerIfNull(user);
    res.json({
      id: user.id,
      email: user.email,
      name: user.name,
      department: user.department,
      roles: user.roles.map((r) => r.role),
      company: user.company,
      mustChangePassword: user.mustChangePassword
    });
  })
);

function throwerIfNull<T>(value: T | null): asserts value is T {
  if (value === null) throw new AppError(404, "Account not found", "NOT_FOUND");
}