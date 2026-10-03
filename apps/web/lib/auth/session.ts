/**
 * Server-side login sessions (doc 06 §8, FR-62 … FR-64, FR-67, FR-68, FR-71).
 *
 * The browser holds exactly one thing: an opaque 256-bit random string in an `httpOnly` cookie. It
 * carries no user id, no role and no expiry — those live in the `auth_session` row, which is why a
 * session can be killed instantly (a signed token could not be revoked before it expired).
 *
 * The cookie value is stored **hashed**, so a database leak yields no usable sessions.
 */
import { cookies, headers } from 'next/headers';
import { and, eq, gt, lt } from 'drizzle-orm';
import { authSessions, getDb, users, type DepLensDb } from '@deplens/db';
import { hashToken, randomToken } from './crypto.ts';

export const SESSION_COOKIE = 'deplens_session';
export const CSRF_HEADER = 'x-deplens-csrf';

/** Idle expiry — refreshed on use. */
const IDLE_MS = 7 * 24 * 60 * 60 * 1000;
/** Absolute expiry — never extended, so a stolen cookie cannot live forever. */
const ABSOLUTE_MS = 30 * 24 * 60 * 60 * 1000;

export type Role = 'user' | 'researcher' | 'admin';

export interface CurrentUser {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  emailVerifiedAt: Date | null;
  contributeMeasurements: boolean;
}

export interface ActiveSession {
  user: CurrentUser;
  csrfToken: string;
}

async function requestMeta(): Promise<{ ip: string | null; userAgent: string | null }> {
  const h = await headers();
  // Vercel sets x-forwarded-for; the left-most entry is the client.
  const forwarded = h.get('x-forwarded-for');
  return {
    ip: forwarded?.split(',')[0]?.trim() ?? h.get('x-real-ip'),
    userAgent: h.get('user-agent'),
  };
}

/** Issues a new session and sets the cookie. Called only after the password and OTP checks pass. */
export async function createSession(userId: string): Promise<{ csrfToken: string }> {
  const db = getDb();
  const raw = randomToken();
  const csrfToken = randomToken(24);
  const { ip, userAgent } = await requestMeta();
  const nowMs = Date.now();

  await db.insert(authSessions).values({
    id: hashToken(raw),
    userId,
    csrfToken,
    ip,
    userAgent,
    expiresAt: new Date(nowMs + IDLE_MS),
    absoluteExpiresAt: new Date(nowMs + ABSOLUTE_MS),
  });

  const store = await cookies();
  store.set(SESSION_COOKIE, raw, {
    httpOnly: true, // JavaScript cannot read it, so XSS cannot steal it
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax', // sent on top-level navigation, not on cross-site form posts
    path: '/',
    maxAge: Math.floor(IDLE_MS / 1000),
  });
  return { csrfToken };
}

/**
 * Reads the current session, refreshing its idle expiry. Returns null when there is no valid
 * session — callers decide whether that is an error or just an anonymous visitor.
 */
export async function getSession(): Promise<ActiveSession | null> {
  const store = await cookies();
  const raw = store.get(SESSION_COOKIE)?.value;
  if (!raw) return null;

  const db = getDb();
  const id = hashToken(raw);
  const now = new Date();
  const rows = await db
    .select({
      csrfToken: authSessions.csrfToken,
      absoluteExpiresAt: authSessions.absoluteExpiresAt,
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      emailVerifiedAt: users.emailVerifiedAt,
      contributeMeasurements: users.contributeMeasurements,
    })
    .from(authSessions)
    .innerJoin(users, eq(users.id, authSessions.userId))
    .where(and(eq(authSessions.id, id), gt(authSessions.expiresAt, now), gt(authSessions.absoluteExpiresAt, now)))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  // Sliding idle window, capped by the absolute expiry.
  const nextIdle = new Date(Math.min(Date.now() + IDLE_MS, row.absoluteExpiresAt.getTime()));
  await db.update(authSessions).set({ lastSeenAt: now, expiresAt: nextIdle }).where(eq(authSessions.id, id));

  return {
    csrfToken: row.csrfToken,
    user: {
      id: row.id,
      email: row.email,
      name: row.name,
      role: row.role as Role,
      emailVerifiedAt: row.emailVerifiedAt,
      contributeMeasurements: row.contributeMeasurements,
    },
  };
}

/** Deletes this session server-side and clears the cookie (FR-64). */
export async function destroySession(): Promise<void> {
  const store = await cookies();
  const raw = store.get(SESSION_COOKIE)?.value;
  if (raw) await getDb().delete(authSessions).where(eq(authSessions.id, hashToken(raw)));
  store.delete(SESSION_COOKIE);
}

/** "Log out everywhere", and the forced logout after a password reset (FR-64, FR-69). */
export async function destroyAllSessions(userId: string, db: DepLensDb = getDb()): Promise<void> {
  await db.delete(authSessions).where(eq(authSessions.userId, userId));
}

/** Housekeeping: drop rows whose idle window has passed. Cheap, and keeps the table small. */
export async function pruneExpiredSessions(db: DepLensDb = getDb()): Promise<void> {
  await db.delete(authSessions).where(lt(authSessions.expiresAt, new Date()));
}

export class AuthError extends Error {
  constructor(
    message: string,
    public readonly status: 401 | 403,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

/** FR-67: every protected route handler starts here. A UI-only check is not security. */
export async function requireUser(): Promise<ActiveSession> {
  const session = await getSession();
  if (!session) throw new AuthError('You need to sign in to do that', 401);
  if (!session.user.emailVerifiedAt) throw new AuthError('Verify your email address first', 403);
  return session;
}

const RANK: Record<Role, number> = { user: 0, researcher: 1, admin: 2 };

/** FR-67: role check, server-side, by rank so admin inherits researcher. */
export async function requireRole(minimum: Role): Promise<ActiveSession> {
  const session = await requireUser();
  if (RANK[session.user.role] < RANK[minimum]) {
    throw new AuthError(`This action needs the ${minimum} role`, 403);
  }
  return session;
}

/**
 * FR-71 CSRF: a state-changing request must prove it came from our own page, not from a form on
 * someone else's site that happens to ride along with the cookie.
 *
 * Two independent checks, because each covers the other's gap:
 *   1. the request echoes the session's CSRF token in a header a cross-origin form cannot set, and
 *   2. the Origin header matches our own.
 */
export async function assertCsrf(session: ActiveSession): Promise<void> {
  const h = await headers();
  const sent = h.get(CSRF_HEADER);
  if (!sent || sent !== session.csrfToken) throw new AuthError('Invalid or missing CSRF token', 403);

  const origin = h.get('origin');
  if (origin) {
    const expected = process.env.NEXT_PUBLIC_APP_URL;
    const host = h.get('host');
    const allowed = new Set([expected, host ? `https://${host}` : null, host ? `http://${host}` : null].filter(Boolean));
    if (!allowed.has(origin)) throw new AuthError('Request origin is not allowed', 403);
  }
}
