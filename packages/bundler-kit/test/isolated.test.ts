/**
 * Isolated builds and metafile analysis (doc 08 §3, feature groups G2/G3).
 *
 * The integration cases install from `research/fixtures/packages` with `file:` specifiers, so they
 * need no network and no registry — the synthetic fixtures are the whole point: we know exactly
 * what is in them, so we can assert on the numbers rather than merely on the shape.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sizesOf, subSizes, ZERO_SIZES } from '../src/compress.ts';
import { INSTALL_ARGS } from '../src/install.ts';
import { isolatedBuild, isolatedEntry, isolatedMetrics, ISO_TARGET } from '../src/isolated.ts';
import { APP_PACKAGE, breakdown, diffMetafiles, initialOutputs, packageOfPath } from '../src/metafile.ts';
import type { Metafile } from 'esbuild';

const FIXTURES = resolve(import.meta.dirname, '../../../research/fixtures/packages');
const fixtureDep = (name: string) => ({ [`@deplens/${name}`]: `file:${join(FIXTURES, name)}` });

describe('compress — fixed settings (doc 07 §2.4)', () => {
  it('reports minified, gzip and brotli bytes for the same input', () => {
    const s = sizesOf('x'.repeat(10_000));
    expect(s.minBytes).toBe(10_000);
    // Highly repetitive input must compress far below its raw size at these levels.
    expect(s.gzipBytes).toBeLessThan(200);
    expect(s.brotliBytes).toBeLessThan(200);
  });

  it('is deterministic — the same bytes twice give the same three numbers', () => {
    expect(sizesOf('hello deplens')).toEqual(sizesOf('hello deplens'));
  });

  it('treats a string and its utf-8 buffer identically', () => {
    expect(sizesOf('héllo')).toEqual(sizesOf(Buffer.from('héllo', 'utf8')));
  });

  it('subtracts sizes field by field', () => {
    expect(subSizes({ minBytes: 10, gzipBytes: 5, brotliBytes: 4 }, { minBytes: 3, gzipBytes: 2, brotliBytes: 1 })).toEqual({
      minBytes: 7,
      gzipBytes: 3,
      brotliBytes: 3,
    });
    expect(subSizes(ZERO_SIZES, ZERO_SIZES)).toEqual(ZERO_SIZES);
  });
});

describe('install safety (hard rule 2)', () => {
  it('always passes --ignore-scripts', () => {
    expect(INSTALL_ARGS).toContain('--ignore-scripts');
  });

  it('asks for devDependencies explicitly, because a Vite build may have set NODE_ENV=production', () => {
    expect(INSTALL_ARGS).toContain('--include=dev');
  });
});

describe('packageOfPath', () => {
  it.each([
    ['node_modules/lodash/lodash.js', 'lodash'],
    ['node_modules/@scope/thing/index.js', '@scope/thing'],
    ['a/node_modules/b/node_modules/c/index.js', 'c'],
    ['node_modules\\lodash\\lodash.js', 'lodash'],
    ['src/main.ts', null],
  ])('%s -> %s', (path, expected) => {
    expect(packageOfPath(path)).toBe(expected);
  });

  it('returns null for a scope with no package name', () => {
    expect(packageOfPath('node_modules/@scope')).toBeNull();
  });
});

describe('isolatedEntry', () => {
  it('spec mode reuses the harness injection block, so bytes stay comparable', () => {
    const entry = isolatedEntry({ code: "import { format } from 'date-fns'" }, 'spec');
    expect(entry).toContain("import { format } from 'date-fns'");
    expect(entry).toContain('globalThis.__DL_SINK__ = [format]');
  });

  it('namespace mode imports the whole package, Bundlephobia-style', () => {
    const entry = isolatedEntry({ code: "import { format } from 'date-fns'" }, 'namespace');
    expect(entry).toContain('import * as __ns0 from "date-fns"');
    expect(entry).not.toContain('{ format }');
  });

  it('namespace mode covers every package in a multi-import spec', () => {
    const entry = isolatedEntry({ code: "import a from 'aaa'\nimport b from 'bbb'" }, 'namespace');
    expect(entry).toContain('from "aaa"');
    expect(entry).toContain('from "bbb"');
    expect(entry).toContain('= [__ns0, __ns1]');
  });

  it('refuses a spec that references no npm package', () => {
    expect(() => isolatedEntry({ code: "import './local.js'" }, 'namespace')).toThrow(/references no npm package/);
  });
});

/** A hand-built metafile: one entry chunk, one static import, one dynamic chunk. */
const META: Metafile = {
  inputs: {
    'entry.js': { bytes: 100, imports: [] },
    'node_modules/dep/index.js': { bytes: 500, imports: [], format: 'cjs' },
    'node_modules/esm-dep/index.js': { bytes: 300, imports: [], format: 'esm' },
    'node_modules/lazy/index.js': { bytes: 900, imports: [] },
  },
  outputs: {
    'out/entry.js': {
      imports: [
        { path: 'out/shared.js', kind: 'import-statement', external: false },
        { path: 'out/lazy.js', kind: 'dynamic-import', external: false },
      ],
      exports: [],
      entryPoint: 'entry.js',
      inputs: { 'entry.js': { bytesInOutput: 100 }, 'node_modules/dep/index.js': { bytesInOutput: 500 } },
      bytes: 600,
    },
    'out/shared.js': {
      imports: [],
      exports: [],
      inputs: { 'node_modules/esm-dep/index.js': { bytesInOutput: 300 } },
      bytes: 300,
    },
    'out/lazy.js': {
      imports: [],
      exports: [],
      inputs: { 'node_modules/lazy/index.js': { bytesInOutput: 900 } },
      bytes: 900,
    },
  },
};

describe('metafile analysis', () => {
  it('follows static imports into the initial load and excludes dynamic ones', () => {
    expect(initialOutputs(META)).toEqual(new Set(['out/entry.js', 'out/shared.js']));
  });

  it('attributes initial bytes per package and keeps app code separate', () => {
    const b = breakdown(META);
    expect(b.packageBytes.get('dep')).toBe(500);
    expect(b.packageBytes.get('esm-dep')).toBe(300);
    expect(b.packageBytes.get(APP_PACKAGE)).toBe(100);
    // The lazily imported package is not part of the initial load at all.
    expect(b.packageBytes.has('lazy')).toBe(false);
  });

  it('counts modules and chunks of the initial load only', () => {
    const b = breakdown(META);
    expect(b.modules).toBe(3);
    expect(b.initialChunks).toBe(2);
    expect(b.lazyBytes).toBe(900);
  });

  it('computes the CJS byte share from the metafile format field', () => {
    // 500 of 900 initial bytes are CJS.
    expect(breakdown(META).cjsByteShare).toBeCloseTo(500 / 900, 10);
  });

  it('reports a zero CJS share rather than NaN for an empty bundle', () => {
    expect(breakdown({ inputs: {}, outputs: {} }).cjsByteShare).toBe(0);
  });

  it('separates packages the baseline already shipped (shared) from genuinely new ones', () => {
    const baseline: Metafile = {
      inputs: { 'entry.js': { bytes: 10, imports: [] }, 'node_modules/esm-dep/index.js': { bytes: 300, imports: [] } },
      outputs: {
        'out/entry.js': {
          imports: [],
          exports: [],
          entryPoint: 'entry.js',
          inputs: { 'entry.js': { bytesInOutput: 10 }, 'node_modules/esm-dep/index.js': { bytesInOutput: 300 } },
          bytes: 310,
        },
      },
    };
    const diff = diffMetafiles(baseline, META, ['dep', 'esm-dep']);
    expect(diff.added).toEqual(['dep']);
    expect(diff.shared).toEqual(['esm-dep']);
    expect(diff.deltaModules).toBe(1);
    expect(diff.deltaChunks).toBe(1);
  });

  it('reports a package whose byte contribution grew', () => {
    const baseline: Metafile = {
      inputs: { 'entry.js': { bytes: 10, imports: [] }, 'node_modules/dep/index.js': { bytes: 100, imports: [] } },
      outputs: {
        'out/entry.js': {
          imports: [],
          exports: [],
          entryPoint: 'entry.js',
          inputs: { 'entry.js': { bytesInOutput: 100 }, 'node_modules/dep/index.js': { bytesInOutput: 200 } },
          bytes: 300,
        },
      },
    };
    expect(diffMetafiles(baseline, META, ['dep']).grew).toEqual([{ name: 'dep', deltaBytes: 300 }]);
  });
});

describe('isolatedBuild (integration, local fixtures only)', () => {
  let workRoot: string;

  beforeAll(async () => {
    workRoot = await mkdtemp(join(tmpdir(), 'deplens-bk-'));
  });

  afterAll(async () => {
    await rm(workRoot, { recursive: true, force: true }).catch(() => {});
  });

  it('bundles a fixture package alone and reports its three byte sizes', async () => {
    const build = await isolatedBuild({
      spec: { code: "import { all } from '@deplens/bytes-50'" },
      deps: fixtureDep('bytes-50'),
      workRoot,
    });
    expect(build.sizes.minBytes).toBeGreaterThan(0);
    expect(build.sizes.brotliBytes).toBeLessThan(build.sizes.minBytes);
    expect(build.packages).toEqual(['@deplens/bytes-50']);
    expect(build.resolvedDeps['@deplens/bytes-50']).toBe('1.0.0');
    expect(build.esbuildVersion).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('a bigger fixture produces a bigger isolated bundle (monotone in the payload)', async () => {
    const small = await isolatedBuild({
      spec: { code: "import { all } from '@deplens/bytes-50'" },
      deps: fixtureDep('bytes-50'),
      workRoot,
    });
    const big = await isolatedBuild({
      spec: { code: "import { all } from '@deplens/bytes-400'" },
      deps: fixtureDep('bytes-400'),
      workRoot,
    });
    expect(big.sizes.minBytes).toBeGreaterThan(small.sizes.minBytes);
  });

  it('marking a package external removes its bytes from the bundle', async () => {
    const withDep = await isolatedBuild({
      spec: { code: "import { all } from '@deplens/bytes-400'" },
      deps: fixtureDep('bytes-400'),
      workRoot,
    });
    const external = await isolatedBuild({
      spec: { code: "import { all } from '@deplens/bytes-400'" },
      deps: fixtureDep('bytes-400'),
      workRoot,
      external: ['@deplens/bytes-400'],
      reuseDir: withDep.workDir,
    });
    expect(external.sizes.minBytes).toBeLessThan(withDep.sizes.minBytes / 10);
    expect(external.packages).toEqual([]);
  });

  it('isolatedMetrics produces the whole G2 group plus unminified added code', async () => {
    const m = await isolatedMetrics({
      spec: { code: "import { all } from '@deplens/eager-100'" },
      deps: fixtureDep('eager-100'),
      workRoot,
    });
    expect(m.iso_min_bytes).toBeGreaterThan(0);
    expect(m.iso_gz_bytes).toBeGreaterThan(0);
    expect(m.iso_br_bytes).toBeGreaterThan(0);
    expect(m.iso_full_min_bytes).toBeGreaterThan(0);
    expect(m.iso_treeshake_ratio).toBeGreaterThan(0);
    expect(m.iso_modules).toBeGreaterThan(0);
    expect(m.iso_packages).toBe(1);
    expect(m.iso_cjs_byte_share).toBe(0); // the fixtures are ESM
    expect(m.candidatePackages).toEqual(['@deplens/eager-100']);
    // The added code is the unminified build, so it still carries readable structure for the AST pass.
    expect(m.addedCode.length).toBeGreaterThan(m.iso_min_bytes);
    expect(m.manifests['@deplens/eager-100']).toMatchObject({ name: '@deplens/eager-100', version: '1.0.0' });
  });

  it('isolatedMetrics drops shared packages from the added code but not from the byte features', async () => {
    const spec = { code: "import { all } from '@deplens/bytes-400'" };
    const deps = fixtureDep('bytes-400');
    const fresh = await isolatedMetrics({ spec, deps, workRoot });
    const shared = await isolatedMetrics({ spec, deps, workRoot, sharedPackages: ['@deplens/bytes-400'] });

    // Byte features describe the candidate itself, so they are unchanged...
    expect(shared.iso_min_bytes).toBe(fresh.iso_min_bytes);
    // ...while the added code collapses, because the app already ships that package.
    expect(shared.addedCode.length).toBeLessThan(fresh.addedCode.length / 10);
  });

  it('refuses to emit a zero-byte build when a requested package is missing', async () => {
    await expect(
      isolatedBuild({
        spec: { code: "import x from '@deplens/does-not-exist-xyz'" },
        deps: { '@deplens/does-not-exist-xyz': `file:${join(FIXTURES, 'no-such-fixture')}` },
        workRoot,
      }),
    ).rejects.toThrow();
  });

  it('builds at the pinned target so bytes are comparable across cells', () => {
    expect(ISO_TARGET).toBe('es2020');
  });
});
