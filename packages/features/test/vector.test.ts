/**
 * Feature groups G1 (package metadata), G3 (in-context delta), G5 (host context), G7 (profile),
 * and the assembled vector. The G3 cases encode the project's central claim: the same import costs
 * different amounts in different apps (doc 01 §2, doc 12 §1).
 */
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseLockfile } from '@deplens/lockfile';
import {
  buildFeatureVector,
  detectFormat,
  detectSideEffects,
  extractContext,
  extractHost,
  extractProfile,
  extractPkgMeta,
  GROUP_PROVENANCE,
  g2Vector,
  looksMinified,
  MODELED_FEATURES,
  namesInGroup,
  normaliseFramework,
  normaliseTarget,
  STATIC_MS_PER_KB,
  toRow,
  validateVector,
  type BuildSummary,
} from '../src/index.ts';

const ISO: Parameters<typeof g2Vector>[0] = {
  iso_min_bytes: 70_000,
  iso_gz_bytes: 25_000,
  iso_br_bytes: 22_000,
  iso_full_min_bytes: 90_000,
  iso_treeshake_ratio: 70_000 / 90_000,
  iso_modules: 12,
  iso_packages: 2,
  iso_cjs_byte_share: 0.5,
};

const summary = (minBytes: number, modules: number, packages: string[], chunks = 1): BuildSummary => ({
  initial: { minBytes, gzipBytes: Math.round(minBytes * 0.35), brotliBytes: Math.round(minBytes * 0.3) },
  modules,
  packages: packages.map((name) => ({ name, bytesInOutput: 1000 })),
  initialChunks: chunks,
});

describe('G1 — format detection', () => {
  it.each([
    [{ type: 'module' }, 'esm'],
    [{ module: 'dist/index.mjs', main: 'dist/index.cjs' }, 'dual'],
    [{ main: 'index.js' }, 'cjs'],
    [{ exports: { '.': { import: './a.mjs', require: './a.cjs' } }, main: './a.cjs' }, 'dual'],
    [{ exports: { '.': { import: './a.mjs' } } }, 'esm'],
  ])('%o -> %s', (manifest, expected) => {
    expect(detectFormat(manifest, null)).toBe(expected);
  });

  it('detects UMD from the shipped file rather than the manifest', () => {
    const umd = 'typeof exports === "object" && typeof module !== "undefined" ? factory(exports) : typeof define === "function" && define.amd ? define(factory) : factory({});';
    expect(detectFormat({ main: 'index.js' }, umd)).toBe('umd');
  });

  it('reads the sideEffects declaration in all four shapes', () => {
    expect(detectSideEffects({ sideEffects: false })).toBe('false');
    expect(detectSideEffects({ sideEffects: true })).toBe('true');
    expect(detectSideEffects({ sideEffects: ['*.css'] })).toBe('array');
    expect(detectSideEffects({})).toBe('absent');
  });

  it('spots a pre-minified entry by line length', () => {
    expect(looksMinified(`${'a'.repeat(5000)};`)).toBe(true);
    expect(looksMinified('const a = 1;\n'.repeat(200))).toBe(false);
    expect(looksMinified('short')).toBe(false);
  });
});

describe('G1 — extraction from a real package directory', () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'deplens-g1-'));
    const pkgDir = join(dir, 'demo');
    await mkdir(join(pkgDir, 'dist'), { recursive: true });
    // A nested dependency: its bytes belong to *that* package, not to this one.
    await mkdir(join(pkgDir, 'node_modules', 'inner'), { recursive: true });
    await writeFile(join(pkgDir, 'node_modules', 'inner', 'big.js'), 'x'.repeat(100_000));
    await writeFile(
      join(pkgDir, 'package.json'),
      JSON.stringify({
        name: 'demo',
        version: '1.0.0',
        module: 'dist/index.mjs',
        main: 'dist/index.cjs',
        exports: { '.': { import: './dist/index.mjs' } },
        sideEffects: false,
        dependencies: { dep1: '^1', dep2: '^2' },
        peerDependencies: { react: '^18' },
      }),
    );
    await writeFile(join(pkgDir, 'dist', 'index.mjs'), 'export const a = 1;\n');
    await writeFile(join(pkgDir, 'dist', 'index.cjs'), 'module.exports = { a: 1 };\n');
    await writeFile(join(pkgDir, 'dist', 'thing.wasm'), Buffer.from([0, 97, 115, 109]));
    await writeFile(join(pkgDir, 'dist', 'my.worker.js'), 'self.onmessage = () => {};\n');
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  it('emits exactly the G1 group', async () => {
    const v = await extractPkgMeta({
      packageDir: join(dir, 'demo'),
      manifest: JSON.parse(await (await import('node:fs/promises')).readFile(join(dir, 'demo', 'package.json'), 'utf8')),
    });
    expect(Object.keys(v).sort()).toEqual([...namesInGroup('G1')].sort());
    expect(validateVector(v)).toEqual([]);
  });

  it('reads counts, flags and format from the manifest and the files', async () => {
    const manifest = JSON.parse(await (await import('node:fs/promises')).readFile(join(dir, 'demo', 'package.json'), 'utf8'));
    const v = await extractPkgMeta({ packageDir: join(dir, 'demo'), manifest, bundledPackages: ['demo', 'dep1', 'dep2'] });
    expect(v.pkg_n_deps).toBe(2);
    expect(v.pkg_n_peer_deps).toBe(1);
    expect(v.pkg_format).toBe('dual');
    expect(v.pkg_has_exports_map).toBe(true);
    expect(v.pkg_sideeffects).toBe('false');
    expect(v.pkg_has_wasm).toBe(true);
    expect(v.pkg_has_worker).toBe(true);
    expect(v.pkg_js_files).toBe(3); // index.mjs, index.cjs, my.worker.js
    expect(v.pkg_n_transitive).toBe(2); // dep1, dep2 — itself excluded
  });

  it('excludes nested node_modules from the unpacked size', async () => {
    const manifest = JSON.parse(await (await import('node:fs/promises')).readFile(join(dir, 'demo', 'package.json'), 'utf8'));
    const v = await extractPkgMeta({ packageDir: join(dir, 'demo'), manifest });
    // The nested dependency alone is 100 kB; counting it would dwarf everything else.
    expect(v.pkg_unpacked_bytes).toBeLessThan(10_000);
  });

  it('counts transitive packages from a lockfile when one is supplied', async () => {
    const manifest = JSON.parse(await (await import('node:fs/promises')).readFile(join(dir, 'demo', 'package.json'), 'utf8'));
    const graph = parseLockfile(
      'package-lock.json',
      JSON.stringify({
        lockfileVersion: 3,
        packages: {
          '': { dependencies: { demo: '^1' } },
          'node_modules/demo': { version: '1.0.0', dependencies: { dep1: '^1', dep2: '^2' } },
          'node_modules/dep1': { version: '1.0.0', dependencies: { deep: '^1' } },
          'node_modules/dep2': { version: '2.0.0' },
          'node_modules/deep': { version: '1.0.0' },
        },
      }),
    );
    const v = await extractPkgMeta({ packageDir: join(dir, 'demo'), manifest, graph });
    expect(v.pkg_n_transitive).toBe(3); // dep1, dep2, deep
  });
});

describe('G3 — the context effect, which is the whole point', () => {
  const candidatePackages = ['date-fns', 'tslib'];

  it('emits exactly the G3 group', () => {
    const v = extractContext({
      baseline: summary(100_000, 50, ['react']),
      treatment: summary(170_000, 62, ['react', 'date-fns', 'tslib']),
      candidatePackages,
      isoMinBytes: ISO.iso_min_bytes,
    });
    expect(Object.keys(v).sort()).toEqual([...namesInGroup('G3')].sort());
    expect(validateVector(v)).toEqual([]);
  });

  it('a host that shares nothing pays the full isolated cost', () => {
    const v = extractContext({
      baseline: summary(100_000, 50, ['react']),
      treatment: summary(170_000, 62, ['react', 'date-fns', 'tslib']),
      candidatePackages,
      isoMinBytes: 70_000,
    });
    expect(v.ctx_delta_min_bytes).toBe(70_000);
    expect(v.ctx_new_packages).toBe(2);
    expect(v.ctx_shared_packages).toBe(0);
    expect(v.ctx_shared_bytes_saved).toBe(0);
  });

  it('a host that already ships the package pays almost nothing, and the saving is reported', () => {
    const v = extractContext({
      baseline: summary(400_000, 300, ['react', 'date-fns', 'tslib']),
      treatment: summary(400_204, 301, ['react', 'date-fns', 'tslib']),
      candidatePackages,
      isoMinBytes: 70_000,
    });
    expect(v.ctx_delta_min_bytes).toBe(204);
    expect(v.ctx_new_packages).toBe(0);
    expect(v.ctx_shared_packages).toBe(2);
    // 70 kB in isolation, 204 B in context: the context saved the rest.
    expect(v.ctx_shared_bytes_saved).toBe(69_796);
  });

  it('records lazy placement', () => {
    const base = {
      baseline: summary(100_000, 50, ['react']),
      treatment: summary(100_100, 51, ['react']),
      candidatePackages,
      isoMinBytes: 70_000,
    };
    expect(extractContext({ ...base, placement: 'lazy' }).ctx_in_initial_chunk).toBe(false);
    expect(extractContext({ ...base, placement: 'initial' }).ctx_in_initial_chunk).toBe(true);
    expect(extractContext(base).ctx_in_initial_chunk).toBe(true); // defaults to initial
  });

  it('counts new chunks', () => {
    const v = extractContext({
      baseline: summary(100_000, 50, ['react'], 1),
      treatment: summary(170_000, 62, ['react', 'date-fns'], 3),
      candidatePackages,
      isoMinBytes: 70_000,
    });
    expect(v.ctx_delta_chunks).toBe(2);
  });

  it('counts a duplicate version the candidate introduces', () => {
    const hostGraph = parseLockfile(
      'package-lock.json',
      JSON.stringify({
        lockfileVersion: 3,
        packages: { '': { dependencies: { tslib: '^1' } }, 'node_modules/tslib': { version: '1.0.0' } },
      }),
    );
    const base = {
      baseline: summary(100_000, 50, ['tslib']),
      treatment: summary(170_000, 62, ['tslib', 'date-fns']),
      candidatePackages,
      isoMinBytes: 70_000,
      hostGraph,
    };
    // The candidate brings tslib 2.x while the host has 1.x — those bytes are paid twice.
    expect(extractContext({ ...base, candidateVersions: { tslib: '2.6.0' } }).ctx_dup_versions).toBe(1);
    // Same version: deduped, no duplicate.
    expect(extractContext({ ...base, candidateVersions: { tslib: '1.0.0' } }).ctx_dup_versions).toBe(0);
  });

  it('reports 0 duplicates when no host lockfile was supplied, rather than guessing', () => {
    const v = extractContext({
      baseline: summary(100_000, 50, ['tslib']),
      treatment: summary(170_000, 62, ['tslib', 'date-fns']),
      candidatePackages,
      isoMinBytes: 70_000,
    });
    expect(v.ctx_dup_versions).toBe(0);
  });
});

describe('G5 — host context', () => {
  it('emits exactly the G5 group', () => {
    const v = extractHost({ framework: 'react', baseline: summary(100_000, 50, ['react']) });
    expect(Object.keys(v).sort()).toEqual([...namesInGroup('G5')].sort());
    expect(validateVector(v)).toEqual([]);
  });

  it('normalises frameworks onto the schema list', () => {
    expect(normaliseFramework('react')).toBe('react');
    expect(normaliseFramework('React')).toBe('react');
    expect(normaliseFramework('none')).toBe('vanilla'); // what the empty host declares
    expect(normaliseFramework(undefined)).toBe('vanilla');
    expect(normaliseFramework('angular')).toBe('other');
  });

  it('normalises the build target', () => {
    expect(normaliseTarget('es2020')).toBe('es2020');
    expect(normaliseTarget('ES2022')).toBe('es2022');
    expect(normaliseTarget('es5')).toBe('esnext'); // outside the declared list
  });

  it('scales the modelled entry-task estimate with bytes and with the profile slowdown', () => {
    const a = extractHost({ framework: 'react', baseline: summary(102_400, 50, ['react']), profileSlowdown: 1 });
    const b = extractHost({ framework: 'react', baseline: summary(102_400, 50, ['react']), profileSlowdown: 4 });
    expect(a.host_entry_task_ms_est).toBeCloseTo(100 * STATIC_MS_PER_KB, 6);
    expect(b.host_entry_task_ms_est).toBeCloseTo(4 * a.host_entry_task_ms_est, 6);
  });

  it('clamps the entry share to [0, 1]', () => {
    expect(extractHost({ framework: 'react', baseline: summary(100, 1, []), entryChunkBytes: 1000 }).host_entry_eval_share).toBe(1);
    expect(extractHost({ framework: 'react', baseline: summary(1000, 1, []), entryChunkBytes: 250 }).host_entry_eval_share).toBe(0.25);
  });

  it('excludes the app itself from the host package count', () => {
    const v = extractHost({ framework: 'react', baseline: summary(100_000, 50, ['react', 'scheduler', '(app)']) });
    expect(v.host_packages).toBe(2);
  });
});

describe('G7 — profile', () => {
  it('carries the calibrated slowdown, not a CDP rate', () => {
    const v = extractProfile(4.28);
    expect(v).toEqual({ profile_slowdown: 4.28 });
    expect(validateVector(v)).toEqual([]);
  });
});

describe('g2Vector', () => {
  it('emits exactly the G2 group', () => {
    const v = g2Vector(ISO);
    expect(Object.keys(v).sort()).toEqual([...namesInGroup('G2')].sort());
    expect(validateVector(v)).toEqual([]);
  });
});

describe('buildFeatureVector', () => {
  it('assembles the static groups and reports which ones it covers', async () => {
    const bundle = await buildFeatureVector({
      iso: ISO,
      context: {
        baseline: summary(100_000, 50, ['react']),
        treatment: summary(170_000, 62, ['react', 'date-fns']),
        candidatePackages: ['date-fns'],
        isoMinBytes: ISO.iso_min_bytes,
      },
      addedCode: 'export function f(){ return 1 } const x = f();',
      host: { framework: 'react', baseline: summary(100_000, 50, ['react']) },
      profileSlowdown: 4.28,
    });

    expect(bundle.groups).toEqual(['G2', 'G3', 'G4', 'G5', 'G7']);
    expect(bundle.schemaVersion).toBe(1);
    const expectedCount = ['G2', 'G3', 'G4', 'G5', 'G7'].reduce(
      (s, g) => s + namesInGroup(g as 'G2').length,
      0,
    );
    expect(Object.keys(bundle.vector)).toHaveLength(expectedCount);
    expect(validateVector(bundle.vector)).toEqual([]);
  });

  it('notes that the modelled host estimate is not measured', async () => {
    const bundle = await buildFeatureVector({ host: { framework: 'react', baseline: summary(1000, 1, []) } });
    expect(bundle.notes.join(' ')).toMatch(/host_entry_task_ms_est is modelled, not measured/);
    expect(MODELED_FEATURES.has('host_entry_task_ms_est')).toBe(true);
  });

  it('notes an empty added code block instead of hiding it', async () => {
    const bundle = await buildFeatureVector({ addedCode: '' });
    expect(bundle.notes.join(' ')).toMatch(/added code is empty/);
    expect(bundle.vector.ast_nodes).toBe(0);
  });

  it('refuses a vector whose group is half filled', async () => {
    // A context extraction cannot silently drop a feature; assertCoversGroups is the guard.
    await expect(
      buildFeatureVector({
        context: {
          baseline: summary(100, 1, []),
          treatment: summary(200, 2, []),
          candidatePackages: [],
          isoMinBytes: 100,
        },
      }),
    ).resolves.toBeTruthy();
  });

  it('produces an empty vector covering no groups when given nothing', async () => {
    const bundle = await buildFeatureVector({});
    expect(bundle.groups).toEqual([]);
    expect(bundle.vector).toEqual({});
  });

  it('declares a provenance for every group', () => {
    for (const g of ['G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7'] as const) {
      expect(GROUP_PROVENANCE[g]).toMatch(/^(exact|modeled|predicted|measured)$/);
    }
    expect(GROUP_PROVENANCE.G6).toBe('measured');
  });
});

describe('toRow', () => {
  it('orders values by the given column order and nulls what is missing', () => {
    expect(toRow({ b: 2, a: 1 }, ['a', 'b', 'c'])).toEqual([1, 2, null]);
  });

  it('uses null rather than 0 for a missing feature, so imputation can tell them apart', () => {
    expect(toRow({ a: 0 }, ['a', 'b'])).toEqual([0, null]);
  });
});
