/** Password-reset request (FR-69). Always answers identically, so it cannot enumerate accounts. */
import type { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { eq } from 'drizzle-orm';
import { getDb, users } from '@deplens/db';
import { assertSameOrigin, fail, failForm, ok, parseBody, route } from '@/lib/api.ts';
import { CAPTCHA_COOKIE, verifyCaptcha } from '@/lib/auth/captcha.ts';
import { audit, ipThrottled } from '@/lib/auth/guard.ts';
import { issueResetToken } from '@/lib/auth/otp.ts';
import { resetEmail, sendMail } from '@/lib/mail.ts';
import { requestResetSchema } from '@/lib/validation.ts';

const SAME_ANSWER = 'If that address has an account, a reset link is on its way.';

export const POST = route(async (request): Promise<NextResponse> => {
  const origin = await assertSameOrigin();
  if (origin) return origin;
  if (await ipThrottled('password_reset.requested')) {
    return failForm('Too many reset requests from this network. Try again later.', 429);
  }

  const { data, error } = await parseBody(request, requestResetSchema);
  if (error) return error;

  const captcha = verifyCaptcha((await cookies()).get(CAPTCHA_COOKIE)?.value, data.captcha);
  if (captcha !== 'ok') {
    await audit('captcha.failed', 'failure', { detail: { endpoint: 'request-reset', reason: captcha } });
    return fail({ captcha: captcha === 'expired' ? 'That captcha expired — here is a new one' : 'Captcha answer is incorrect' });
  }

  const rows = await getDb().select({ id: users.id }).from(users).where(eq(users.email, data.email)).limit(1);
  const user = rows[0];
  if (!user) {
    await audit('password_reset.requested', 'failure', { detail: { reason: 'unknown-email' } });
    return ok({ message: SAME_ANSWER });
  }

  const token = await issueResetToken(user.id);
  const mail = await sendMail(resetEmail(data.email, token), token);
  await audit('password_reset.requested', 'success', { userId: user.id });
  return ok({ message: SAME_ANSWER, ...(mail.devCode ? { devToken: mail.devCode } : {}) });
});
