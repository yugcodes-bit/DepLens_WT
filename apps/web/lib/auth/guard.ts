/**
 * Audit logging and rate limiting (FR-66, FR-72).
 *
 * Both live in Postgres rather than in process memory, because the API runs as serverless functions:
 * an in-memory counter would reset on every cold start and differ between instances, which is to say
 * it would not be a rate limit at all.
 */
import { and, count, eq, gte, sql } from 'drizzle-orm';
import { auditLog, getDb, users, type DepLensDb } from '@deplens/db';
import { headers } from 'next/headers';

export type AuditEvent =
  | 'register'
  | 'register.duplicate'
  | 'verify_email'
  | 'verify_email.failed'
  | 'login'
  | 'login.failed'
  | 'login.locked'
  | 'login.unverified'
  | 'logout'
  | 'logout.all'
  | 'password_reset.requested'
  | 'password_reset.completed'
  | 'captcha.failed'
  | 'rate_limit.hit'
  | 'role.changed'
  | 'analysis.created'
  | 'verify_run.requested';

/** FR-72. Never throws: a failure to write the log must not break the request it describes. */
export async function audit(
  event: AuditEvent,
  outcome: 'success' | 'failure',
  opts: { userId?: string | null; detail?: Record<string, unknown> } = {},
): Promise<void> {
  try {
    const h = await headers();
    await getDb()
      .insert(auditLog)
      .values({
        userId: opts.userId ?? null,
        event,
        outcome,
        ip: h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? h.get('x-real-ip') ?? null,
        userAgent: h.get('user-agent') ?? null,
        detail: opts.detail ?? null,
      });
  } catch (e) {
    console.error('[audit] failed to record', event, e);
  }
}

export async function clientIp(): Promise<string | null> {
  const h = await headers();
  return h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? h.get('x-real-ip') ?? null;
}

/**
 * FR-66, per-IP half: how many times has this address caused `event` recently?
 *
 * Counted from the audit log, which means the rate limit and the security record are the same data —
 * there is no way for one to say something the other denies.
 */
export async function recentFailureCount(event: AuditEvent, windowMs: number, db: DepLensDb = getDb()): Promise<number> {
  const ip = await clientIp();
  if (!ip) return 0;
  const rows = await db
    .select({ n: count() })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.event, event),
        eq(auditLog.outcome, 'failure'),
        eq(auditLog.ip, ip),
        gte(auditLog.createdAt, new Date(Date.now() - windowMs)),
      ),
    );
  return Number(rows[0]?.n ?? 0);
}

export const IP_WINDOW_MS = 15 * 60 * 1000;
export const IP_MAX_FAILURES = 20;
export const ACCOUNT_MAX_FAILURES = 5;
export const LOCK_MS = 15 * 60 * 1000;

/** True when this IP has failed too often and should be refused before any password work. */
export async function ipThrottled(event: AuditEvent): Promise<boolean> {
  return (await recentFailureCount(event, IP_WINDOW_MS)) >= IP_MAX_FAILURES;
}

/**
 * FR-66, per-account half. Counting on the user row (not per IP) is what stops a distributed attack
 * on one account; the lock is timed so a locked-out owner recovers without support.
 */
export async function registerFailedLogin(userId: string, db: DepLensDb = getDb()): Promise<{ locked: boolean }> {
  const rows = await db
    .update(users)
    .set({
      failedLogins: sql`${users.failedLogins} + 1`,
      lockedUntil: sql`case when ${users.failedLogins} + 1 >= ${ACCOUNT_MAX_FAILURES}
        then now() + interval '${sql.raw(String(Math.round(LOCK_MS / 60000)))} minutes' else ${users.lockedUntil} end`,
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId))
    .returning({ failedLogins: users.failedLogins, lockedUntil: users.lockedUntil });
  const row = rows[0];
  return { locked: (row?.lockedUntil?.getTime() ?? 0) > Date.now() };
}

export async function clearFailedLogins(userId: string, db: DepLensDb = getDb()): Promise<void> {
  await db.update(users).set({ failedLogins: 0, lockedUntil: null, updatedAt: new Date() }).where(eq(users.id, userId));
}

export function lockRemainingMinutes(lockedUntil: Date | null): number {
  if (!lockedUntil) return 0;
  return Math.max(0, Math.ceil((lockedUntil.getTime() - Date.now()) / 60000));
}
