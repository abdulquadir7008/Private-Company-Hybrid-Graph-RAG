import { prisma } from "../db.js";
import { sha256 } from "../util/ids.js";
import { AppError, NotFoundError } from "../errors.js";

const CODE_TTL_MINUTES = 30;
const MAX_ATTEMPTS = 5;

function randomSixDigits(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

/** Create a fresh verification code for a user (invalidates previous ones). */
export async function createVerificationCode(userId: string): Promise<{ code: string; digest: string }> {
  const code = randomSixDigits();
  const digest = sha256(code);
  await prisma.verificationCode.updateMany({ where: { userId }, data: { consumedAt: new Date() } });
  await prisma.verificationCode.create({
    data: {
      userId,
      codeHash: digest,
      expiresAt: new Date(Date.now() + CODE_TTL_MINUTES * 60_000)
    }
  });
  return { code, digest };
}

/** Verify a submitted code. Throws a constant-shape error on failure. */
export async function verifyEmailCode(userId: string, submittedCode: string): Promise<void> {
  const record = await prisma.verificationCode.findFirst({
    where: { userId, consumedAt: null },
    orderBy: { createdAt: "desc" }
  });
  const fail = () => {
    throw new AppError(400, "Invalid or expired verification code", "INVALID_CODE");
  };
  if (!record) return fail();
  if (Date.now() > record.expiresAt.getTime()) return fail();
  if (record.consumedAt) return fail();

  if (sha256(submittedCode) !== record.codeHash) {
    await prisma.verificationCode.update({
      where: { id: record.id },
      data: { attempts: { increment: 1 } }
    });
    if (record.attempts + 1 >= MAX_ATTEMPTS) {
      await prisma.verificationCode.update({ where: { id: record.id }, data: { consumedAt: new Date() } });
    }
    return fail();
  }

  await prisma.verificationCode.update({ where: { id: record.id }, data: { consumedAt: new Date() } });
  await prisma.user.update({ where: { id: userId }, data: { emailVerifiedAt: new Date() } });
}

export const verificationCodeSettings = { CODE_TTL_MINUTES, MAX_ATTEMPTS };

export async function requireUserExists(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new NotFoundError("User not found");
  return user;
}