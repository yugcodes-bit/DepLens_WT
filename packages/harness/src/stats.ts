/**
 * Statistics for paired A/B measurement sessions (doc 07 §1).
 *
 * - Hodges–Lehmann (HL) one-sample estimator of the paired differences:
 *   the median of all Walsh averages (d_i + d_j) / 2, i <= j.
 * - Percentile bootstrap CI over pairs (resampling the differences).
 *
 * All randomness is seeded so every label is reproducible (NFR-REP4).
 */

/** mulberry32: tiny, fast, seedable PRNG returning floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function median(values: readonly number[]): number {
  if (values.length === 0) return Number.NaN;
  const s = [...values].sort((x, y) => x - y);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

export function mean(values: readonly number[]): number {
  if (values.length === 0) return Number.NaN;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

export function quantile(values: readonly number[], q: number): number {
  if (values.length === 0) return Number.NaN;
  const s = [...values].sort((x, y) => x - y);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return s[lo]!;
  return s[lo]! + (s[hi]! - s[lo]!) * (pos - lo);
}

/** Hodges–Lehmann estimator of location for a single sample (paired differences). */
export function hodgesLehmann(diffs: readonly number[]): number {
  const n = diffs.length;
  if (n === 0) return Number.NaN;
  const walsh: number[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      walsh.push((diffs[i]! + diffs[j]!) / 2);
    }
  }
  return median(walsh);
}

export interface Estimate {
  estimate: number;
  ciLow: number;
  ciHigh: number;
  n: number;
}

/** HL estimate with a percentile bootstrap CI (resampling pairs). */
export function hlWithBootstrapCI(
  diffs: readonly number[],
  opts: { resamples?: number; level?: number; seed?: number } = {},
): Estimate {
  const { resamples = 2000, level = 0.95, seed = 42 } = opts;
  const n = diffs.length;
  if (n === 0) return { estimate: Number.NaN, ciLow: Number.NaN, ciHigh: Number.NaN, n: 0 };
  const rng = mulberry32(seed);
  const boots: number[] = new Array(resamples);
  const sample: number[] = new Array(n);
  for (let b = 0; b < resamples; b++) {
    for (let i = 0; i < n; i++) sample[i] = diffs[Math.floor(rng() * n)]!;
    boots[b] = hodgesLehmann(sample);
  }
  const alpha = (1 - level) / 2;
  return {
    estimate: hodgesLehmann(diffs),
    ciLow: quantile(boots, alpha),
    ciHigh: quantile(boots, 1 - alpha),
    n,
  };
}

/** Ordinary least squares y = a + b x, with R². Used for harness validation (injected-cost test). */
export function linearFit(xs: readonly number[], ys: readonly number[]): { intercept: number; slope: number; r2: number } {
  const n = xs.length;
  const mx = xs.reduce((s, v) => s + v, 0) / n;
  const my = ys.reduce((s, v) => s + v, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - mx;
    const dy = ys[i]! - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  const r2 = syy === 0 ? 1 : (sxy * sxy) / (sxx * syy);
  return { intercept, slope, r2 };
}

/**
 * Minimum detectable effect from A/A sessions (doc 07 §7): the 95th percentile of the absolute
 * A/A estimates. Labels smaller than this are "within noise" — they are kept (a negligible cost is
 * real information) but reported separately from material ones.
 */
export function mdeFromAA(aaEstimates: readonly number[], level = 0.95): number {
  return quantile(aaEstimates.map(Math.abs), level);
}

/** Share of A/A sessions whose CI contains 0 — should be ≈ the nominal level (doc 07 §8.2). */
export function aaCoverage(cis: readonly { ciLow: number; ciHigh: number }[]): number {
  if (cis.length === 0) return Number.NaN;
  return cis.filter((c) => c.ciLow <= 0 && c.ciHigh >= 0).length / cis.length;
}
