/**
 * FR-24 — "Unit tests cover all four risk classes" — plus FR-25 (out-of-distribution), the
 * analytical network model and the explanation templates.
 */
import { describe, expect, it } from 'vitest';
import {
  adviceFor,
  attributed,
  checkDistribution,
  explainFeatures,
  networkCost,
  PROFILES,
  PROVENANCE_META,
  PROVENANCES,
  RISK_LEVELS,
  topReasons,
  verdictFor,
  weakestProvenance,
} from '../src/index.ts';

const iv = (point: number, low: number, high: number) => ({ point, low, high });

describe('verdictFor — the four risk classes (FR-24, doc 01 §4.2)', () => {
  const budget = { scriptMs: 50 };

  it('low: the whole interval stays under half the budget', () => {
    const v = verdictFor(iv(12, 8, 18), budget);
    expect(v.risk).toBe('low');
    expect(v.budget).toBe('within');
    expect(v.verifyRecommended).toBe(false);
  });

  it('moderate: within budget but using more than half of it', () => {
    const v = verdictFor(iv(35, 30, 44), budget);
    expect(v.risk).toBe('moderate');
    expect(v.budget).toBe('within');
    expect(v.verifyRecommended).toBe(false);
  });

  it('uncertain: the interval straddles the budget, so verification is recommended', () => {
    const v = verdictFor(iv(45, 30, 70), budget);
    expect(v.risk).toBe('uncertain');
    expect(v.budget).toBe('straddles');
    expect(v.verifyRecommended).toBe(true);
    expect(v.reason).toMatch(/cannot tell/i);
  });

  it('high: even the optimistic end is over budget', () => {
    const v = verdictFor(iv(80, 60, 100), budget);
    expect(v.risk).toBe('high');
    expect(v.budget).toBe('over');
    expect(v.verifyRecommended).toBe(false);
  });

  it('uses the interval, not the point estimate — a safe-looking point can still be uncertain', () => {
    // Point estimate 30 ms against a 50 ms budget looks fine; the interval says otherwise.
    expect(verdictFor(iv(30, 10, 80), budget).risk).toBe('uncertain');
    // Same point estimate, tight interval: a real verdict.
    expect(verdictFor(iv(30, 28, 32), budget).risk).toBe('moderate');
  });

  it('covers exactly the four declared risk levels', () => {
    const produced = new Set([
      verdictFor(iv(12, 8, 18), budget).risk,
      verdictFor(iv(35, 30, 44), budget).risk,
      verdictFor(iv(45, 30, 70), budget).risk,
      verdictFor(iv(80, 60, 100), budget).risk,
    ]);
    expect([...produced].sort()).toEqual([...RISK_LEVELS].sort());
  });

  it('treats the boundary at exactly half the budget as moderate, not low', () => {
    expect(verdictFor(iv(20, 10, 25), { scriptMs: 50 }).risk).toBe('moderate');
    expect(verdictFor(iv(20, 10, 24.9), { scriptMs: 50 }).risk).toBe('low');
  });
});

describe('verdictFor without a budget', () => {
  it('calls an interval that includes zero low risk — indistinguishable from noise', () => {
    const v = verdictFor(iv(0.4, -1.2, 2.1), undefined);
    expect(v.risk).toBe('low');
    expect(v.budget).toBe('no-budget');
    expect(v.reason).toMatch(/includes zero/);
  });

  it('calls an interval wider than its own estimate uncertain', () => {
    const v = verdictFor(iv(10, 2, 40), undefined);
    expect(v.risk).toBe('uncertain');
    expect(v.verifyRecommended).toBe(true);
  });

  it('reports a tight non-zero interval as moderate with no verdict', () => {
    const v = verdictFor(iv(10, 9, 11), undefined);
    expect(v.risk).toBe('moderate');
    expect(v.reason).toMatch(/No budget was set/);
  });
});

describe('out-of-distribution handling (FR-25)', () => {
  const bounds = {
    frameworks: ['react', 'vue', 'vanilla'],
    maxCtxDeltaMinBytes: 300_000,
    maxIsoMinBytes: 400_000,
    profileSlowdowns: [1, 4, 10],
  };

  it('flags an unseen framework', () => {
    const r = checkDistribution({ host_framework: 'angular' }, bounds);
    expect(r.outOfDistribution).toBe(true);
    expect(r.reasons[0]).toMatch(/angular/);
  });

  it('flags a byte delta beyond anything seen in training', () => {
    const r = checkDistribution({ ctx_delta_min_bytes: 900_000 }, bounds);
    expect(r.outOfDistribution).toBe(true);
    expect(r.reasons[0]).toMatch(/more than the largest in the training set/);
  });

  it('flags a profile slower than any trained on', () => {
    expect(checkDistribution({ profile_slowdown: 20 }, bounds).outOfDistribution).toBe(true);
    expect(checkDistribution({ profile_slowdown: 10 }, bounds).outOfDistribution).toBe(false);
  });

  it('passes an in-distribution request', () => {
    const r = checkDistribution(
      { host_framework: 'react', ctx_delta_min_bytes: 70_000, iso_min_bytes: 90_000, profile_slowdown: 4 },
      bounds,
    );
    expect(r).toEqual({ outOfDistribution: false, reasons: [] });
  });

  it('forces risk to uncertain and recommends verification, whatever the interval says', () => {
    // An interval that would otherwise be "low" must not be reported as low when OOD.
    const v = verdictFor(iv(5, 4, 6), { scriptMs: 50 }, { outOfDistribution: true });
    expect(v.risk).toBe('uncertain');
    expect(v.verifyRecommended).toBe(true);
    expect(v.reason).toMatch(/outside the range the model was trained on/);
  });
});

describe('networkCost — modelled, never measured (doc 07 §3.4)', () => {
  const mobile = PROFILES['mid-tier-mobile'];

  it('converts brotli bytes to transfer time at the profile bandwidth', () => {
    // 200 kB at 1.6 Mbps ≈ 1000 ms.
    const r = networkCost({ brotliBytes: 200_000, profile: mobile });
    expect(r.ms).toBeCloseTo(1000, 0);
    expect(r.provenance).toBe('modeled');
    expect(r.model).toMatch(/1\.6 Mbps, 150 ms RTT, same chunk/);
  });

  it('adds a round trip per new chunk', () => {
    const same = networkCost({ brotliBytes: 10_000, profile: mobile });
    const extra = networkCost({ brotliBytes: 10_000, profile: mobile, newChunks: 2 });
    expect(extra.ms - same.ms).toBeCloseTo(2 * mobile.network.rttMs, 6);
    expect(extra.model).toMatch(/\+2 round trips/);
  });

  it('is zero for zero bytes in the same chunk', () => {
    expect(networkCost({ brotliBytes: 0, profile: mobile }).ms).toBe(0);
  });

  it('a slower profile costs more for the same bytes', () => {
    const fast = networkCost({ brotliBytes: 50_000, profile: PROFILES.desktop });
    const slow = networkCost({ brotliBytes: 50_000, profile: PROFILES['low-end-mobile'] });
    expect(slow.ms).toBeGreaterThan(fast.ms);
  });
});

describe('provenance', () => {
  it('describes all four kinds', () => {
    for (const p of PROVENANCES) {
      expect(PROVENANCE_META[p].label.length).toBeGreaterThan(0);
      expect(PROVENANCE_META[p].explanation.length).toBeGreaterThan(10);
    }
  });

  it('a derived number is only as trustworthy as its weakest input', () => {
    expect(weakestProvenance(['exact', 'predicted'])).toBe('predicted');
    expect(weakestProvenance(['exact', 'measured'])).toBe('measured');
    expect(weakestProvenance(['predicted', 'modeled'])).toBe('modeled');
    expect(weakestProvenance(['exact'])).toBe('exact');
  });

  it('defaults to the weakest label when there is nothing to go on', () => {
    expect(weakestProvenance([])).toBe('modeled');
  });

  it('attaches provenance to a value', () => {
    expect(attributed(12.5, 'predicted', { unit: 'ms', interval: [8, 18] })).toEqual({
      value: 12.5,
      provenance: 'predicted',
      unit: 'ms',
      interval: [8, 18],
    });
  });
});

describe('explainFeatures — templates over features, never generated prose (doc 04 F22)', () => {
  it('leads with the bytes added in context', () => {
    const r = explainFeatures({ ctx_delta_min_bytes: 71_680 });
    expect(r[0]!.text).toMatch(/Adds 70 KB of minified code/);
    expect(r[0]!.feature).toBe('ctx_delta_min_bytes');
  });

  it('reports the context effect when the app already ships the dependencies', () => {
    const r = explainFeatures({ ctx_delta_min_bytes: 204, ctx_shared_packages: 2, ctx_shared_bytes_saved: 69_796 });
    expect(r.some((x) => /already ships 2 of the packages/.test(x.text))).toBe(true);
    expect(r.some((x) => /saving 68 KB/.test(x.text))).toBe(true);
  });

  it('reports a poor tree-shaking ratio as a percentage a reader can check', () => {
    const r = explainFeatures({ iso_treeshake_ratio: 0.02, iso_min_bytes: 1000 });
    expect(r.some((x) => /Only 2% of the package survives tree-shaking/.test(x.text))).toBe(true);
  });

  it('distinguishes code that runs at import from code that only gets pre-parsed', () => {
    const eager = explainFeatures({ toplevel_calls: 20, toplevel_side_effect_score: 3 });
    expect(eager.some((x) => /Runs work the moment it is imported/.test(x.text))).toBe(true);

    const lazy = explainFeatures({ toplevel_calls: 0, toplevel_side_effect_score: 0, fn_bytes_share_toplevel: 0.05 });
    expect(lazy.some((x) => /only pre-parses it/.test(x.text))).toBe(true);
  });

  it('carries a null millisecond attribution until a trained model provides one', () => {
    for (const r of explainFeatures({ ctx_delta_min_bytes: 71_680, toplevel_calls: 4 })) {
      expect(r.ms).toBeNull();
    }
  });

  it('notes a lazy import as not part of the initial load', () => {
    const r = explainFeatures({ ctx_in_initial_chunk: false });
    expect(r.some((x) => /lazy/.test(x.text))).toBe(true);
  });

  it('returns nothing to say for an empty vector rather than inventing a reason', () => {
    expect(explainFeatures({})).toEqual([]);
  });

  it('caps the list at the top five for the results card (doc 05 UI-2)', () => {
    const many = {
      ctx_delta_min_bytes: 100_000,
      ctx_shared_packages: 2,
      ctx_shared_bytes_saved: 50_000,
      iso_treeshake_ratio: 0.02,
      iso_min_bytes: 100_000,
      toplevel_calls: 5,
      toplevel_side_effect_score: 5,
      pife_count: 3,
      polyfill_signals: 2,
      ctx_dup_versions: 1,
      largest_literal_bytes: 50_000,
      regex_literals: 100,
    };
    expect(explainFeatures(many).length).toBeGreaterThan(5);
    expect(topReasons(many)).toHaveLength(5);
  });
});

describe('adviceFor', () => {
  it('suggests a narrower import when nothing tree-shakes away', () => {
    const a = adviceFor({ iso_treeshake_ratio: 0.98, iso_full_min_bytes: 70_000 });
    expect(a.some((x) => x.type === 'import-style')).toBe(true);
  });

  it('suggests a lazy import for a large block of code that runs nothing at load', () => {
    const a = adviceFor({ ctx_in_initial_chunk: true, toplevel_calls: 0, ctx_delta_min_bytes: 80_000 });
    expect(a.some((x) => x.type === 'placement' && /dynamic import\(\)/.test(x.text))).toBe(true);
  });

  it('suggests the native Intl API for date libraries', () => {
    const a = adviceFor({ intl_refs: 0 }, { packageName: 'moment' });
    expect(a.some((x) => x.type === 'native' && /Intl\.DateTimeFormat/.test(x.text))).toBe(true);
  });

  it('flags a duplicate version as something to align', () => {
    expect(adviceFor({ ctx_dup_versions: 1 }).some((x) => x.type === 'duplicate')).toBe(true);
  });

  it('warns about WebAssembly compile cost', () => {
    expect(adviceFor({ pkg_has_wasm: true }).some((x) => x.type === 'alternative')).toBe(true);
  });

  it('says nothing when there is nothing to advise', () => {
    expect(adviceFor({})).toEqual([]);
  });
});
