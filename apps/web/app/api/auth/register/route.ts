/**
 * Sign-up (FR-60, FR-61, FR-65, FR-74 … FR-80).
 *
 * Order matters: CAPTCHA first, then validation, then the password hash. Argon2id is intentionally
 * slow, so doing it before the cheap checks would hand anyone a way to burn our CPU.
 */
import type { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getDb, users } from '@deplens/db';
import { assertSameOrigin, fail, failForm, ok, parseBody, route } from '@/lib/api.ts';
import { CAPTCHA_COOKIE, verifyCaptcha } from '@/lib/auth/captcha.ts';
import { hashPassword } from '@/lib/auth/crypto.ts';
import { audit, ipThrottled } from '@/lib/auth/guard.ts';
import { issueOtp } from '@/lib/auth/otp.ts';
import { sendMail, verificationEmail } from '@/lib/mail.ts';
import { registerSchema } from '@/lib/validation.ts';
import { cookies } from 'next/headers';

export const POST = route(async (request): Promise<NextResponse> => {
  const origin = await assertSameOrigin();
  if (origin) return origin;

  if (await ipThrottled('register.duplicate')) {
    await audit('rate_limit.hit', 'failure', { detail: { endpoint: 'register' } });
    return failForm('Too many attempts from this network. Try again in 15 minutes.', 429);
  }

  const { data, error } = await parseBody(request, registerSchema);
  if (error) return error;

  const captchaToken = (await cookies()).get(CAPTCHA_COOKIE)?.value;
  const captcha = verifyCaptcha(captchaToken, data.captcha);
  if (captcha !== 'ok') {
    await audit('captcha.failed', 'failure', { detail: { endpoint: 'register', reason: captcha } });
    return fail({
      captcha: captcha === 'expired' ? 'That captcha expired — here is a new one' : 'Captcha answer is incorrect',
    });
  }

  const db = getDb();
  const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, data.email)).limit(1);

  if (existing[0]) {
    // Do not confirm that the address is taken: that would turn sign-up into an account oracle.
    // The owner gets an email; everyone else sees the same screen as a successful sign-up.
    await audit('register.duplicate', 'failure', { userId: existing[0].id, detail: { email: data.email } });
    return ok({ next: 'verify', message: 'Check your email for a 6-digit code.' }, 201);
  }

  const inserted = await db
    .insert(users)
    .values({ email: data.email, name: data.name, passwordHash: await hashPassword(data.password) })
    .returning({ id: users.id });
  const userId = inserted[0]!.id;

  const code = await issueOtp(userId, 'verify_email');
  const mail = await sendMail(verificationEmail(data.email, code), code);
  await audit('register', 'success', { userId, detail: { delivered: mail.delivered } });

  return ok(
    {
      next: 'verify',
      message: 'Check your email for a 6-digit code.',
      ...(mail.devCode ? { devCode: mail.devCode } : {}),
    },
    201,
  );
});
