/**
 * The current session, for client components that need the CSRF token without prop drilling.
 *
 * Returning the token to a caller that already holds the session cookie is the premise of the
 * double-submit pattern (FR-71): an attacker's page can make the browser *send* the cookie, but
 * cannot *read* this response, because it is on our origin and the browser's same-origin policy
 * keeps the body away from them.
 */
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session.ts';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: true, authenticated: false }, { status: 200 });
  return NextResponse.json({
    ok: true,
    authenticated: true,
    csrfToken: session.csrfToken,
    user: {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
      role: session.user.role,
      emailVerified: Boolean(session.user.emailVerifiedAt),
    },
  });
}
