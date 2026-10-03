/**
 * One-time codes and password-reset tokens (FR-61, FR-69, FR-70).
 *
 * Both are high-entropy secrets stored **hashed**, single-use, short-lived and attempt-capped. The
 * attempt cap is what makes a 6-digit code safe: a million combinations is nothing to a script, but
 * five guesses per code is nothing to an attacker either.
 */
import { and, desc, eq, isNull } from 'drizzle-orm';
import { getDb, otpCodes, passwordResets, type DepLensDb } from '@deplens/db';
import { constantTimeEqual, hashToken, randomOtp, randomToken } from './crypto.ts';

export const OTP_TTL_MS = 10 * 60 * 1000;
export const OTP_MAX_ATTEMPTS = 5;
export const RESET_TTL_MS = 30 * 60 * 1000;

export type OtpPurpose = 'verify_email' | 'login_step_up' | 'change_email';

/**
 * Issues a code and returns it **once**, in plaintext, so the caller can email it. It is never
 * readable again — only its hash is stored. Any earlier unused code for the same purpose is
 * consumed, so the most recent email is always the one that works.
 */
export async function issueOtp(userId: string, purpose: OtpPurpose, db: DepLensDb = getDb()): Promise<string> {
  const code = randomOtp();
  await db
    .update(otpCodes)
    .set({ consumedAt: new Date() })
    .where(and(eq(otpCodes.userId, userId), eq(otpCodes.purpose, purpose), isNull(otpCodes.consumedAt)));
  await db.insert(otpCodes).values({
    userId,
    purpose,
    codeHash: hashToken(code),
    expiresAt: new Date(Date.now() + OTP_TTL_MS),
  });
  return code;
}

export type OtpResult = 'ok' | 'no-code' | 'expired' | 'too-many-attempts' | 'wrong';

/** Checks a code and consumes it on success. Every failure path is distinct for the audit log. */
export async function verifyOtp(
  userId: string,
  purpose: OtpPurpose,
  code: string,
  db: DepLensDb = getDb(),
): Promise<OtpResult> {
  const rows = await db
    .select()
    .from(otpCodes)
    .where(and(eq(otpCodes.userId, userId), eq(otpCodes.purpose, purpose), isNull(otpCodes.consumedAt)))
    .orderBy(desc(otpCodes.createdAt))
    .limit(1);

  const row = rows[0];
  if (!row) return 'no-code';
  if (row.expiresAt.getTime() < Date.now()) return 'expired';
  if (row.attempts >= OTP_MAX_ATTEMPTS) return 'too-many-attempts';

  // Count the attempt before judging it, so a crash mid-check cannot hand out a free guess.
  await db
    .update(otpCodes)
    .set({ attempts: row.attempts + 1 })
    .where(eq(otpCodes.id, row.id));

  if (!constantTimeEqual(hashToken(code.trim()), row.codeHash)) return 'wrong';

  await db.update(otpCodes).set({ consumedAt: new Date() }).where(eq(otpCodes.id, row.id));
  return 'ok';
}

/** Issues a password-reset token, returned once in plaintext for the email link (FR-69). */
export async function issueResetToken(userId: string, db: DepLensDb = getDb()): Promise<string> {
  const token = randomToken();
  await db.insert(passwordResets).values({
    userId,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + RESET_TTL_MS),
  });
  return token;
}

/** Consumes a reset token, returning the user it belonged to, or null if it is not usable. */
export async function consumeResetToken(token: string, db: DepLensDb = getDb()): Promise<string | null> {
  const rows = await db.select().from(passwordResets).where(eq(passwordResets.tokenHash, hashToken(token.trim()))).limit(1);
  const row = rows[0];
  if (!row || row.consumedAt || row.expiresAt.getTime() < Date.now()) return null;
  await db.update(passwordResets).set({ consumedAt: new Date() }).where(eq(passwordResets.id, row.id));
  return row.userId;
}
