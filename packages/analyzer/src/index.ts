/**
 * `@deplens/analyzer` — the whole static side of DepLens, callable as one function.
 *
 * Used by the CLI (`harness analyze`), by the tier-2 GitHub Actions worker and by the API. It
 * never touches a browser, so the only thing it cannot produce is a `measured` number.
 */
import { SCHEMA_VERSION } from '@deplens/features';
import { profileByName, type AnalysisResult, type Budget, type ProfileName } from '@deplens/shared';
import { analyzeCandidate, analyzeHost, rankCandidates, type AnalyzedHost, type CandidateInput } from './analyze.ts';

export * from './predictor.ts';
export * from './analyze.ts';

export interface AnalyzeOptions {
  hostDir: string;
  candidates: CandidateInput[];
  workRoot: string;
  profile?: ProfileName;
  /**
   * The machine's calibrated slowdown for this profile. Supplied by the harness from
   * `.work/machine.json`; without it the profile's *target* slowdown is used, which is right for a
   * CI runner that will never produce a timing number anyway.
   */
  profileSlowdown?: number;
  budget?: Budget;
  /** Called after each candidate, for SSE progress in the web UI (doc 05 UI-2). */
  onProgress?: (done: number, total: number, name: string) => void;
}

/**
 * Analyses every candidate against one host and ranks them.
 *
 * Candidates run **sequentially**, not in parallel: each one installs packages and runs two
 * bundlers, and running several at once on one machine makes the build timings meaningless and can
 * exhaust the disk on a large campaign. Analysis throughput comes from more workers, not more
 * threads per worker.
 */
export async function analyze(opts: AnalyzeOptions): Promise<AnalysisResult> {
  const profile = opts.profile ?? 'mid-tier-mobile';
  const slowdown = opts.profileSlowdown ?? profileByName(profile).targetSlowdown;

  const host: AnalyzedHost = await analyzeHost({ hostDir: opts.hostDir, workRoot: opts.workRoot });

  const reports = [];
  for (const [i, candidate] of opts.candidates.entries()) {
    reports.push(
      await analyzeCandidate({
        host,
        candidate,
        profile,
        profileSlowdown: slowdown,
        budget: opts.budget,
      }),
    );
    opts.onProgress?.(i + 1, opts.candidates.length, candidate.pkg);
  }

  return {
    host: {
      name: host.name,
      framework: host.framework,
      baselineMinBytes: host.baseline.initial.minBytes,
    },
    profile,
    profileSlowdown: slowdown,
    budget: opts.budget,
    reports,
    ranking: rankCandidates(reports),
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
  };
}
