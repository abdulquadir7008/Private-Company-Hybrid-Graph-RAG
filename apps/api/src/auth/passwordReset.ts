import { prisma } from "../db.js";
import { sha256, uuid } from "../util/ids.js";
import { hashPassword } from "./passwords.js";
import { AppError } from "../errors.js";

const RESET_TTL_MINUTES = 60;

export async function createPasswordResetToken(userId: string): Promise<string> {
  const token = `prt_${uuid()}${uuid()}`.replace(/-/g, "");
  await prisma.passwordResetToken.updateMany({ where: { userId }, data: { consumedAt: new Date() } });
  await prisma.passwordResetToken.create({
    data: {
      userId,
      tokenHash: sha256(token),
      expiresAt: new Date(Date.now() + RESET_TTL_MINUTES * 60_000)
    }
  });
  return token;
}

export async function consumePasswordResetToken(token: string): Promise<string> {
  const digest = sha256(token);
  const record = await prisma.passwordResetToken.findUnique({ where: { tokenHash: digest } });
  if (!record || record.consumedAt || Date.now() > record.expiresAt.getTime()) {
    throw new AppError(400, "Invalid or expired reset token", "INVALID_RESET_TOKEN");
  }
  if (Date.now() > record.expiresAt.getTime()) {
    throw new AppError(400, "Reset token expired", "INVALID_RESET_TOKEN");
  }
  await prisma.passwordResetToken.update({ where: { id: record.id }, data: { consumedAt: new Date() } });
  return record.userId;
}

/** Called by reset-password flow; enforces a fresh password. */
export async function resetPasswordForUser(userId: string, newPassword: string): Promise<void> {
  if (newPassword.length < 8) {
    throw new AppError(400, "Password must be at least 8 characters", "WEAK_PASSWORD", "password");
  }
  const passwordHash = await hashPassword(newPassword);
  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash, mustChangePassword: false, emailVerifiedAt: new Date() }
  });
}