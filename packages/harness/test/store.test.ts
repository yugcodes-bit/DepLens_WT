import { describe, expect, it } from 'vitest';
import { cellKey } from '../src/store.ts';

/**
 * `cellKey` is what lets a killed campaign resume without re-measuring or double-counting
 * (FR-51), so it must depend on everything that changes the measurement and on nothing else.
 */
const base = {
  hostDir: 'D:/repo/research/hosts/react',
  spec: { code: "import { format } from 'date-fns'" },
  deps: { 'date-fns': '4.1.0' },
  profile: 'mid-tier-mobile' as const,
  cpuRate: undefined,
  pairs: 10,
  seed: 1,
};

describe('cellKey', () => {
  it('is stable for the same cell', () => {
    expect(cellKey(base)).toBe(cellKey({ ...base }));
  });

  it('ignores how the host path was written and irrelevant whitespace', () => {
    expect(cellKey({ ...base, hostDir: 'research/hosts/react' })).toBe(cellKey(base));
    expect(cellKey({ ...base, spec: { code: "  import { format } from 'date-fns'  " } })).toBe(cellKey(base));
    // Dependency order is not part of the cell's identity.
    expect(cellKey({ ...base, deps: { a: '1', b: '2' } })).toBe(cellKey({ ...base, deps: { b: '2', a: '1' } }));
  });

  it('changes when anything that changes the measurement changes', () => {
    const variants = [
      { ...base, hostDir: 'research/hosts/vue' },
      { ...base, spec: { code: "import * as d from 'date-fns'" } },
      { ...base, spec: { ...base.spec, placement: 'lazy' as const } },
      { ...base, spec: { ...base.spec, sink: 'globalThis.x' } },
      { ...base, deps: { 'date-fns': '3.0.0' } },
      { ...base, profile: 'desktop' as const },
      { ...base, cpuRate: 4 },
      { ...base, pairs: 8 },
      { ...base, seed: 2 },
      { ...base, spec: null },
    ];
    const keys = new Set(variants.map(cellKey));
    expect(keys.size).toBe(variants.length);
    expect(keys.has(cellKey(base))).toBe(false);
  });

  it('is a short hex digest', () => {
    expect(cellKey(base)).toMatch(/^[0-9a-f]{20}$/);
  });
});
