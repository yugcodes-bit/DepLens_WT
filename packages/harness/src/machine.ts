/**
 * Measurement machine identity, calibration and drift control (doc 07 §3.1–§3.2, FR-33, NFR-REP1/3).
 *
 * Every label must be traceable to the machine it was produced on and to the calibration score at
 * that moment. Two things are stored per machine, in `<workRoot>/machine.json`:
 *   1. a **calibration curve** (CDP throttling rate → median ms of a fixed in-page benchmark), which
 *      turns a profile's target slowdown into a concrete rate (profiles.ts), and
 *   2. a **reference time at rate 1**, against which every session checks for drift.
 *
 * A session whose calibration deviates more than `DRIFT_ABORT_PCT` from the reference is aborted:
 * a machine that is 20% slower than usual is busy with something else, and its labels would be noise.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';
import type { Browser } from 'playwright-core';
import { expectedCalibrationMs, type CalibrationCurve } from './profiles.ts';

/** Session aborts when the calibration benchmark deviates more than this from the machine reference. */
export const DRIFT_ABORT_PCT = 10;
/** A session whose before/after calibration differ by more than this is flagged (not aborted). */
export const DRIFT_FLAG_PCT = 5;

/**
 * Fixed-work calibration page (doc 07 §3.2): a deterministic integer loop plus a JSON round trip,
 * ~15–20 ms at rate 1 on a modern desktop. The work is **fixed**, not wall-clock bounded, so CPU
 * throttling slows it down like real code (doc 07 §8, the busy-wait warning).
 */
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
// DepLens machine index: fixed-work iterations per second, measured at rate 1 only.
// (Our own index, not Lighthouse's benchmarkIndex — the two are not comparable numerically.)
window.__machineIndex = () => {
  const t0 = performance.now();
  let n = 0;
  let x = 0;
  while (performance.now() - t0 < 500) {
    for (let i = 0; i < 1e5; i++) { x = (Math.imul(x, 31) + i) | 0; }
    n++;
  }
  window.__sink2 = x;
  return Math.round((n / ((performance.now() - t0) / 1000)) * 10);
};
performance.mark('app-ready');
</script>`;

/** Runs the in-page calibration benchmark at a given CDP throttling rate. Returns the median of 3. */
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

/** DepLens machine index (higher = faster). Measured at rate 1; meaningless under throttling. */
export async function machineIndex(browser: Browser, origin: string): Promise<number> {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.goto(`${origin}/calib/index.html`, { waitUntil: 'load' });
    return (await page.evaluate('window.__machineIndex()')) as number;
  } finally {
    await context.close();
  }
}

export interface MachineRecord {
  id: string;
  hostname: string;
  cpuModel: string;
  cpus: number;
  totalMemMB: number;
  os: string;
  node: string;
  chromium: string;
  /** rate → median calibration ms (doc 07 §3.3) */
  calibration: CalibrationCurve;
  machineIndex: number;
  measuredAt: string;
  /** Conditions that make this machine unsuitable for dataset measurements (doc 07 §3.1). */
  warnings: string[];
}

/** Stable per-machine id: hostname + CPU model + core count. */
export function machineId(): string {
  const raw = `${os.hostname()}|${os.cpus()[0]?.model ?? 'unknown'}|${os.cpus().length}`;
  return createHash('sha256').update(raw).digest('hex').slice(0, 12);
}

/**
 * Environment checks for the hard rule "dataset measurements only on a dedicated, idle machine"
 * (CLAUDE.md hard rule 1, doc 07 §3.1). These are advisory: the CLI prints them, the campaign
 * runner (P4) refuses to collect dataset cells while any are present.
 */
export function machineWarnings(): string[] {
  const w: string[] = [];
  const cores = os.cpus().length;
  if (process.env.CI) w.push('CI environment detected (CI env var set) — smoke tests only, never dataset cells');
  if (cores < 4) w.push(`only ${cores} logical cores — Phase 0 showed unusable A/A noise on a 2-vCPU VM`);
  if (existsSync('/.dockerenv')) w.push('running inside a container — record it; prefer bare metal for the dataset');
  const load = os.loadavg()[0] ?? 0;
  // loadavg is always 0 on Windows, so this only fires where it is meaningful.
  if (load > cores * 0.3) w.push(`1-minute load average ${load.toFixed(2)} on ${cores} cores — machine is not idle`);
  return w;
}

export const machinePath = (workRoot: string) => join(workRoot, 'machine.json');

export async function readMachine(workRoot: string): Promise<MachineRecord | null> {
  const p = machinePath(workRoot);
  if (!existsSync(p)) return null;
  return JSON.parse(await readFile(p, 'utf8')) as MachineRecord;
}

/** Measures the calibration curve for `rates` and stores it as this machine's reference. */
export async function calibrateMachine(
  browser: Browser,
  origin: string,
  workRoot: string,
  rates: number[] = [1, 2, 4, 6, 10],
  /** Pre-measured curve (e.g. the median of several sweeps) to store instead of measuring once. */
  curve?: CalibrationCurve,
): Promise<MachineRecord> {
  const calibration: CalibrationCurve = {};
  if (curve) {
    Object.assign(calibration, curve);
  } else {
    for (const rate of rates.includes(1) ? rates : [1, ...rates]) {
      calibration[String(rate)] = await calibrate(browser, origin, rate);
    }
  }
  const record: MachineRecord = {
    id: machineId(),
    hostname: os.hostname(),
    cpuModel: os.cpus()[0]?.model ?? 'unknown',
    cpus: os.cpus().length,
    totalMemMB: Math.round(os.totalmem() / 1048576),
    os: `${os.platform()} ${os.release()}`,
    node: process.version,
    chromium: browser.version(),
    calibration,
    machineIndex: await machineIndex(browser, origin),
    measuredAt: new Date().toISOString(),
    warnings: machineWarnings(),
  };
  await mkdir(workRoot, { recursive: true });
  await writeFile(machinePath(workRoot), JSON.stringify(record, null, 2));
  return record;
}

export interface DriftCheck {
  ok: boolean;
  referenceMs: number;
  observedMs: number;
  deviationPct: number;
}

/** FR-33: compare an observed calibration time against the machine reference for the same rate. */
export function checkDrift(machine: MachineRecord, cpuRate: number, observedMs: number, tolerancePct = DRIFT_ABORT_PCT): DriftCheck {
  // Profiles resolve to fractional rates, so the reference is interpolated from the machine's curve
  // rather than looked up (profiles.ts). An uncalibrated rate throws instead of being guessed.
  let referenceMs: number;
  try {
    referenceMs = expectedCalibrationMs(machine.calibration, cpuRate);
  } catch (e) {
    throw new Error(`Machine ${machine.id} has no calibration reference for rate ${cpuRate}: ${(e as Error).message}`);
  }
  const deviationPct = ((observedMs - referenceMs) / referenceMs) * 100;
  return { ok: Math.abs(deviationPct) <= tolerancePct, referenceMs, observedMs, deviationPct };
}

/** Error thrown when a session is aborted because the machine drifted (FR-33). */
export class DriftAbortError extends Error {
  constructor(public readonly check: DriftCheck, cpuRate: number) {
    super(
      `Calibration drift ${check.deviationPct.toFixed(1)}% at rate ${cpuRate} ` +
        `(${check.observedMs.toFixed(1)} ms vs reference ${check.referenceMs.toFixed(1)} ms) — session aborted. ` +
        `Close other workloads, or re-run 'harness calibrate --save' if the machine changed.`,
    );
    this.name = 'DriftAbortError';
  }
}
