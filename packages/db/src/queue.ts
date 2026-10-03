/**
 * The job queue (doc 06 §7.3).
 *
 * There is no Redis on the free tiers, so the `job` table *is* the queue. Two properties matter:
 *
 *  1. **Two workers can never take the same job.** `claimJob` is a single statement whose inner
 *     SELECT takes `FOR UPDATE SKIP LOCKED`, so a second worker running concurrently skips the row
 *     the first one is claiming instead of blocking on it or duplicating it.
 *  2. **A crashed worker's job comes back.** A claim sets `lease_until`; `reclaimExpired` returns
 *     anything past its lease to `queued`. That is also the resume mechanism for an interrupted
 *     campaign (FR-51) — no separate bookkeeping.
 */
import { and, eq, isNotNull, lt, sql } from 'drizzle-orm';
import { getDb } from './client.ts';
import { jobs } from './schema.ts';

export type JobKind = 'analyze' | 'measure';
export type JobTier = 'ci' | 'measurement';

export interface Job {
  id: string;
  kind: JobKind;
  tier: JobTier;
  analysisId: string | null;
  candidateIdx: number | null;
  payload: Record<string, unknown>;
  status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
  progress: number;
  progressMessage: string | null;
  attempts: number;
  error: string | null;
  result: Record<string, unknown> | null;
  createdAt: Date;
}

/** How long a worker holds a job before it is considered crashed. */
export const DEFAULT_LEASE_MS = 15 * 60 * 1000;

export async function enqueueJob(args: {
  kind: JobKind;
  tier: JobTier;
  payload: Record<string, unknown>;
  analysisId?: string;
  candidateIdx?: number;
}): Promise<Job> {
  const [row] = await getDb()
    .insert(jobs)
    .values({
      kind: args.kind,
      tier: args.tier,
      payload: args.payload,
      analysisId: args.analysisId ?? null,
      candidateIdx: args.candidateIdx ?? null,
    })
    .returning();
  return row as unknown as Job;
}

/**
 * Atomically claims the oldest queued job of a tier.
 *
 * `SKIP LOCKED` is the whole trick: without it, two workers polling at the same moment would
 * serialise on the same row and the second would then find it already claimed, wasting a round
 * trip; with it, the second worker immediately gets the *next* job instead.
 */
export async function claimJob(args: { tier: JobTier; workerId: string; leaseMs?: number }): Promise<Job | null> {
  const leaseMs = args.leaseMs ?? DEFAULT_LEASE_MS;
  const result = await getDb().execute(sql`
    UPDATE ${jobs}
       SET status = 'running',
           claimed_by = ${args.workerId},
           claimed_at = now(),
           lease_until = now() + ${sql.raw(`interval '${Math.round(leaseMs / 1000)} seconds'`)},
           attempts = ${jobs.attempts} + 1,
           updated_at = now()
     WHERE id = (
       SELECT id FROM ${jobs}
        WHERE status = 'queued' AND tier = ${args.tier}
        ORDER BY created_at
        LIMIT 1
        FOR UPDATE SKIP LOCKED
     )
    RETURNING *
  `);
  const rows = (result as unknown as { rows?: unknown[] }).rows ?? (result as unknown as unknown[]);
  const row = Array.isArray(rows) ? rows[0] : undefined;
  return row ? (normalise(row as Record<string, unknown>) as unknown as Job) : null;
}

export async function reportProgress(id: string, progress: number, message?: string): Promise<void> {
  await getDb()
    .update(jobs)
    .set({
      progress: Math.max(0, Math.min(100, Math.round(progress))),
      progressMessage: message ?? null,
      updatedAt: new Date(),
    })
    .where(eq(jobs.id, id));
}

export async function finishJob(id: string, result: Record<string, unknown>): Promise<void> {
  await getDb()
    .update(jobs)
    .set({ status: 'done', progress: 100, progressMessage: null, result, error: null, updatedAt: new Date() })
    .where(eq(jobs.id, id));
}

export async function failJob(id: string, error: string): Promise<void> {
  await getDb()
    .update(jobs)
    // The message is truncated because it ends up in an API response; a full stack trace would
    // leak file paths from the worker.
    .set({ status: 'failed', error: error.slice(0, 2000), updatedAt: new Date() })
    .where(eq(jobs.id, id));
}

export async function getJob(id: string): Promise<Job | null> {
  const [row] = await getDb().select().from(jobs).where(eq(jobs.id, id)).limit(1);
  return row ? (row as unknown as Job) : null;
}

/** Returns jobs whose lease expired to the queue. Run it before polling for work. */
export async function reclaimExpired(): Promise<number> {
  const rows = await getDb()
    .update(jobs)
    .set({ status: 'queued', claimedBy: null, claimedAt: null, leaseUntil: null, updatedAt: new Date() })
    .where(and(eq(jobs.status, 'running'), isNotNull(jobs.leaseUntil), lt(jobs.leaseUntil, new Date())))
    .returning({ id: jobs.id });
  return rows.length;
}

/** snake_case → camelCase for the raw-SQL claim path. */
function normalise(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    out[k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())] = v;
  }
  return out;
}
