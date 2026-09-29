/**
 * Paired, interleaved A/B measurement sessions (doc 07 §1, §3, §4).
 *
 * For each of k pairs, the order of A (baseline) and B (treatment) is randomized (seeded);
 * every run uses a fresh browser context (cold HTTP cache ⇒ no V8 code-cache reuse), CPU throttling
 * via CDP, a Chrome trace, and waits for the host's performance.mark('app-ready') plus a settle period.
 * One warm-up pair is run and discarded. Labels are Hodges–Lehmann estimates of B − A with bootstrap CIs.
 */
import { chromium, type Browser } from 'playwright-core';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import os from 'node:os';
import { parseTrace, type RunMetrics } from './trace.ts';
import { hlWithBootstrapCI, median, mulberry32, type Estimate } from './stats.ts';
import { startServer } from './server.ts';

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

export interface RunOptions {
  cpuRate: number;
  viewport?: { width: number; height: number };
  settleMs?: number;
  timeoutMs?: number;
  keepTraceDir?: string;
  traceName?: string;
}

export interface RunRecord extends RunMetrics {
  jsHeapMB: number | null;
  error: string | null;
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
    viewport: opts.viewport ?? { width: 412, height: 915 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
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
    if (opts.keepTraceDir && opts.traceName) {
      await mkdir(opts.keepTraceDir, { recursive: true });
      await writeFile(join(opts.keepTraceDir, `${opts.traceName}.json.gz`), gzipSync(traceBuf));
    }
    const metrics = parseTrace(JSON.parse(traceBuf.toString('utf8')));
    return { ...metrics, jsHeapMB: heap !== undefined ? heap / 1048576 : null, error: errors[0] ?? null };
  } finally {
    await context.close();
  }
}

/** Fixed-work calibration page (doc 07 §3.2). Returns the median wall-clock ms of 3 in-page repetitions. */
export const CALIBRATION_HTML = `<!doctype html><meta charset="utf-8"><title>calibration</title>
<script>
function work() {
  const t0 = performance.now();
  let x = 0;
  for (let i = 0; i < 3e6; i++) { x = (Math.imul(x, 31) + i) | 0; }
  const o = []; for (let i = 0; i < 2e4; i++) o.push({ i, s: 'v' + i, a: [i, i * 2] });
  const back = JSON.parse(JSON.stringify(o));
  window.__sink = x + back.length;
  return performance.now() - t0;
}
window.__calibrate = () => { const r = [work(), work(), work()].sort((a, b) => a - b); return r[1]; };
performance.mark('app-ready');
</script>`;

export async function calibrate(browser: Browser, origin: string, cpuRate: number): Promise<number> {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpuRate });
    await page.goto(`${origin}/calib/index.html`, { waitUntil: 'load' });
    return (await page.evaluate('window.__calibrate()')) as number;
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
  warmupPairs?: number;
  settleMs?: number;
  traceDir?: string;
}

export interface PairRecord {
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
  jsHeapMB: (r: RunRecord) => r.jsHeapMB ?? Number.NaN,
} as const;
export type LabelMetric = keyof typeof LABEL_METRICS;

export interface SessionResult {
  label: string;
  config: SessionConfig;
  env: Record<string, unknown>;
  calibration: { beforeMs: number; afterMs: number };
  pairs: PairRecord[];
  invalidRuns: number;
  labels: Record<LabelMetric, Estimate>;
  baselineMedian: Record<LabelMetric, number>;
  durationMs: number;
}

export async function runSession(browser: Browser, origin: string, cfg: SessionConfig): Promise<SessionResult> {
  const t0 = performance.now();
  const rng = mulberry32(cfg.seed);
  const beforeMs = await calibrate(browser, origin, cfg.cpuRate);
  const pairs: PairRecord[] = [];
  let invalidRuns = 0;
  const warmup = cfg.warmupPairs ?? 1;

  const runWithRetry = async (url: string, name: string) => {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const r = await measureRun(browser, url, {
          cpuRate: cfg.cpuRate,
          settleMs: cfg.settleMs,
          ...(cfg.traceDir ? { keepTraceDir: cfg.traceDir, traceName: name } : {}),
        });
        if (!r.error) return r;
        invalidRuns++;
        if (attempt === 1) return r;
      } catch (e) {
        invalidRuns++;
        if (attempt === 1) throw e;
      }
    }
    throw new Error('unreachable');
  };

  for (let i = 0; i < cfg.pairs + warmup; i++) {
    const order: 'AB' | 'BA' = rng() < 0.5 ? 'AB' : 'BA';
    let a: RunRecord;
    let b: RunRecord;
    if (order === 'AB') {
      a = await runWithRetry(cfg.urlA, `p${i}-A`);
      b = await runWithRetry(cfg.urlB, `p${i}-B`);
    } else {
      b = await runWithRetry(cfg.urlB, `p${i}-B`);
      a = await runWithRetry(cfg.urlA, `p${i}-A`);
    }
    if (i >= warmup) pairs.push({ order, a, b });
  }
  const afterMs = await calibrate(browser, origin, cfg.cpuRate);

  const labels = {} as Record<LabelMetric, Estimate>;
  const baselineMedian = {} as Record<LabelMetric, number>;
  for (const [key, get] of Object.entries(LABEL_METRICS) as [LabelMetric, (r: RunRecord) => number][]) {
    const valid = pairs.filter((p) => !p.a.error && !p.b.error);
    const diffs = valid.map((p) => get(p.b) - get(p.a)).filter((d) => Number.isFinite(d));
    labels[key] = hlWithBootstrapCI(diffs, { seed: cfg.seed });
    baselineMedian[key] = median(valid.map((p) => get(p.a)).filter((v) => Number.isFinite(v)));
  }

  return {
    label: cfg.label,
    config: cfg,
    env: {
      chromium: browser.version(),
      flags: CHROMIUM_FLAGS,
      traceCategories: TRACE_CATEGORIES,
      cpuModel: os.cpus()[0]?.model,
      cpus: os.cpus().length,
      platform: `${os.platform()} ${os.release()}`,
      node: process.version,
    },
    calibration: { beforeMs, afterMs },
    pairs,
    invalidRuns,
    labels,
    baselineMedian,
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
