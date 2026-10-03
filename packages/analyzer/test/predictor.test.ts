/**
 * The B3 placeholder predictor and candidate ranking.
 *
 * The behaviour these tests pin down is mostly about *honesty*: the placeholder must announce
 * itself, its interval must be wide enough to cover what Phase 0 actually measured, and ranking
 * must refuse to claim an order the intervals do not support (doc 05 UC-02).
 */
import { describe, expect, it } from 'vitest';
import type { CandidateReport } from '@deplens/shared';
import {
  B3_INTERVAL_HIGH,
  B3_INTERVAL_LOW,
  B3_MS_PER_KB,
  BytesBaselinePredictor,
  defaultPredictor,
  PLACEHOLDER_DISTRIBUTION,
  rankCandidates,
  splitPkgSpec,
} from '../src/index.ts';

const p = new BytesBaselinePredictor();

describe('BytesBaselinePredictor — B3 (doc 08 §4)', () => {
  it('scales linearly with the bytes added in context', () => {
    const a = p.predict({ ctx_delta_min_bytes: 10 * 1024 }, { profileSlowdown: 1 });
    const b = p.predict({ ctx_delta_min_bytes: 20 * 1024 }, { profileSlowdown: 1 });
    expect(a.script.point).toBeCloseTo(10 * B3_MS_PER_KB, 6);
    expect(b.script.point).toBeCloseTo(2 * a.script.point, 6);
  });

  it('scales with the device profile slowdown', () => {
    const desktop = p.predict({ ctx_delta_min_bytes: 70 * 1024 }, { profileSlowdown: 1 });
    const mobile = p.predict({ ctx_delta_min_bytes: 70 * 1024 }, { profileSlowdown: 4 });
    expect(mobile.script.point).toBeCloseTo(4 * desktop.script.point, 6);
  });

  it('reproduces the one in-context measurement it was derived from', () => {
    // research-log 2026-10-01: lodash on the react host, 73,468 B, 37.4 ms at 4.28×.
    const r = p.predict({ ctx_delta_min_bytes: 73_468 }, { profileSlowdown: 4.28 });
    expect(r.script.point).toBeCloseTo(37.4, 0);
  });

  it('announces itself as a placeholder, not a trained model', () => {
    const r = p.predict({ ctx_delta_min_bytes: 1024 }, { profileSlowdown: 1 });
    expect(r.model.kind).toBe('b3-bytes-linear');
    expect(r.model.trainedOnCells).toBeNull();
    expect(r.model.note).toMatch(/not a trained model/);
  });

  it('gives an interval wide enough to cover the Phase 0 spread', () => {
    // Four imports of 62–75 KB measured between ≈0 ms and +117 ms. A bytes-only interval that did
    // not span roughly that range would be claiming precision it does not have.
    const r = p.predict({ ctx_delta_min_bytes: 70 * 1024 }, { profileSlowdown: 4.28 });
    expect(r.script.low).toBeLessThan(r.script.point * 0.1);
    expect(r.script.high).toBeGreaterThan(r.script.point * 2);
    expect(r.script.low).toBeCloseTo(r.script.point * B3_INTERVAL_LOW, 6);
    expect(r.script.high).toBeCloseTo(r.script.point * B3_INTERVAL_HIGH, 6);
  });

  it('falls back to the isolated size when no host diff was available, and says so', () => {
    const r = p.predict({ iso_min_bytes: 70 * 1024 }, { profileSlowdown: 1 });
    expect(r.script.point).toBeGreaterThan(0);
    expect(r.model.note).toMatch(/No host build diff was available/);
  });

  it('prefers the in-context delta over the isolated size when both are present', () => {
    const r = p.predict({ ctx_delta_min_bytes: 204, iso_min_bytes: 70 * 1024 }, { profileSlowdown: 4 });
    const isoOnly = p.predict({ iso_min_bytes: 70 * 1024 }, { profileSlowdown: 4 });
    expect(r.script.point).toBeLessThan(isoOnly.script.point / 100);
    expect(r.model.note).not.toMatch(/No host build diff/);
  });

  it('predicts zero for an import the app already fully ships', () => {
    const r = p.predict({ ctx_delta_min_bytes: 0 }, { profileSlowdown: 4 });
    expect(r.script.point).toBe(0);
    expect(r.script.low).toBe(0);
    expect(r.script.high).toBe(0);
  });

  it('never returns a negative prediction, even for a negative byte delta', () => {
    // A treatment build can compress slightly smaller than its baseline; that is not negative time.
    const r = p.predict({ ctx_delta_min_bytes: -500 }, { profileSlowdown: 4 });
    expect(r.script.point).toBe(0);
  });

  it('tolerates a vector with nothing useful in it rather than producing NaN', () => {
    const r = p.predict({ host_framework: 'react' }, { profileSlowdown: 4 });
    expect(Number.isFinite(r.script.point)).toBe(true);
    expect(Number.isFinite(r.script.low)).toBe(true);
    expect(Number.isFinite(r.script.high)).toBe(true);
  });

  it('only accrues TBT once a task would cross the 50 ms threshold', () => {
    const small = p.predict({ ctx_delta_min_bytes: 20 * 1024 }, { profileSlowdown: 1 });
    expect(small.tbt.point).toBe(0);
    const large = p.predict({ ctx_delta_min_bytes: 2000 * 1024 }, { profileSlowdown: 4 });
    expect(large.tbt.point).toBeGreaterThan(0);
  });

  it('is the default predictor the pipeline ships with', () => {
    expect(defaultPredictor).toBeInstanceOf(BytesBaselinePredictor);
  });
});

describe('PLACEHOLDER_DISTRIBUTION', () => {
  it('describes the hosts we actually have, so the OOD flag means something', () => {
    expect(PLACEHOLDER_DISTRIBUTION.frameworks).toContain('react');
    expect(PLACEHOLDER_DISTRIBUTION.frameworks).toContain('solid');
    expect(PLACEHOLDER_DISTRIBUTION.frameworks).not.toContain('angular');
    expect(PLACEHOLDER_DISTRIBUTION.profileSlowdowns).toEqual([1, 4, 10]);
  });
});

describe('splitPkgSpec', () => {
  it.each([
    ['date-fns@4.1.0', 'date-fns', '4.1.0'],
    ['date-fns', 'date-fns', 'latest'],
    ['@scope/thing@1.2.3', '@scope/thing', '1.2.3'],
    ['@scope/thing', '@scope/thing', 'latest'],
    ['react@^18.3.1', 'react', '^18.3.1'],
  ])('%s -> %s @ %s', (input, name, range) => {
    expect(splitPkgSpec(input)).toEqual({ name, range });
  });
});

/** Minimal report stub — ranking only reads `candidate.name` and `script`. */
const report = (name: string, point: number, low: number, high: number): CandidateReport =>
  ({
    candidate: { name, version: '1.0.0', import: `import x from '${name}'` },
    script: { value: point, provenance: 'predicted', interval: [low, high] },
  }) as unknown as CandidateReport;

describe('rankCandidates (doc 05 UC-02)', () => {
  it('ranks cheapest first', () => {
    const r = rankCandidates([report('moment', 90, 80, 100), report('dayjs', 5, 3, 8), report('luxon', 40, 30, 50)]);
    expect(r.map((x) => x.name)).toEqual(['dayjs', 'luxon', 'moment']);
    expect(r.map((x) => x.rank)).toEqual([1, 2, 3]);
  });

  it('marks candidates whose intervals overlap as no clear difference', () => {
    // The example from UC-02: dayjs and date-fns should not be claimed as 1st and 2nd.
    const r = rankCandidates([report('dayjs', 5, 2, 9), report('date-fns', 6, 3, 10), report('moment', 90, 80, 100)]);
    expect(r[1]!.tiedWithPrevious).toBe(true);
    expect(r[2]!.name).toBe('moment');
    expect(r[2]!.tiedWithPrevious).toBe(false);
  });

  it('never marks the first candidate as tied', () => {
    expect(rankCandidates([report('a', 1, 0, 2)])[0]!.tiedWithPrevious).toBe(false);
  });

  it('separates candidates whose intervals do not overlap', () => {
    const r = rankCandidates([report('a', 5, 4, 6), report('b', 50, 45, 55)]);
    expect(r[1]!.tiedWithPrevious).toBe(false);
  });

  it('treats touching intervals as overlapping, which is the conservative reading', () => {
    const r = rankCandidates([report('a', 5, 0, 10), report('b', 15, 10, 20)]);
    expect(r[1]!.tiedWithPrevious).toBe(true);
  });

  it('handles an empty list', () => {
    expect(rankCandidates([])).toEqual([]);
  });
});
