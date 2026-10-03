/** Issues a fresh verification code (FR-61), rate limited so it cannot be used to spam an inbox. */
import type { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, users } from '@deplens/db';
import { assertSameOrigin, failForm, ok, parseBody, route } from '@/lib/api.ts';
import { audit, recentFailureCount } from '@/lib/auth/guard.ts';
import { issueOtp } from '@/lib/auth/otp.ts';
import { sendMail, verificationEmail } from '@/lib/mail.ts';
import { emailField } from '@/lib/validation.ts';

export const POST = route(async (request): Promise<NextResponse> => {
  const origin = await assertSameOrigin();
  if (origin) return origin;
  if ((await recentFailureCount('rate_limit.hit', 10 * 60 * 1000)) >= 5) {
    return failForm('Too many code requests. Wait a few minutes.', 429);
  }

  const { data, error } = await parseBody(request, z.object({ email: emailField }));
  if (error) return error;

  const rows = await getDb()
    .select({ id: users.id, emailVerifiedAt: users.emailVerifiedAt })
    .from(users)
    .where(eq(users.email, data.email))
    .limit(1);
  const user = rows[0];

  // Always the same response: this endpoint must not reveal whether an address is registered.
  if (!user || user.emailVerifiedAt) {
    await audit('rate_limit.hit', 'failure', { detail: { endpoint: 'resend-code', reason: 'no-op' } });
    return ok({ message: 'If that address needs verifying, a new code is on its way.' });
  }

  const code = await issueOtp(user.id, 'verify_email');
  const mail = await sendMail(verificationEmail(data.email, code), code);
  return ok({
    message: 'If that address needs verifying, a new code is on its way.',
    ...(mail.devCode ? { devCode: mail.devCode } : {}),
  });
});
