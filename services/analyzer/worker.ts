#!/usr/bin/env node
/**
 * The tier-2 analysis worker (doc 06 §7.2).
 *
 *   pnpm worker              # drain the queue once, then exit (what GitHub Actions runs)
 *   pnpm worker --watch      # keep polling (what a developer runs locally)
 *
 * **Why a shared CI runner is allowed here, and only here.** Hard rule 1 forbids measuring on
 * shared machines, and that rule is about *timing*: a loaded machine's A/A noise reaches ±4 ms
 * (docs/research-log.md 2026-10-01). This worker produces no timing at all. Byte counts come from
 * deterministic bundler output and reproduce identically on a busy runner, which is why doc 06 §7.2
 * puts byte analysis on Actions and keeps every millisecond on the quiet machine.
 *
 * Nothing here imports Playwright, so the tier is enforced by what the code *can* do, not by a
 * promise in a comment.
 */
import { hostname } from 'node:os';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { analyze } from '@deplens/analyzer';
import { claimJob, failJob, finishJob, reclaimExpired, reportProgress, type Job } from '@deplens/db';
import { analysisRequestSchema } from '@deplens/shared';

const repoRoot = resolve(import.meta.dirname, '../..');
const hostsRoot = resolve(repoRoot, 'research/hosts');
const workRoot = resolve(repoRoot, '.work');

const { values } = parseArgs({
  options: {
    watch: { type: 'boolean', default: false },
    'poll-ms': { type: 'string', default: '3000' },
    /** Stop after this many jobs — keeps a CI run bounded. */
    max: { type: 'string', default: '25' },
  },
});

const workerId = `${hostname()}:${process.pid}`;

/**
 * Runs one job. Any throw is recorded on the job rather than crashing the worker: one bad
 * candidate (a package that does not exist, a syntactically valid but unresolvable import) must
 * not stop the queue.
 */
async function runJob(job: Job): Promise<void> {
  console.log(`[${workerId}] claimed ${job.id} (attempt ${job.attempts})`);
  try {
    // The payload was validated when it was queued, but it has been through a database since, so
    // it is parsed again here — the worker trusts its own schema, not the row.
    const req = analysisRequestSchema.parse(job.payload);
    const hostDir = resolve(hostsRoot, req.host);
    if (!hostDir.startsWith(hostsRoot)) throw new Error(`Host path escapes the hosts root: ${req.host}`);

    await reportProgress(job.id, 5, `building ${req.host} baseline`);

    const result = await analyze({
      hostDir,
      workRoot,
      profile: req.profile,
      candidates: req.candidates.map((c) => ({ pkg: c.pkg, spec: c.spec })),
      ...(req.budget ? { budget: req.budget } : {}),
      onProgress: async (done, total, name) => {
        // 10% for the baseline build, the rest spread across candidates.
        await reportProgress(job.id, 10 + Math.round((done / total) * 90), `analysed ${name} (${done}/${total})`);
      },
    });

    await finishJob(job.id, result as unknown as Record<string, unknown>);
    console.log(`[${workerId}] done ${job.id}: ${result.reports.length} candidate(s) on ${result.host.name}`);
  } catch (e) {
    const message = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    console.error(`[${workerId}] failed ${job.id}: ${message}`);
    await failJob(job.id, message);
  }
}

async function main(): Promise<void> {
  const pollMs = Number(values['poll-ms']);
  const max = Number(values.max);
  let processed = 0;

  console.log(`[${workerId}] tier-2 analysis worker — byte analysis only, no timing (doc 06 §7.2)`);

  for (;;) {
    const reclaimed = await reclaimExpired();
    if (reclaimed > 0) console.log(`[${workerId}] returned ${reclaimed} expired job(s) to the queue`);

    const job = await claimJob({ tier: 'ci', workerId });
    if (job) {
      await runJob(job);
      processed++;
      if (processed >= max) {
        console.log(`[${workerId}] reached --max ${max}, stopping`);
        return;
      }
      continue;
    }

    if (!values.watch) {
      console.log(`[${workerId}] queue empty, ${processed} job(s) processed`);
      return;
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
