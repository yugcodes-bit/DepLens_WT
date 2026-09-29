import { describe, expect, it } from 'vitest';
import { hlWithBootstrapCI, hodgesLehmann, linearFit, median, mulberry32, quantile } from '../src/stats.ts';

describe('stats', () => {
  it('median and quantile', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(quantile([0, 10], 0.25)).toBe(2.5);
  });

  it('Hodges–Lehmann of a symmetric sample is its center', () => {
    expect(hodgesLehmann([1, 2, 3, 4, 5])).toBe(3);
  });

  it('Hodges–Lehmann is robust to one outlier', () => {
    const hl = hodgesLehmann([10, 11, 9, 10, 12, 10, 500]);
    expect(hl).toBeGreaterThan(9);
    expect(hl).toBeLessThan(12);
  });

  it('bootstrap CI covers a known shift and is seeded (reproducible)', () => {
    const rng = mulberry32(7);
    const diffs = Array.from({ length: 12 }, () => 20 + (rng() - 0.5) * 6);
    const a = hlWithBootstrapCI(diffs, { seed: 3 });
    const b = hlWithBootstrapCI(diffs, { seed: 3 });
    expect(a).toEqual(b);
    expect(a.ciLow).toBeLessThan(20);
    expect(a.ciHigh).toBeGreaterThan(20);
    expect(a.ciHigh - a.ciLow).toBeLessThan(6);
  });

  it('A/A-like zero-centered noise gives a CI containing 0 most of the time', () => {
    let covered = 0;
    for (let s = 0; s < 200; s++) {
      const rng = mulberry32(1000 + s);
      const diffs = Array.from({ length: 10 }, () => (rng() - 0.5) * 4);
      const e = hlWithBootstrapCI(diffs, { seed: s, resamples: 500 });
      if (e.ciLow <= 0 && e.ciHigh >= 0) covered++;
    }
    // Percentile bootstrap with n = 10 under-covers a little; require ≥ 85%.
    expect(covered / 200).toBeGreaterThan(0.85);
  });

  it('linear fit', () => {
    const f = linearFit([0, 1, 2, 3], [1, 3, 5, 7]);
    expect(f.slope).toBeCloseTo(2);
    expect(f.intercept).toBeCloseTo(1);
    expect(f.r2).toBeCloseTo(1);
  });
});
