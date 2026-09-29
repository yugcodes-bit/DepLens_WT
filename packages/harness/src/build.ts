/**
 * Build a host app as baseline or treatment (doc 07 §2).
 *
 * Steps: copy host → add candidate deps to package.json → `npm install --ignore-scripts`
 * (so dependency dedup behaves exactly as if the developer had installed the package)
 * → inject the import spec → bundle → compute exact byte sizes of the initial load.
 *
 * Phase 0 uses esbuild for speed. Phase 1 adds a Vite builder for hosts that ship a vite.config
 * (see docs/09 P1). Both must produce the same BuildResult shape.
 */
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { brotliCompressSync, constants as zc, gzipSync } from 'node:zlib';
import * as esbuild from 'esbuild';
import { injectInto } from './inject.ts';
import type { ImportSpec } from './importSpec.ts';

const execFileP = promisify(execFile);

export interface HostConfig {
  name: string;
  framework: string;
  /** Entry module relative to the host dir, must contain the injection marker. */
  entry: string;
  /** HTML file relative to the host dir; its module script must point at `./main.js`. */
  html: string;
}

export interface BuildRequest {
  hostDir: string;
  /** null = baseline */
  spec: ImportSpec | null;
  /** Extra dependencies to install for the treatment, e.g. { "dayjs": "1.11.13" } or { "@deplens/work-10": "file:/abs/path" }. */
  deps?: Record<string, string>;
  workRoot: string;
}

export interface OutputFileInfo {
  path: string;
  minBytes: number;
  gzipBytes: number;
  brotliBytes: number;
  initial: boolean;
}

export interface PackageBytes {
  name: string;
  bytesInOutput: number;
}

export interface BuildResult {
  key: string;
  distDir: string;
  host: HostConfig;
  spec: ImportSpec | null;
  initial: { minBytes: number; gzipBytes: number; brotliBytes: number };
  outputs: OutputFileInfo[];
  packages: PackageBytes[];
  modules: number;
  esbuildVersion: string;
  buildMs: number;
  installMs: number;
  cached: boolean;
}

export async function readHostConfig(hostDir: string): Promise<HostConfig> {
  return JSON.parse(await readFile(join(hostDir, 'host.json'), 'utf8')) as HostConfig;
}

function hashOf(parts: unknown[]): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 16);
}

async function hostFingerprint(hostDir: string): Promise<string> {
  const h = createHash('sha256');
  async function walk(dir: string): Promise<void> {
    const entries = (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name === 'dist') continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) await walk(p);
      else {
        h.update(relative(hostDir, p));
        h.update(await readFile(p));
      }
    }
  }
  await walk(hostDir);
  return h.digest('hex').slice(0, 16);
}

/** Package name for a module path inside node_modules (handles scopes and nested node_modules). */
export function packageOfPath(path: string): string | null {
  const idx = path.lastIndexOf('node_modules/');
  if (idx === -1) return null;
  const rest = path.slice(idx + 'node_modules/'.length).split('/');
  if (rest[0]?.startsWith('@')) return `${rest[0]}/${rest[1]}`;
  return rest[0] ?? null;
}

export async function build(req: BuildRequest): Promise<BuildResult> {
  const host = await readHostConfig(req.hostDir);
  const fp = await hostFingerprint(req.hostDir);
  const key = hashOf([fp, req.spec, req.deps ?? {}, esbuild.version]);
  const workDir = resolve(req.workRoot, 'builds', `${host.name}-${key}`);
  const distDir = join(workDir, 'dist');
  const resultPath = join(workDir, 'build-result.json');

  if (existsSync(resultPath)) {
    const cached = JSON.parse(await readFile(resultPath, 'utf8')) as BuildResult;
    return { ...cached, cached: true };
  }

  await rm(workDir, { recursive: true, force: true });
  await mkdir(workDir, { recursive: true });
  await cp(req.hostDir, workDir, {
    recursive: true,
    filter: (src) => !src.includes(`${req.hostDir}/node_modules`) && !src.includes(`${req.hostDir}/dist`),
  });

  // 1) Install dependencies exactly like a developer would (dedup semantics included), without running scripts.
  const pkgJsonPath = join(workDir, 'package.json');
  type PkgJson = { name?: string; private?: boolean; dependencies?: Record<string, string> };
  const pkgJson: PkgJson = existsSync(pkgJsonPath)
    ? (JSON.parse(await readFile(pkgJsonPath, 'utf8')) as PkgJson)
    : { name: `host-${host.name}`, private: true };
  pkgJson.dependencies = { ...(pkgJson.dependencies ?? {}), ...(req.deps ?? {}) };
  await writeFile(pkgJsonPath, JSON.stringify(pkgJson, null, 2));

  const t0 = performance.now();
  if (Object.keys(pkgJson.dependencies).length > 0) {
    await execFileP(
      'npm',
      ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--prefer-offline', '--install-links', '--loglevel=error'],
      { cwd: workDir, maxBuffer: 32 * 1024 * 1024 },
    );
  }
  const installMs = performance.now() - t0;

  // 2) Inject the import spec (or the empty baseline sink).
  const entryPath = join(workDir, host.entry);
  await writeFile(entryPath, injectInto(await readFile(entryPath, 'utf8'), req.spec));

  // 3) Bundle.
  const t1 = performance.now();
  const lazy = req.spec?.placement === 'lazy';
  const result = await esbuild.build({
    entryPoints: { main: entryPath },
    absWorkingDir: workDir,
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2020',
    minify: true,
    splitting: true, // allows dynamic import() to become a separate chunk (lazy placement)
    outdir: distDir,
    chunkNames: 'chunk-[hash]',
    metafile: true,
    legalComments: 'none',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"', global: 'globalThis' },
    logLevel: 'error',
  });
  const buildMs = performance.now() - t1;
  await writeFile(join(workDir, 'metafile.json'), JSON.stringify(result.metafile));

  // 4) HTML.
  const html = await readFile(join(workDir, host.html), 'utf8');
  await writeFile(join(distDir, 'index.html'), html);

  // 5) Sizes of the initial load = entry output + everything reachable by static imports.
  const outputs = result.metafile.outputs;
  const outKeys = Object.keys(outputs);
  const entryOut = outKeys.find((k) => outputs[k]!.entryPoint !== undefined && k.endsWith('.js'));
  if (!entryOut) throw new Error('esbuild produced no JS entry output');
  const initial = new Set<string>();
  const stack = [entryOut];
  while (stack.length) {
    const k = stack.pop()!;
    if (initial.has(k)) continue;
    initial.add(k);
    for (const imp of outputs[k]!.imports) if (imp.kind === 'import-statement' && !imp.external) stack.push(imp.path);
  }
  for (const k of outKeys) if (k.endsWith('.css')) initial.add(k); // CSS linked from the entry is render-blocking

  const infos: OutputFileInfo[] = [];
  for (const k of outKeys) {
    if (k.endsWith('.map')) continue;
    const buf = await readFile(join(workDir, k));
    infos.push({
      path: relative(workDir, join(workDir, k)),
      minBytes: buf.length,
      gzipBytes: gzipSync(buf, { level: 9 }).length,
      brotliBytes: brotliCompressSync(buf, { params: { [zc.BROTLI_PARAM_QUALITY]: 11 } }).length,
      initial: initial.has(k),
    });
  }
  const sum = (f: (o: OutputFileInfo) => number) => infos.filter((o) => o.initial && o.path.endsWith('.js')).reduce((s, o) => s + f(o), 0);

  // 6) Bytes per package in the initial JS outputs.
  const pkgBytes = new Map<string, number>();
  let modules = 0;
  for (const k of initial) {
    if (!k.endsWith('.js')) continue;
    for (const [inputPath, info] of Object.entries(outputs[k]!.inputs)) {
      modules++;
      const name = packageOfPath(inputPath) ?? '(app)';
      pkgBytes.set(name, (pkgBytes.get(name) ?? 0) + info.bytesInOutput);
    }
  }

  const out: BuildResult = {
    key,
    distDir,
    host,
    spec: req.spec,
    initial: { minBytes: sum((o) => o.minBytes), gzipBytes: sum((o) => o.gzipBytes), brotliBytes: sum((o) => o.brotliBytes) },
    outputs: infos,
    packages: [...pkgBytes.entries()].map(([name, bytesInOutput]) => ({ name, bytesInOutput })).sort((a, b) => b.bytesInOutput - a.bytesInOutput),
    modules,
    esbuildVersion: esbuild.version,
    buildMs,
    installMs,
    cached: false,
  };
  await writeFile(resultPath, JSON.stringify(out, null, 2));
  await stat(distDir);
  return out;
}

/**
 * Exact byte deltas between a baseline and a treatment build (feature group G3, doc 08).
 * `isolated` = the same import spec built on an empty host; it tells us which packages the candidate
 * needs, so we can say which of them the app already ships ("shared") — the context effect on bytes.
 */
export function byteDelta(baseline: BuildResult, treatment: BuildResult, isolated?: BuildResult) {
  const basePk = new Map(baseline.packages.map((p) => [p.name, p.bytesInOutput]));
  const newPackages = treatment.packages.filter((p) => !basePk.has(p.name) && p.name !== '(app)').map((p) => p.name);
  const sharedPackages = isolated
    ? isolated.packages.filter((p) => p.name !== '(app)' && basePk.has(p.name)).map((p) => p.name)
    : [];
  return {
    minBytes: treatment.initial.minBytes - baseline.initial.minBytes,
    gzipBytes: treatment.initial.gzipBytes - baseline.initial.gzipBytes,
    brotliBytes: treatment.initial.brotliBytes - baseline.initial.brotliBytes,
    modules: treatment.modules - baseline.modules,
    newPackages,
    sharedPackages,
  };
}
