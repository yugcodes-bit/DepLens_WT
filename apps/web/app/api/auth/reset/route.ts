/**
 * Completes a password reset (FR-69).
 *
 * Consuming the token also destroys every session for that user: if the reset was triggered because
 * the account was compromised, leaving the attacker's session alive would defeat the whole point.
 */
import type { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getDb, users } from '@deplens/db';
import { assertSameOrigin, fail, ok, parseBody, route } from '@/lib/api.ts';
import { hashPassword } from '@/lib/auth/crypto.ts';
import { audit, clearFailedLogins } from '@/lib/auth/guard.ts';
import { consumeResetToken } from '@/lib/auth/otp.ts';
import { destroyAllSessions } from '@/lib/auth/session.ts';
import { resetPasswordSchema } from '@/lib/validation.ts';

export const POST = route(async (request): Promise<NextResponse> => {
  const origin = await assertSameOrigin();
  if (origin) return origin;

  const { data, error } = await parseBody(request, resetPasswordSchema);
  if (error) return error;

  const userId = await consumeResetToken(data.token);
  if (!userId) {
    await audit('password_reset.completed', 'failure', { detail: { reason: 'bad-token' } });
    return fail({ _form: 'That reset link is invalid or has expired. Request a new one.' }, 400);
  }

  const db = getDb();
  await db
    .update(users)
    .set({ passwordHash: await hashPassword(data.password), updatedAt: new Date() })
    .where(eq(users.id, userId));
  await clearFailedLogins(userId);
  await destroyAllSessions(userId);
  await audit('password_reset.completed', 'success', { userId });
  return ok({ next: 'login', message: 'Password changed. Sign in with your new password.' });
});
