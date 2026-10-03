#!/usr/bin/env node
/**
 * Queue inspector — `pnpm jobs`.
 *
 * Small on purpose: when an analysis appears stuck in the UI, the first question is whether the job
 * was ever claimed, and the second is what the worker said about it. Both are one row in `job`.
 */
import { desc } from 'drizzle-orm';
import { closeDb, getDb, jobs } from '@deplens/db';

async function main(): Promise<void> {
  const rows = await getDb()
    .select({
      id: jobs.id,
      kind: jobs.kind,
      tier: jobs.tier,
      status: jobs.status,
      progress: jobs.progress,
      message: jobs.progressMessage,
      error: jobs.error,
      attempts: jobs.attempts,
      claimedBy: jobs.claimedBy,
      createdAt: jobs.createdAt,
    })
    .from(jobs)
    .orderBy(desc(jobs.createdAt))
    .limit(Number(process.argv[2] ?? 15));

  if (rows.length === 0) {
    console.log('The queue is empty.');
    return;
  }

  console.log(`${rows.length} most recent job(s):\n`);
  for (const r of rows) {
    console.log(
      `${r.createdAt.toISOString()}  ${r.status.padEnd(9)} ${`${r.progress}%`.padStart(5)}  ` +
        `${r.kind}/${r.tier}  ${r.id.slice(0, 8)}  attempts ${r.attempts}` +
        (r.claimedBy ? `  by ${r.claimedBy}` : ''),
    );
    const note = r.error ?? r.message;
    if (note) console.log(`    ${note.slice(0, 160)}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
