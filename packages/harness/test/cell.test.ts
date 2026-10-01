import { describe, expect, it } from 'vitest';
import { byteDelta, type BuildResult, type OutputFileInfo } from '../src/build.ts';
import { cellCpuRate, checkValidity } from '../src/cell.ts';
import type { ImportSpec } from '../src/importSpec.ts';
import type { MachineRecord } from '../src/machine.ts';

/** Minimal BuildResult: only the fields the byte-delta and validity rules read. */
function fakeBuild(opts: {
  minBytes: number;
  packages?: [string, number][];
  outputs?: Pick<OutputFileInfo, 'path' | 'minBytes' | 'initial'>[];
}): BuildResult {
  return {
    key: 'k',
    distDir: 'dist',
    workDir: 'w',
    host: { name: 'h', framework: 'vanilla', entry: 'src/main.js', html: 'index.html' },
    hostFingerprint: 'fp',
    spec: null,
    deps: {},
    resolvedDeps: {},
    bundler: 'vite',
    bundlerVersion: '7.0.0',
    initial: { minBytes: opts.minBytes, gzipBytes: opts.minBytes, brotliBytes: opts.minBytes },
    outputs: (opts.outputs ?? [{ path: 'dist/index.js', minBytes: opts.minBytes, initial: true }]).map((o) => ({
      ...o,
      gzipBytes: o.minBytes,
      brotliBytes: o.minBytes,
    })),
    packages: (opts.packages ?? []).map(([name, bytesInOutput]) => ({ name, bytesInOutput })),
    modules: opts.packages?.length ?? 0,
    buildMs: 1,
    installMs: 1,
    cached: false,
  };
}

const spec = (code: string, placement?: 'initial' | 'lazy'): ImportSpec => ({ code, ...(placement ? { placement } : {}) });

describe('cell validity (FR-34)', () => {
  it('accepts a treatment that really adds the package', () => {
    const base = fakeBuild({ minBytes: 1000, packages: [['(app)', 1000]] });
    const treat = fakeBuild({ minBytes: 5000, packages: [['(app)', 1000], ['dayjs', 4000]] });
    const delta = byteDelta(base, treat);
    expect(checkValidity(spec("import dayjs from 'dayjs'"), base, treat, delta).valid).toBe(true);
    expect(delta.newPackages).toEqual(['dayjs']);
  });

  it('rejects a zero-byte delta instead of labelling it 0 ms', () => {
    const base = fakeBuild({ minBytes: 1000, packages: [['(app)', 1000]] });
    const v = checkValidity(spec("import x from 'empty-pkg'"), base, base, byteDelta(base, base));
    expect(v.valid).toBe(false);
    expect(v.reason).toBe('zero-byte-delta');
  });

  it('rejects a treatment where none of the requested packages reached the bundle', () => {
    const base = fakeBuild({ minBytes: 1000, packages: [['(app)', 1000]] });
    // Bytes grew, but only app code did — the package itself is not in the output.
    const treat = fakeBuild({ minBytes: 1200, packages: [['(app)', 1200]] });
    const v = checkValidity(spec("import x from 'ghost'"), base, treat, byteDelta(base, treat));
    expect(v.valid).toBe(false);
    expect(v.reason).toBe('package-absent');
  });

  it('accepts a multi-package spec when at least one package shipped (re-exports)', () => {
    const base = fakeBuild({ minBytes: 1000, packages: [['(app)', 1000]] });
    const treat = fakeBuild({ minBytes: 3000, packages: [['(app)', 1000], ['a', 2000]] });
    const code = "import A from 'a'\nimport B from 'b'";
    expect(checkValidity(spec(code), base, treat, byteDelta(base, treat)).valid).toBe(true);
  });

  it('A/A sessions are always valid — identical builds are the point', () => {
    const base = fakeBuild({ minBytes: 1000 });
    expect(checkValidity(null, base, base, byteDelta(base, base)).valid).toBe(true);
  });

  describe('lazy placement', () => {
    const base = fakeBuild({
      minBytes: 1000,
      packages: [['(app)', 1000]],
      outputs: [{ path: 'dist/index.js', minBytes: 1000, initial: true }],
    });

    it('is valid when the package landed in a non-initial chunk', () => {
      const treat = fakeBuild({
        minBytes: 1050,
        packages: [['(app)', 1050]],
        outputs: [
          { path: 'dist/index.js', minBytes: 1050, initial: true },
          { path: 'dist/lazy.js', minBytes: 70000, initial: false },
        ],
      });
      expect(checkValidity(spec("import('lodash')", 'lazy'), base, treat, byteDelta(base, treat)).valid).toBe(true);
    });

    it('is rejected when the bundler inlined the dynamic import', () => {
      const treat = fakeBuild({
        minBytes: 71000,
        packages: [['(app)', 1000], ['lodash', 70000]],
        outputs: [{ path: 'dist/index.js', minBytes: 71000, initial: true }],
      });
      const v = checkValidity(spec("import('lodash')", 'lazy'), base, treat, byteDelta(base, treat));
      expect(v.valid).toBe(false);
      expect(v.reason).toBe('lazy-not-split');
    });
  });
});

describe('byteDelta context fields', () => {
  it('separates packages new to the app from ones it already ships', () => {
    const base = fakeBuild({ minBytes: 5000, packages: [['(app)', 1000], ['react', 4000]] });
    const treat = fakeBuild({ minBytes: 9000, packages: [['(app)', 1000], ['react', 4000], ['recharts', 4000]] });
    const iso = fakeBuild({ minBytes: 8000, packages: [['react', 4000], ['recharts', 4000]] });
    const delta = byteDelta(base, treat, iso);
    expect(delta.newPackages).toEqual(['recharts']);
    expect(delta.sharedPackages).toEqual(['react']);
    expect(delta.minBytes).toBe(4000);
  });
});

describe('profile → rate resolution for a cell', () => {
  const machine = { calibration: { '1': 20, '2': 50, '4': 120 } } as unknown as MachineRecord;

  it('prefers an explicit rate, then the machine curve, then the raw target', () => {
    expect(cellCpuRate({ cpuRate: 3, profile: 'mid-tier-mobile', machine })).toBe(3);
    // 4× of 20 ms = 80 ms, between rate 2 (50) and rate 4 (120).
    const resolved = cellCpuRate({ profile: 'mid-tier-mobile', machine });
    expect(resolved).toBeGreaterThan(2);
    expect(resolved).toBeLessThan(4);
    // Without a machine reference we fall back to the nominal target.
    expect(cellCpuRate({ profile: 'mid-tier-mobile' })).toBe(4);
    expect(cellCpuRate({})).toBe(1);
  });
});
