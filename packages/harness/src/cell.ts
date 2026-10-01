/**
 * A cell = (host, import spec, profile) → one label (doc 01 §10).
 *
 * `prepareCell()` does everything deterministic: build baseline + treatment (+ the isolated build on
 * the empty host), compute exact byte deltas, and decide whether the cell is measurable at all
 * (FR-34 — an unmeasurable cell must be labelled invalid, never measured as "0 ms").
 * `measureCell()` adds the paired session on top.
 */
import type { Browser } from 'playwright-core';
import { build, byteDelta, lazyJsBytes, type BuildResult } from './build.ts';
import { packageNamesOf, type ImportSpec } from './importSpec.ts';
import { runSession, type SessionKind, type SessionResult } from './session.ts';
import type { StaticServer } from './server.ts';
import { resolveCpuRate, type ProfileName, PROFILES } from './profiles.ts';
import type { MachineRecord } from './machine.ts';

type StaticServerLike = Pick<StaticServer, 'origin' | 'mount'>;

export interface CellRequest {
  label: string;
  hostDir: string;
  /** null → A/A session (baseline vs baseline) */
  spec: ImportSpec | null;
  deps?: Record<string, string>;
  /** Empty host for the isolated build (context-free comparison). Optional. */
  emptyHostDir?: string;
  /** Explicit CDP throttling rate. Takes precedence over `profile`. */
  cpuRate?: number;
  /** Profile whose target slowdown is resolved against the machine's calibration curve. */
  profile?: ProfileName;
  pairs: number;
  seed: number;
  workRoot: string;
  settleMs?: number;
  kind?: SessionKind;
  /** Machine reference: enables the drift abort (FR-33) and profile→rate resolution. */
  machine?: MachineRecord | null;
  /** Override the drift-abort tolerance (percent). Default DRIFT_ABORT_PCT. */
  driftTolerancePct?: number;
  /** Store the raw traces of every run under `<workRoot>/traces` (FR-35). */
  keepTraces?: boolean;
}

export type InvalidReason =
  | 'zero-byte-delta'
  | 'package-absent'
  | 'lazy-not-split'
  | 'build-failed';

export interface CellValidity {
  valid: boolean;
  reason?: InvalidReason;
  detail?: string;
}

export interface PreparedCell {
  request: CellRequest;
  cpuRate: number;
  baseline: BuildResult;
  treatment: BuildResult;
  isolated?: BuildResult;
  delta: ReturnType<typeof byteDelta>;
  validity: CellValidity;
}

export interface CellResult {
  request: CellRequest;
  cpuRate: number;
  baseline: Pick<BuildResult, 'key' | 'initial' | 'packages' | 'modules' | 'bundler' | 'bundlerVersion' | 'hostFingerprint'>;
  treatment: Pick<
    BuildResult,
    'key' | 'initial' | 'packages' | 'modules' | 'bundler' | 'bundlerVersion' | 'hostFingerprint' | 'resolvedDeps'
  >;
  isolated?: Pick<BuildResult, 'key' | 'initial' | 'packages' | 'modules'>;
  delta: ReturnType<typeof byteDelta>;
  validity: CellValidity;
  session: SessionResult;
}

const slim = (b: BuildResult) => ({
  key: b.key,
  initial: b.initial,
  packages: b.packages,
  modules: b.modules,
  bundler: b.bundler,
  bundlerVersion: b.bundlerVersion,
  hostFingerprint: b.hostFingerprint,
});

export class InvalidCellError extends Error {
  constructor(public readonly cell: PreparedCell) {
    super(`Cell '${cell.request.label}' is not measurable: ${cell.validity.reason} — ${cell.validity.detail ?? ''}`);
    this.name = 'InvalidCellError';
  }
}

/**
 * FR-34 / doc 07 §2.3 sanity checks. A cell that fails these would otherwise contribute a
 * meaningless label: e.g. a package that tree-shakes to nothing looks like "free", and a `lazy`
 * spec that the bundler decided to inline is not measuring laziness at all.
 */
export function checkValidity(
  spec: ImportSpec | null,
  baseline: BuildResult,
  treatment: BuildResult,
  delta: ReturnType<typeof byteDelta>,
): CellValidity {
  if (!spec) return { valid: true }; // A/A: identical builds on purpose
  const lazy = spec.placement === 'lazy';

  if (lazy) {
    const lazyBytes = lazyJsBytes(treatment) - lazyJsBytes(baseline);
    if (lazyBytes <= 0) {
      return {
        valid: false,
        reason: 'lazy-not-split',
        detail: `no extra lazy JS emitted (${lazyBytes} bytes) — the dynamic import was inlined into the initial chunk`,
      };
    }
    return { valid: true };
  }

  if (delta.minBytes === 0) {
    return {
      valid: false,
      reason: 'zero-byte-delta',
      detail: 'treatment and baseline ship identical bytes — the import tree-shakes to nothing (label as zero-cost, do not measure)',
    };
  }

  const wanted = packageNamesOf(spec);
  const present = new Set(treatment.packages.map((p) => p.name));
  const missing = wanted.filter((n) => !present.has(n));
  if (missing.length > 0 && delta.minBytes > 0) {
    // The package may legitimately be re-exported through another package, so this is only a
    // problem when *none* of the requested packages show up in the initial bundle.
    if (missing.length === wanted.length) {
      return { valid: false, reason: 'package-absent', detail: `none of ${wanted.join(', ')} appears in the treatment bundle` };
    }
  }
  return { valid: true };
}

/** Resolve the CDP throttling rate for a request (explicit rate > profile via machine curve > profile target). */
export function cellCpuRate(req: Pick<CellRequest, 'cpuRate' | 'profile' | 'machine'>): number {
  if (req.cpuRate !== undefined) return req.cpuRate;
  if (!req.profile) return 1;
  const target = PROFILES[req.profile].targetSlowdown;
  return req.machine ? resolveCpuRate(req.machine.calibration, target) : target;
}

/** Everything that happens before the browser starts: installs, builds, byte deltas, validity. */
export async function prepareCell(req: CellRequest): Promise<PreparedCell> {
  const baseline = await build({ hostDir: req.hostDir, spec: null, workRoot: req.workRoot });
  const treatment = req.spec
    ? await build({ hostDir: req.hostDir, spec: req.spec, deps: req.deps ?? {}, workRoot: req.workRoot })
    : baseline;
  const isolated =
    req.spec && req.emptyHostDir
      ? await build({ hostDir: req.emptyHostDir, spec: req.spec, deps: req.deps ?? {}, workRoot: req.workRoot })
      : undefined;
  const delta = byteDelta(baseline, treatment, isolated);
  return {
    request: req,
    cpuRate: cellCpuRate(req),
    baseline,
    treatment,
    ...(isolated ? { isolated } : {}),
    delta,
    validity: checkValidity(req.spec, baseline, treatment, delta),
  };
}

/**
 * Prepare and measure one cell. Throws `InvalidCellError` when the builds show the cell cannot
 * produce a meaningful label — callers that want to record the invalid cell instead of failing
 * should call `prepareCell()` first and inspect `validity`.
 */
export async function measureCell(browser: Browser, server: StaticServerLike, req: CellRequest): Promise<CellResult> {
  const prepared = await prepareCell(req);
  if (!prepared.validity.valid) throw new InvalidCellError(prepared);

  const { baseline, treatment, isolated, delta } = prepared;
  server.mount('a', baseline.distDir);
  server.mount('b', treatment.distDir);
  const session = await runSession(browser, server.origin, {
    label: req.label,
    kind: req.kind ?? (req.spec ? 'ab' : 'aa'),
    urlA: `${server.origin}/a/index.html`,
    urlB: `${server.origin}/b/index.html`,
    pairs: req.pairs,
    cpuRate: prepared.cpuRate,
    seed: req.seed,
    ...(req.profile ? { profile: req.profile } : {}),
    ...(req.settleMs !== undefined ? { settleMs: req.settleMs } : {}),
    ...(req.machine !== undefined ? { machine: req.machine } : {}),
    ...(req.driftTolerancePct !== undefined ? { driftTolerancePct: req.driftTolerancePct } : {}),
    ...(req.keepTraces ? { traceDir: `${req.workRoot}/traces` } : {}),
  });
  return {
    request: req,
    cpuRate: prepared.cpuRate,
    baseline: slim(baseline),
    treatment: { ...slim(treatment), resolvedDeps: treatment.resolvedDeps },
    ...(isolated ? { isolated: slim(isolated) } : {}),
    delta,
    validity: prepared.validity,
    session,
  };
}
