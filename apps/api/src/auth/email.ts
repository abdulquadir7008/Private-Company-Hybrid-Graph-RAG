import sgMail from "@sendgrid/mail";
import { config } from "../config.js";
import { logger } from "../logger.js";

/**
 * Minimal email abstraction. In development the messages are written to the
 * console; with a SENDGRID_API_KEY configured they are sent for real.
 */
export async function sendEmail(opts: {
  to: string;
  subject: string;
  text: string;
  html?: string;
}): Promise<void> {
  const from = config.SENDGRID_FROM || "GraphRAG Assistant <no-reply@example.com>";
  if (config.SENDGRID_API_KEY) {
    sgMail.setApiKey(config.SENDGRID_API_KEY);
    try {
      await sgMail.send({ to: opts.to, from, subject: opts.subject, text: opts.text, html: opts.html });
      return;
    } catch (err) {
      logger.error("sendgrid send failed", { err });
      throw err;
    }
  }
  logger.info("email(console)", { meta: { to: opts.to, subject: opts.subject, text: opts.text } });
}

export function verificationEmail(to: string, code: string): Promise<void> {
  return sendEmail({
    to,
    subject: "Verify your email",
    text: `Your verification code is ${code}. It expires in 30 minutes.`
  });
}

export function passwordResetEmail(to: string, link: string): Promise<void> {
  return sendEmail({
    to,
    subject: "Reset your password",
    text: `Click here to reset your password: ${link}\nThe link expires in 60 minutes.`
  });
}

export function temporaryPasswordEmail(to: string, temp: string): Promise<void> {
  return sendEmail({
    to,
    subject: "Your account is ready",
    text: `An administrator created an account for you. Your temporary password is: ${temp}\nYou will be required to change it on first login.`
  });
}