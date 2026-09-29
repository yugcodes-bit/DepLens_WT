/**
 * A cell = (host, import spec, profile) → one label (doc 01 §10).
 * measureCell() builds baseline + treatment (+ optional isolated build), runs the paired session,
 * and returns labels together with the exact byte deltas.
 */
import type { Browser } from 'playwright-core';
import { build, byteDelta, type BuildResult } from './build.ts';
import type { ImportSpec } from './importSpec.ts';
import { runSession, type SessionResult } from './session.ts';
import type { StaticServer } from './server.ts';

type StaticServerLike = Pick<StaticServer, 'origin' | 'mount'>;

export interface CellRequest {
  label: string;
  hostDir: string;
  /** null → A/A session (baseline vs baseline) */
  spec: ImportSpec | null;
  deps?: Record<string, string>;
  /** Empty host for the isolated build (context-free comparison). Optional. */
  emptyHostDir?: string;
  cpuRate: number;
  pairs: number;
  seed: number;
  workRoot: string;
  settleMs?: number;
}

export interface CellResult {
  request: CellRequest;
  baseline: Pick<BuildResult, 'key' | 'initial' | 'packages' | 'modules'>;
  treatment: Pick<BuildResult, 'key' | 'initial' | 'packages' | 'modules'>;
  isolated?: Pick<BuildResult, 'key' | 'initial' | 'packages' | 'modules'>;
  delta: ReturnType<typeof byteDelta>;
  session: SessionResult;
}

const slim = (b: BuildResult) => ({ key: b.key, initial: b.initial, packages: b.packages, modules: b.modules });

export async function measureCell(browser: Browser, server: StaticServerLike, req: CellRequest): Promise<CellResult> {
  const baseline = await build({ hostDir: req.hostDir, spec: null, workRoot: req.workRoot });
  const treatment = req.spec
    ? await build({ hostDir: req.hostDir, spec: req.spec, deps: req.deps ?? {}, workRoot: req.workRoot })
    : baseline;
  const isolated =
    req.spec && req.emptyHostDir
      ? await build({ hostDir: req.emptyHostDir, spec: req.spec, deps: req.deps ?? {}, workRoot: req.workRoot })
      : undefined;

  server.mount('a', baseline.distDir);
  server.mount('b', treatment.distDir);
  const session = await runSession(browser, server.origin, {
    label: req.label,
    urlA: `${server.origin}/a/index.html`,
    urlB: `${server.origin}/b/index.html`,
    pairs: req.pairs,
    cpuRate: req.cpuRate,
    seed: req.seed,
    settleMs: req.settleMs,
  });
  return {
    request: req,
    baseline: slim(baseline),
    treatment: slim(treatment),
    ...(isolated ? { isolated: slim(isolated) } : {}),
    delta: byteDelta(baseline, treatment, isolated),
    session,
  };
}
