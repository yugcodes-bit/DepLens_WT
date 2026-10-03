/** Logout (FR-64). Deletes the session row, so the cookie is dead even if it is replayed. */
import type { NextResponse } from 'next/server';
import { ok, route } from '@/lib/api.ts';
import { audit } from '@/lib/auth/guard.ts';
import { assertCsrf, destroyAllSessions, destroySession, getSession } from '@/lib/auth/session.ts';

export const POST = route(async (request): Promise<NextResponse> => {
  const session = await getSession();
  if (!session) return ok({ message: 'Already signed out' });

  await assertCsrf(session);
  const everywhere = new URL(request.url).searchParams.get('all') === '1';
  if (everywhere) {
    await destroyAllSessions(session.user.id);
    await audit('logout.all', 'success', { userId: session.user.id });
  } else {
    await destroySession();
    await audit('logout', 'success', { userId: session.user.id });
  }
  return ok({ message: everywhere ? 'Signed out on every device' : 'Signed out' });
});
