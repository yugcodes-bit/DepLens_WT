/**
 * Device/network profiles (doc 07 §3.3).
 *
 * Lighthouse's docs point out that CPU throttling is expressed *relative to the host machine*,
 * so "4×" means different phones on different desktops. We therefore define a profile by a
 * **target slowdown of the in-page calibration benchmark** and resolve the CDP throttling rate
 * per machine from its measured calibration curve (see machine.ts).
 *
 * The network side is never emulated during CPU measurement (doc 07 §3.4) — it is modelled
 * analytically from brotli bytes (§4.6), which keeps network jitter out of the CPU labels.
 */

export type ProfileName = 'desktop' | 'mid-tier-mobile' | 'low-end-mobile';

export interface NetworkModel {
  /** Downlink throughput in kilobits per second. */
  downKbps: number;
  rttMs: number;
  label: string;
}

export interface Profile {
  name: ProfileName;
  /** Target calibration slowdown relative to the same machine at rate 1. */
  targetSlowdown: number;
  network: NetworkModel;
  /** Viewport used for runs under this profile. */
  viewport: { width: number; height: number };
  deviceScaleFactor: number;
}

export const PROFILES: Record<ProfileName, Profile> = {
  desktop: {
    name: 'desktop',
    targetSlowdown: 1,
    network: { downKbps: 10_000, rttMs: 40, label: 'cable: 10 Mbps, 40 ms RTT' },
    viewport: { width: 1366, height: 768 },
    deviceScaleFactor: 1,
  },
  'mid-tier-mobile': {
    name: 'mid-tier-mobile',
    targetSlowdown: 4,
    network: { downKbps: 1_600, rttMs: 150, label: 'slow 4G: 1.6 Mbps, 150 ms RTT' },
    viewport: { width: 412, height: 915 },
    deviceScaleFactor: 2,
  },
  'low-end-mobile': {
    name: 'low-end-mobile',
    targetSlowdown: 10,
    network: { downKbps: 400, rttMs: 400, label: '2G-ish: 0.4 Mbps, 400 ms RTT' },
    viewport: { width: 412, height: 915 },
    deviceScaleFactor: 2,
  },
};

export const DEFAULT_PROFILE: ProfileName = 'mid-tier-mobile';

export function profileByName(name: string): Profile {
  const p = PROFILES[name as ProfileName];
  if (!p) throw new Error(`Unknown profile '${name}'. Known: ${Object.keys(PROFILES).join(', ')}`);
  return p;
}

/** A machine's measured calibration times, keyed by CDP CPU throttling rate. */
export type CalibrationCurve = Record<string, number>;

/**
 * The CDP throttling rate that makes the calibration benchmark take `targetSlowdown` × as long
 * as it does at rate 1 on this machine.
 *
 * The relation is close to but not exactly identity (Phase 0 measured 16.8 / 40.2 / 81.3 / 109.7 ms
 * at rates 1 / 2 / 4 / 6), so we interpolate the measured curve instead of trusting the rate.
 */
export function resolveCpuRate(curve: CalibrationCurve, targetSlowdown: number): number {
  const points = curvePoints(curve);
  const base = points.find((p) => p.rate === 1);
  if (!base) throw new Error('Calibration curve has no measurement at rate 1');
  if (targetSlowdown <= 1) return 1;

  const target = base.ms * targetSlowdown;
  for (let i = 1; i < points.length; i++) {
    const lo = points[i - 1]!;
    const hi = points[i]!;
    if (target >= lo.ms && target <= hi.ms) {
      const t = (target - lo.ms) / (hi.ms - lo.ms || 1);
      return round2(lo.rate + t * (hi.rate - lo.rate));
    }
  }
  // Target beyond the measured curve: extrapolate with the slope of the last segment.
  const last = points[points.length - 1]!;
  const prev = points[points.length - 2] ?? base;
  const slope = (last.rate - prev.rate) / (last.ms - prev.ms || 1);
  return round2(Math.max(1, last.rate + (target - last.ms) * slope));
}

/** The measured curve as sorted (rate, ms) points. */
function curvePoints(curve: CalibrationCurve): { rate: number; ms: number }[] {
  return Object.entries(curve)
    .map(([rate, ms]) => ({ rate: Number(rate), ms }))
    .filter((p) => Number.isFinite(p.rate) && Number.isFinite(p.ms) && p.ms > 0)
    .sort((a, b) => a.rate - b.rate);
}

/**
 * Expected calibration time at an arbitrary throttling rate, interpolated from the measured curve.
 *
 * Profiles resolve to fractional rates (e.g. 3.7), which are never measured points, so the drift
 * check (machine.ts) needs the curve as a function rather than as a lookup table. Rates outside the
 * measured range throw instead of extrapolating: a drift verdict built on a guessed reference would
 * abort good sessions and pass bad ones.
 */
export function expectedCalibrationMs(curve: CalibrationCurve, rate: number): number {
  const points = curvePoints(curve);
  if (points.length === 0) throw new Error('Calibration curve is empty');
  const exact = points.find((p) => p.rate === rate);
  if (exact) return exact.ms;
  const lo = points[0]!;
  const hi = points[points.length - 1]!;
  if (rate < lo.rate || rate > hi.rate) {
    throw new Error(
      `Rate ${rate} is outside the calibrated range ${lo.rate}–${hi.rate}. ` +
        `Re-run 'harness calibrate' covering it.`,
    );
  }
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    if (rate >= a.rate && rate <= b.rate) {
      const t = (rate - a.rate) / (b.rate - a.rate || 1);
      return a.ms + t * (b.ms - a.ms);
    }
  }
  throw new Error(`Rate ${rate} could not be interpolated on the calibration curve`);
}

const round2 = (x: number) => Math.round(x * 100) / 100;

/**
 * Modelled extra transfer time for `brotliBytes` more JS (doc 07 §4.6).
 * When the treatment adds new requests, each sequential round trip adds one RTT.
 */
export function networkMs(brotliBytes: number, profile: Profile, newSequentialRequests = 0): number {
  const transfer = (brotliBytes * 8) / profile.network.downKbps; // bits / kbps = ms
  return transfer + newSequentialRequests * profile.network.rttMs;
}

/**
 * The slowdown a machine will **actually** achieve for a profile.
 *
 * A profile is defined by its target slowdown, but `resolveCpuRate` has to pick a rate the browser
 * accepts, so the achieved slowdown can differ slightly from the target. Feature `profile_slowdown`
 * (G7) records what was achieved, not what was asked for — otherwise two machines measuring the
 * same profile would write the same number for two different experiments.
 *
 * With no calibration curve there is nothing to resolve, so the caller uses the target instead.
 */
export function achievedSlowdown(curve: CalibrationCurve, targetSlowdown: number): number {
  const rate = resolveCpuRate(curve, targetSlowdown);
  const base = expectedCalibrationMs(curve, 1);
  if (!(base > 0)) throw new Error('Calibration curve has no usable rate-1 measurement');
  return round2(expectedCalibrationMs(curve, rate) / base);
}
