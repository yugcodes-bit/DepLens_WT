/** Email verification (FR-61). A correct code marks the address verified and starts a session. */
import type { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getDb, users } from '@deplens/db';
import { assertSameOrigin, fail, failForm, ok, parseBody, route } from '@/lib/api.ts';
import { audit, clearFailedLogins, ipThrottled } from '@/lib/auth/guard.ts';
import { verifyOtp } from '@/lib/auth/otp.ts';
import { createSession } from '@/lib/auth/session.ts';
import { otpSchema } from '@/lib/validation.ts';

const MESSAGE: Record<string, string> = {
  'no-code': 'No code is pending for this address. Request a new one.',
  expired: 'That code has expired. Request a new one.',
  'too-many-attempts': 'Too many incorrect attempts. Request a new code.',
  wrong: 'That code is not correct.',
};

export const POST = route(async (request): Promise<NextResponse> => {
  const origin = await assertSameOrigin();
  if (origin) return origin;
  if (await ipThrottled('verify_email.failed')) {
    await audit('rate_limit.hit', 'failure', { detail: { endpoint: 'verify' } });
    return failForm('Too many attempts from this network. Try again in 15 minutes.', 429);
  }

  const { data, error } = await parseBody(request, otpSchema);
  if (error) return error;

  const db = getDb();
  const rows = await db
    .select({ id: users.id, emailVerifiedAt: users.emailVerifiedAt })
    .from(users)
    .where(eq(users.email, data.email))
    .limit(1);
  const user = rows[0];

  // Same answer whether the address exists or the code is wrong, so this cannot enumerate accounts.
  if (!user) {
    await audit('verify_email.failed', 'failure', { detail: { reason: 'unknown-email' } });
    return fail({ code: MESSAGE.wrong! });
  }
  if (user.emailVerifiedAt) {
    return ok({ next: 'login', message: 'This address is already verified — you can sign in.' });
  }

  const result = await verifyOtp(user.id, 'verify_email', data.code);
  if (result !== 'ok') {
    await audit('verify_email.failed', 'failure', { userId: user.id, detail: { reason: result } });
    return fail({ code: MESSAGE[result] ?? MESSAGE.wrong! });
  }

  await db.update(users).set({ emailVerifiedAt: new Date(), updatedAt: new Date() }).where(eq(users.id, user.id));
  await clearFailedLogins(user.id);
  await createSession(user.id);
  await audit('verify_email', 'success', { userId: user.id });
  return ok({ next: 'dashboard', message: 'Email verified. You are signed in.' });
});
