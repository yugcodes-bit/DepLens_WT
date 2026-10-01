/**
 * Paired, interleaved A/B measurement sessions (doc 07 §1, §3, §4; FR-30, FR-33, FR-35).
 *
 * For each of k pairs, the order of A (baseline) and B (treatment) is randomized (seeded);
 * every run uses a fresh browser context (cold HTTP cache ⇒ no V8 code-cache reuse), CPU throttling
 * via CDP, a Chrome trace, and waits for the host's performance.mark('app-ready') plus a settle period.
 * One warm-up pair is run and discarded. Labels are Hodges–Lehmann estimates of B − A with bootstrap CIs.
 *
 * Quality control built into every session:
 *   - calibration before and after, compared against the machine reference → abort on drift (FR-33)
 *   - failed runs retried once; > 20% failed runs marks the whole session failed (doc 07 §7)
 *   - an order-effect check (A-first vs B-first differences)
 *   - full reproducibility metadata: versions, flags, trace categories, seeds, machine id (NFR-REP1)
 */
import { chromium, type Browser } from 'playwright-core';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import os from 'node:os';
import { parseTrace, type RunMetrics } from './trace.ts';
import { hlWithBootstrapCI, mean, median, mulberry32, type Estimate } from './stats.ts';
import { startServer } from './server.ts';
import {
  CALIBRATION_HTML,
  DRIFT_FLAG_PCT,
  DriftAbortError,
  calibrate,
  checkDrift,
  machineId,
  type MachineRecord,
} from './machine.ts';
import { PROFILES, type ProfileName } from './profiles.ts';

export const TRACE_CATEGORIES = [
  'devtools.timeline',
  'disabled-by-default-devtools.timeline',
  'v8',
  'v8.execute',
  'disabled-by-default-v8.compile',
  'blink.user_timing',
  'loading',
  'toplevel',
];

export const CHROMIUM_FLAGS = [
  '--disable-extensions',
  '--disable-background-networking',
  '--disable-component-update',
  '--disable-default-apps',
  '--disable-sync',
  '--no-first-run',
  '--disable-renderer-backgrounding',
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--disable-features=Translate,OptimizationHints,MediaRouter',
];

/** Session kinds (doc 06 §6): paired treatment, A/A noise, isolated-on-empty-page. */
export type SessionKind = 'ab' | 'aa' | 'iso';

export interface RunOptions {
  cpuRate: number;
  viewport?: { width: number; height: number };
  deviceScaleFactor?: number;
  settleMs?: number;
  timeoutMs?: number;
  keepTraceDir?: string;
  traceName?: string;
}

export interface RunRecord extends RunMetrics {
  jsHeapMB: number | null;
  error: string | null;
  /** Relative path of the stored trace, when traces are kept (FR-35). */
  traceFile?: string;
}

export async function launchBrowser(): Promise<Browser> {
  return chromium.launch({
    headless: true,
    args: CHROMIUM_FLAGS,
    ...(process.env.DEPLENS_CHROMIUM ? { executablePath: process.env.DEPLENS_CHROMIUM } : {}),
  });
}

/** One page load in a fresh context, traced. */
export async function measureRun(browser: Browser, url: string, opts: RunOptions): Promise<RunRecord> {
  const context = await browser.newContext({
    viewport: opts.viewport ?? PROFILES['mid-tier-mobile'].viewport,
    deviceScaleFactor: opts.deviceScaleFactor ?? 2,
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  try {
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: opts.cpuRate });
    await browser.startTracing(page, { categories: TRACE_CATEGORIES });
    await page.goto(url, { waitUntil: 'load', timeout: opts.timeoutMs ?? 30_000 });
    await page.waitForFunction(() => performance.getEntriesByName('app-ready').length > 0, null, {
      timeout: opts.timeoutMs ?? 30_000,
    });
    await page.waitForTimeout(opts.settleMs ?? 1000);
    const traceBuf = await browser.stopTracing();
    await cdp.send('Performance.enable');
    const perf = (await cdp.send('Performance.getMetrics')) as { metrics: { name: string; value: number }[] };
    const heap = perf.metrics.find((m) => m.name === 'JSHeapUsedSize')?.value;
    let traceFile: string | undefined;
    if (opts.keepTraceDir && opts.traceName) {
      await mkdir(opts.keepTraceDir, { recursive: true });
      traceFile = `${opts.traceName}.json.gz`;
      await writeFile(join(opts.keepTraceDir, traceFile), gzipSync(traceBuf));
    }
    const metrics = parseTrace(JSON.parse(traceBuf.toString('utf8')));
    return {
      ...metrics,
      jsHeapMB: heap !== undefined ? heap / 1048576 : null,
      error: errors[0] ?? null,
      ...(traceFile ? { traceFile } : {}),
    };
  } finally {
    await context.close();
  }
}

export interface SessionConfig {
  label: string;
  urlA: string;
  urlB: string;
  pairs: number;
  cpuRate: number;
  seed: number;
  kind?: SessionKind;
  profile?: ProfileName;
  warmupPairs?: number;
  settleMs?: number;
  traceDir?: string;
  viewport?: { width: number; height: number };
  deviceScaleFactor?: number;
  /** Machine reference for the drift check (FR-33). Omit to skip the check (smoke tests). */
  machine?: MachineRecord | null;
  driftTolerancePct?: number;
  /** Session is marked failed above this share of failed runs (doc 07 §7). */
  maxRunFailurePct?: number;
}

export interface PairRecord {
  index: number;
  order: 'AB' | 'BA';
  a: RunRecord;
  b: RunRecord;
}

/** Metrics we estimate a paired difference for. */
export const LABEL_METRICS = {
  scriptThread: (r: RunRecord) => r.scriptThread,
  scriptWall: (r: RunRecord) => r.scriptWall,
  compileThread: (r: RunRecord) => r.thread.compile,
  evalThread: (r: RunRecord) => r.thread.eval,
  gcThread: (r: RunRecord) => r.thread.gc,
  mainThreadWall: (r: RunRecord) => r.mainThreadWall,
  tbtLoad: (r: RunRecord) => r.tbtLoad,
  longestTaskMs: (r: RunRecord) => r.longestTaskMs,
  fcpMs: (r: RunRecord) => r.fcpMs ?? Number.NaN,
  lcpMs: (r: RunRecord) => r.lcpMs ?? Number.NaN,
  jsHeapMB: (r: RunRecord) => r.jsHeapMB ?? Number.NaN,
} as const;
export type LabelMetric = keyof typeof LABEL_METRICS;

export interface RunFailure {
  pair: number;
  arm: 'A' | 'B';
  attempt: number;
  reason: string;
}

export interface SessionResult {
  id: string;
  label: string;
  kind: SessionKind;
  status: 'ok' | 'failed';
  statusReason?: string;
  config: SessionConfig;
  machineId: string;
  env: Record<string, unknown>;
  calibration: {
    beforeMs: number;
    afterMs: number;
    referenceMs: number | null;
    driftPct: number | null;
    /** before-vs-after drift within the session (doc 07 §7: flag above 5%) */
    sessionDriftPct: number;
    flagged: boolean;
  };
  pairs: PairRecord[];
  invalidRuns: number;
  failures: RunFailure[];
  labels: Record<LabelMetric, Estimate>;
  baselineMedian: Record<LabelMetric, number>;
  /** Simple order-effect check on the primary label (doc 07 §7). */
  orderEffect: { abMean: number; baMean: number; difference: number };
  startedAt: string;
  durationMs: number;
}

export async function runSession(browser: Browser, origin: string, cfg: SessionConfig): Promise<SessionResult> {
  const id = randomUUID();
  const startedAt = new Date().toISOString();
  const t0 = performance.now();
  const rng = mulberry32(cfg.seed);
  const kind: SessionKind = cfg.kind ?? (cfg.urlA === cfg.urlB ? 'aa' : 'ab');
  const profile = cfg.profile ? PROFILES[cfg.profile] : undefined;

  // Calibration + drift gate before any measurement (FR-33).
  const beforeMs = await calibrate(browser, origin, cfg.cpuRate);
  let referenceMs: number | null = null;
  let driftPct: number | null = null;
  if (cfg.machine) {
    const drift = checkDrift(cfg.machine, cfg.cpuRate, beforeMs, cfg.driftTolerancePct);
    referenceMs = drift.referenceMs;
    driftPct = drift.deviationPct;
    if (!drift.ok) throw new DriftAbortError(drift, cfg.cpuRate);
  }

  const pairs: PairRecord[] = [];
  const failures: RunFailure[] = [];
  let invalidRuns = 0;
  const warmup = cfg.warmupPairs ?? 1;
  const traceDir = cfg.traceDir ? join(cfg.traceDir, id) : undefined;
  const viewport = cfg.viewport ?? profile?.viewport;
  const deviceScaleFactor = cfg.deviceScaleFactor ?? profile?.deviceScaleFactor;

  const runWithRetry = async (url: string, pair: number, arm: 'A' | 'B') => {
    let last: RunRecord | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const r = await measureRun(browser, url, {
          cpuRate: cfg.cpuRate,
          ...(cfg.settleMs !== undefined ? { settleMs: cfg.settleMs } : {}),
          ...(viewport ? { viewport } : {}),
          ...(deviceScaleFactor !== undefined ? { deviceScaleFactor } : {}),
          ...(traceDir ? { keepTraceDir: traceDir, traceName: `p${pair}-${arm}-try${attempt}` } : {}),
        });
        if (!r.error) return r;
        invalidRuns++;
        failures.push({ pair, arm, attempt, reason: r.error });
        last = r;
      } catch (e) {
        invalidRuns++;
        failures.push({ pair, arm, attempt, reason: String(e) });
      }
    }
    if (last) return last;
    const why = failures
      .filter((f) => f.pair === pair && f.arm === arm)
      .map((f) => f.reason)
      .join(' | ');
    throw new Error(`Run ${arm} of pair ${pair} failed twice: ${why}`);
  };

  for (let i = 0; i < cfg.pairs + warmup; i++) {
    const order: 'AB' | 'BA' = rng() < 0.5 ? 'AB' : 'BA';
    let a: RunRecord;
    let b: RunRecord;
    if (order === 'AB') {
      a = await runWithRetry(cfg.urlA, i, 'A');
      b = await runWithRetry(cfg.urlB, i, 'B');
    } else {
      b = await runWithRetry(cfg.urlB, i, 'B');
      a = await runWithRetry(cfg.urlA, i, 'A');
    }
    if (i >= warmup) pairs.push({ index: i, order, a, b });
  }
  const afterMs = await calibrate(browser, origin, cfg.cpuRate);

  const valid = pairs.filter((p) => !p.a.error && !p.b.error);
  const labels = {} as Record<LabelMetric, Estimate>;
  const baselineMedian = {} as Record<LabelMetric, number>;
  for (const [key, get] of Object.entries(LABEL_METRICS) as [LabelMetric, (r: RunRecord) => number][]) {
    const diffs = valid.map((p) => get(p.b) - get(p.a)).filter((d) => Number.isFinite(d));
    labels[key] = hlWithBootstrapCI(diffs, { seed: cfg.seed });
    baselineMedian[key] = median(valid.map((p) => get(p.a)).filter((v) => Number.isFinite(v)));
  }

  const primary = (p: PairRecord) => p.b.scriptThread - p.a.scriptThread;
  const abMean = mean(valid.filter((p) => p.order === 'AB').map(primary));
  const baMean = mean(valid.filter((p) => p.order === 'BA').map(primary));

  const totalRuns = (cfg.pairs + warmup) * 2;
  const failureRate = invalidRuns / totalRuns;
  const maxFailPct = cfg.maxRunFailurePct ?? 20;
  const sessionDriftPct = ((afterMs - beforeMs) / beforeMs) * 100;

  let status: SessionResult['status'] = 'ok';
  let statusReason: string | undefined;
  if (failureRate > maxFailPct / 100) {
    status = 'failed';
    statusReason = `${invalidRuns}/${totalRuns} runs failed (> ${maxFailPct}%)`;
  } else if (valid.length < Math.ceil(cfg.pairs * 0.8)) {
    status = 'failed';
    statusReason = `only ${valid.length}/${cfg.pairs} valid pairs`;
  }

  return {
    id,
    label: cfg.label,
    kind,
    status,
    ...(statusReason ? { statusReason } : {}),
    config: cfg,
    machineId: machineId(),
    env: {
      chromium: browser.version(),
      chromiumPath: process.env.DEPLENS_CHROMIUM ?? 'playwright-bundled',
      flags: CHROMIUM_FLAGS,
      traceCategories: TRACE_CATEGORIES,
      cpuModel: os.cpus()[0]?.model,
      cpus: os.cpus().length,
      platform: `${os.platform()} ${os.release()}`,
      node: process.version,
    },
    calibration: {
      beforeMs,
      afterMs,
      referenceMs,
      driftPct,
      sessionDriftPct,
      flagged: Math.abs(sessionDriftPct) > DRIFT_FLAG_PCT,
    },
    pairs,
    invalidRuns,
    failures,
    labels,
    baselineMedian,
    orderEffect: { abMean, baMean, difference: abMean - baMean },
    startedAt,
    durationMs: performance.now() - t0,
  };
}

/** Static server with the calibration page mounted; mount `a`/`b` per session. */
export async function startMeasurementServer(workRoot: string) {
  const calibDir = join(workRoot, 'calib');
  await mkdir(calibDir, { recursive: true });
  await writeFile(join(calibDir, 'index.html'), CALIBRATION_HTML);
  const server = await startServer();
  server.mount('calib', calibDir);
  return server;
}
