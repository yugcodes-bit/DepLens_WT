/**
 * Sign-in (FR-62, FR-65, FR-66).
 *
 * The checks are ordered so that the cheap ones fail first and none of them reveals anything:
 *   1. origin + CAPTCHA + schema — rejected before any database or hashing work
 *   2. per-IP throttle — a distributed guessing run is stopped without touching an account
 *   3. per-account lockout — stops a focused run on one address
 *   4. password verification, which always returns the same message whether the address exists or not
 */
import type { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { eq } from 'drizzle-orm';
import { getDb, users } from '@deplens/db';
import { GENERIC_LOGIN_FAILURE, assertSameOrigin, fail, failForm, ok, parseBody, route } from '@/lib/api.ts';
import { CAPTCHA_COOKIE, verifyCaptcha } from '@/lib/auth/captcha.ts';
import { verifyPassword } from '@/lib/auth/crypto.ts';
import {
  audit,
  clearFailedLogins,
  ipThrottled,
  lockRemainingMinutes,
  registerFailedLogin,
} from '@/lib/auth/guard.ts';
import { issueOtp } from '@/lib/auth/otp.ts';
import { createSession } from '@/lib/auth/session.ts';
import { sendMail, verificationEmail } from '@/lib/mail.ts';
import { loginSchema } from '@/lib/validation.ts';

export const POST = route(async (request): Promise<NextResponse> => {
  const origin = await assertSameOrigin();
  if (origin) return origin;

  if (await ipThrottled('login.failed')) {
    await audit('rate_limit.hit', 'failure', { detail: { endpoint: 'login' } });
    return failForm('Too many failed sign-ins from this network. Try again in 15 minutes.', 429);
  }

  const { data, error } = await parseBody(request, loginSchema);
  if (error) return error;

  const captchaToken = (await cookies()).get(CAPTCHA_COOKIE)?.value;
  const captcha = verifyCaptcha(captchaToken, data.captcha);
  if (captcha !== 'ok') {
    await audit('captcha.failed', 'failure', { detail: { endpoint: 'login', reason: captcha } });
    return fail({
      captcha: captcha === 'expired' ? 'That captcha expired — here is a new one' : 'Captcha answer is incorrect',
    });
  }

  const db = getDb();
  const rows = await db.select().from(users).where(eq(users.email, data.email)).limit(1);
  const user = rows[0];

  if (!user) {
    // Still log a failure so the per-IP throttle counts attempts on addresses that do not exist.
    await audit('login.failed', 'failure', { detail: { reason: 'unknown-email' } });
    return failForm(GENERIC_LOGIN_FAILURE, 401);
  }

  const locked = lockRemainingMinutes(user.lockedUntil);
  if (locked > 0) {
    await audit('login.locked', 'failure', { userId: user.id, detail: { minutesRemaining: locked } });
    return failForm(`This account is temporarily locked after repeated failed attempts. Try again in ${locked} minute(s).`, 429);
  }

  if (!(await verifyPassword(user.passwordHash, data.password))) {
    const { locked: nowLocked } = await registerFailedLogin(user.id);
    await audit('login.failed', 'failure', { userId: user.id, detail: { locked: nowLocked } });
    return failForm(
      nowLocked
        ? 'Too many failed attempts — this account is locked for 15 minutes.'
        : GENERIC_LOGIN_FAILURE,
      nowLocked ? 429 : 401,
    );
  }

  // Correct password, but the address was never confirmed (FR-61): send a fresh code instead of a session.
  if (!user.emailVerifiedAt) {
    const code = await issueOtp(user.id, 'verify_email');
    const mail = await sendMail(verificationEmail(user.email, code), code);
    await audit('login.unverified', 'failure', { userId: user.id });
    return ok({
      next: 'verify',
      message: 'Your email is not verified yet. We have sent you a new code.',
      ...(mail.devCode ? { devCode: mail.devCode } : {}),
    });
  }

  await clearFailedLogins(user.id);
  await createSession(user.id);
  await audit('login', 'success', { userId: user.id });
  return ok({ next: 'dashboard', message: 'Signed in' });
});
