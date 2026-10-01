/**
 * Build a host app as baseline or treatment (doc 07 §2).
 *
 * Steps: copy host → add candidate deps to package.json → `npm install --ignore-scripts`
 * (so dependency dedup behaves exactly as if the developer had installed the package)
 * → inject the import spec → bundle → compute exact byte sizes of the initial load.
 *
 * Two bundlers, one `BuildResult` shape:
 *   - **vite**    (default when the host has a `vite.config.*`): the host's own Vite + the
 *                 `deplens-stats` plugin. This is what dataset hosts use (doc 07 §2.3).
 *   - **esbuild** (hosts without a Vite config): fast path used by the synthetic hosts and,
 *                 from P3 on, by isolated package-only builds.
 */
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { brotliCompressSync, constants as zc, gzipSync } from 'node:zlib';
import * as esbuild from 'esbuild';
import { initialFiles, STATS_FILE, type BundleStats } from './bundleStats.ts';
import { injectInto } from './inject.ts';
import { packageNamesOf, type ImportSpec } from './importSpec.ts';
import { buildWithVite } from './viteBuild.ts';

const execFileP = promisify(execFile);

export type Bundler = 'esbuild' | 'vite';

export interface HostConfig {
  name: string;
  /** react | vue | svelte | preact | solid | vanilla | none */
  framework: string;
  /** Entry module relative to the host dir, must contain the injection marker. */
  entry: string;
  /** HTML file relative to the host dir. For Vite it *is* the build entry. */
  html: string;
  /** Defaults to 'vite' when the host dir has a vite.config.*, else 'esbuild'. */
  bundler?: Bundler;
  /** Provenance for hosts taken from open source (doc 07 §5, doc 07 §10). */
  repoUrl?: string;
  commit?: string;
  notes?: string;
}

export interface BuildRequest {
  hostDir: string;
  /** null = baseline */
  spec: ImportSpec | null;
  /** Extra dependencies to install for the treatment, e.g. { "dayjs": "1.11.13" } or { "@deplens/work-10": "file:/abs/path" }. */
  deps?: Record<string, string>;
  workRoot: string;
  /** Keep `node_modules` in the work dir after building (default false — a 5,000-cell campaign would otherwise fill the disk). */
  keepNodeModules?: boolean;
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
  workDir: string;
  host: HostConfig;
  hostFingerprint: string;
  spec: ImportSpec | null;
  deps: Record<string, string>;
  /** Versions actually installed for `deps` — reproducibility metadata (doc 07 §10). */
  resolvedDeps: Record<string, string>;
  bundler: Bundler;
  bundlerVersion: string;
  initial: { minBytes: number; gzipBytes: number; brotliBytes: number };
  outputs: OutputFileInfo[];
  packages: PackageBytes[];
  modules: number;
  buildMs: number;
  installMs: number;
  cached: boolean;
}

export async function readHostConfig(hostDir: string): Promise<HostConfig> {
  return JSON.parse(await readFile(join(hostDir, 'host.json'), 'utf8')) as HostConfig;
}

const VITE_CONFIGS = ['vite.config.js', 'vite.config.mjs', 'vite.config.ts', 'vite.config.mts'];

export function detectBundler(hostDir: string, host: HostConfig): Bundler {
  if (host.bundler) return host.bundler;
  return VITE_CONFIGS.some((f) => existsSync(join(hostDir, f))) ? 'vite' : 'esbuild';
}

function hashOf(parts: unknown[]): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 16);
}

/** Directory names never copied into a work dir and never part of a host's fingerprint. */
const SKIP_DIRS = new Set(['node_modules', 'dist', '.vite', '.git']);

const isSkipped = (root: string, p: string) => {
  const rel = relative(root, p);
  return rel !== '' && rel.split(sep).some((part) => SKIP_DIRS.has(part));
};

/**
 * Content hash of a host app (sources + package.json + lockfile). Two hosts with the same
 * fingerprint must produce byte-identical builds, which is what makes the build cache safe
 * and the determinism check (doc 07 §8.4) meaningful.
 */
export async function hostFingerprint(hostDir: string): Promise<string> {
  const h = createHash('sha256');
  async function walk(dir: string): Promise<void> {
    const entries = (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      const p = join(dir, e.name);
      if (isSkipped(hostDir, p)) continue;
      if (e.isDirectory()) await walk(p);
      else {
        // Path separators are normalised so the same host hashes identically on Windows and Linux.
        h.update(relative(hostDir, p).split(sep).join('/'));
        h.update(await readFile(p));
      }
    }
  }
  await walk(hostDir);
  return h.digest('hex').slice(0, 16);
}

/**
 * Best-effort recursive delete. On Windows the esbuild service process that Vite started still
 * holds a handle on the platform esbuild binary under `node_modules/@esbuild` when the build returns, so the first
 * unlink fails with EPERM. Retrying a few times clears it in most cases; when it does not, the
 * leftover is harmless (it only costs disk) and `harness clean` prunes it from a fresh process.
 */
async function rmBestEffort(dir: string, attempts = 4): Promise<boolean> {
  for (let i = 0; i < attempts; i++) {
    try {
      await rm(dir, { recursive: true, force: true });
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, 250 * (i + 1)));
    }
  }
  return false;
}

/** Package name for a module path inside node_modules (handles scopes and nested node_modules). */
export function packageOfPath(path: string): string | null {
  const p = path.replace(/\\/g, '/');
  const idx = p.lastIndexOf('node_modules/');
  if (idx === -1) return null;
  const rest = p.slice(idx + 'node_modules/'.length).split('/');
  if (rest[0]?.startsWith('@')) return `${rest[0]}/${rest[1]}`;
  return rest[0] ?? null;
}

/** What a bundler run tells us, independent of which bundler ran. */
interface BundleOutcome {
  /** Emitted files, relative to the work dir, posix-separated. */
  files: string[];
  /** Subset of `files` the browser loads for the initial render. */
  initial: Set<string>;
  /** Bytes contributed to the initial JS outputs, per npm package ('(app)' for host code). */
  packageBytes: Map<string, number>;
  modules: number;
  bundlerVersion: string;
}

async function bundleEsbuild(workDir: string, host: HostConfig, distDir: string): Promise<BundleOutcome> {
  const result = await esbuild.build({
    entryPoints: { main: join(workDir, host.entry) },
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
  await writeFile(join(workDir, 'metafile.json'), JSON.stringify(result.metafile));

  // esbuild does not process HTML, so the host's HTML (which points at ./main.js) is copied as-is.
  await writeFile(join(distDir, 'index.html'), await readFile(join(workDir, host.html), 'utf8'));

  const outputs = result.metafile.outputs;
  const rel = (k: string) => relative(workDir, join(workDir, k)).split(sep).join('/');
  const outKeys = Object.keys(outputs).filter((k) => !k.endsWith('.map'));
  const entryOut = outKeys.find((k) => outputs[k]!.entryPoint !== undefined && k.endsWith('.js'));
  if (!entryOut) throw new Error('esbuild produced no JS entry output');

  const initialKeys = new Set<string>();
  const stack = [entryOut];
  while (stack.length) {
    const k = stack.pop()!;
    if (initialKeys.has(k)) continue;
    initialKeys.add(k);
    for (const imp of outputs[k]!.imports) if (imp.kind === 'import-statement' && !imp.external) stack.push(imp.path);
  }
  for (const k of outKeys) if (k.endsWith('.css')) initialKeys.add(k); // CSS linked from the entry is render-blocking

  const packageBytes = new Map<string, number>();
  let modules = 0;
  for (const k of initialKeys) {
    if (!k.endsWith('.js')) continue;
    for (const [inputPath, info] of Object.entries(outputs[k]!.inputs)) {
      modules++;
      const name = packageOfPath(inputPath) ?? '(app)';
      packageBytes.set(name, (packageBytes.get(name) ?? 0) + info.bytesInOutput);
    }
  }
  return {
    files: [rel('index.html'), ...outKeys.map(rel)],
    initial: new Set([rel('index.html'), ...[...initialKeys].map(rel)]),
    packageBytes,
    modules,
    bundlerVersion: esbuild.version,
  };
}

async function bundleVite(workDir: string, distDir: string): Promise<BundleOutcome> {
  const { stats, viteVersion } = await buildWithVite(workDir, distDir);
  await writeFile(join(workDir, STATS_FILE), JSON.stringify(stats));

  const outRel = relative(workDir, distDir).split(sep).join('/');
  const toRel = (fileName: string) => `${outRel}/${fileName}`;
  const initialChunkNames = initialFiles(stats);

  const packageBytes = new Map<string, number>();
  let modules = 0;
  for (const chunk of stats.chunks) {
    if (!initialChunkNames.has(chunk.fileName) || !chunk.fileName.endsWith('.js')) continue;
    for (const m of chunk.modules) {
      modules++;
      const name = packageOfPath(m.id) ?? '(app)';
      packageBytes.set(name, (packageBytes.get(name) ?? 0) + m.renderedLength);
    }
  }

  const files = [...stats.chunks.map((c) => c.fileName), ...stats.assets.map((a) => a.fileName)];
  // index.html is an asset; it is always part of the initial load.
  const initial = new Set([...initialChunkNames, ...files.filter((f) => f.endsWith('.html'))].map(toRel));
  return { files: files.map(toRel), initial, packageBytes, modules, bundlerVersion: viteVersion };
}

/** Versions actually installed for the requested deps (reads back from node_modules). */
async function resolveInstalledVersions(workDir: string, deps: Record<string, string>): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const name of Object.keys(deps)) {
    try {
      const pj = JSON.parse(await readFile(join(workDir, 'node_modules', ...name.split('/'), 'package.json'), 'utf8')) as {
        version?: string;
      };
      if (pj.version) out[name] = pj.version;
    } catch {
      // Not installed (e.g. an alias or a sub-path dep) — leave it out rather than guess.
    }
  }
  return out;
}

export async function build(req: BuildRequest): Promise<BuildResult> {
  const host = await readHostConfig(req.hostDir);
  const bundler = detectBundler(req.hostDir, host);
  const fp = await hostFingerprint(req.hostDir);
  const deps = req.deps ?? {};
  const key = hashOf([fp, req.spec, deps, bundler, esbuild.version]);
  const workDir = resolve(req.workRoot, 'builds', `${host.name}-${key}`);
  const distDir = join(workDir, 'dist');
  const resultPath = join(workDir, 'build-result.json');

  if (existsSync(resultPath)) {
    const cached = JSON.parse(await readFile(resultPath, 'utf8')) as BuildResult;
    return { ...cached, cached: true };
  }

  await rm(workDir, { recursive: true, force: true });
  await mkdir(workDir, { recursive: true });
  await cp(req.hostDir, workDir, { recursive: true, filter: (src) => !isSkipped(req.hostDir, src) });

  // 1) Install dependencies exactly like a developer would (dedup semantics included), without running scripts.
  const pkgJsonPath = join(workDir, 'package.json');
  type PkgJson = { name?: string; private?: boolean; dependencies?: Record<string, string> };
  const pkgJson: PkgJson = existsSync(pkgJsonPath)
    ? (JSON.parse(await readFile(pkgJsonPath, 'utf8')) as PkgJson)
    : { name: `host-${host.name}`, private: true };
  pkgJson.dependencies = { ...(pkgJson.dependencies ?? {}), ...deps };
  await writeFile(pkgJsonPath, JSON.stringify(pkgJson, null, 2));

  const needsInstall =
    Object.keys(pkgJson.dependencies).length > 0 || Object.keys((pkgJson as { devDependencies?: object }).devDependencies ?? {}).length > 0;
  const t0 = performance.now();
  if (needsInstall) {
    const { stdout, stderr } = await execFileP(
      'npm',
      [
        'install',
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
        '--prefer-offline',
        '--install-links',
        // Hosts keep their build toolchain (vite, framework plugins) in devDependencies, exactly as a
        // real app does. npm omits devDependencies when NODE_ENV=production, and a Vite build earlier
        // in this process sets that variable — so ask for them explicitly and neutralise NODE_ENV.
        '--include=dev',
        '--loglevel=error',
      ],
      {
        cwd: workDir,
        maxBuffer: 64 * 1024 * 1024,
        shell: process.platform === 'win32',
        env: { ...process.env, NODE_ENV: 'development' },
      },
    );
    const npmLog = `${stdout}${stderr}`.trim();
    if (process.env.DEPLENS_NPM_LOG) console.error(`[npm ${workDir}] ${npmLog}`);
    // npm can exit 0 after rolling an install back, leaving an empty tree — catch that here rather
    // than letting the bundler fail with a confusing "cannot find package" error.
    if (!existsSync(join(workDir, 'node_modules'))) {
      throw new Error(`npm install produced no node_modules in ${workDir} — npm said: ${npmLog}`);
    }
  }
  const installMs = performance.now() - t0;
  const resolvedDeps = await resolveInstalledVersions(workDir, deps);

  // Fail loudly when a requested package did not arrive — measuring it would silently produce a 0 label (FR-34).
  for (const name of req.spec ? packageNamesOf(req.spec) : []) {
    if (name in deps && !(name in resolvedDeps)) throw new Error(`Dependency ${name} was not installed in ${workDir}`);
  }

  // 2) Inject the import spec (or the empty baseline sink).
  const entryPath = join(workDir, host.entry);
  await writeFile(entryPath, injectInto(await readFile(entryPath, 'utf8'), req.spec));

  // 3) Bundle.
  const t1 = performance.now();
  const outcome =
    bundler === 'vite'
      ? await bundleVite(workDir, distDir)
      : await bundleEsbuild(workDir, host, distDir);
  const buildMs = performance.now() - t1;

  // 4) Exact sizes of every emitted file, from disk, with fixed compression settings.
  const infos: OutputFileInfo[] = [];
  for (const f of outcome.files) {
    const buf = await readFile(join(workDir, f));
    infos.push({
      path: f,
      minBytes: buf.length,
      gzipBytes: gzipSync(buf, { level: 9 }).length,
      brotliBytes: brotliCompressSync(buf, { params: { [zc.BROTLI_PARAM_QUALITY]: 11 } }).length,
      initial: outcome.initial.has(f),
    });
  }
  const initialJs = infos.filter((o) => o.initial && o.path.endsWith('.js'));
  const sum = (f: (o: OutputFileInfo) => number) => initialJs.reduce((s, o) => s + f(o), 0);

  const out: BuildResult = {
    key,
    distDir,
    workDir,
    host,
    hostFingerprint: fp,
    spec: req.spec,
    deps,
    resolvedDeps,
    bundler,
    bundlerVersion: outcome.bundlerVersion,
    initial: { minBytes: sum((o) => o.minBytes), gzipBytes: sum((o) => o.gzipBytes), brotliBytes: sum((o) => o.brotliBytes) },
    outputs: infos,
    packages: [...outcome.packageBytes.entries()]
      .map(([name, bytesInOutput]) => ({ name, bytesInOutput }))
      .sort((a, b) => b.bytesInOutput - a.bytesInOutput),
    modules: outcome.modules,
    buildMs,
    installMs,
    cached: false,
  };
  await writeFile(resultPath, JSON.stringify(out, null, 2));
  if (!req.keepNodeModules) await rmBestEffort(join(workDir, 'node_modules'));
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

/** Total bytes of all non-initial (lazily loaded) JS outputs — used to verify `lazy` placement (FR-14). */
export function lazyJsBytes(b: BuildResult): number {
  return b.outputs.filter((o) => !o.initial && o.path.endsWith('.js')).reduce((s, o) => s + o.minBytes, 0);
}

/** Re-exported so callers can read the stats artifact a Vite build left behind. */
export async function readBundleStats(workDir: string): Promise<BundleStats> {
  return JSON.parse(await readFile(join(workDir, STATS_FILE), 'utf8')) as BundleStats;
}

/**
 * Removes `node_modules` from every cached build in `<workRoot>/builds`, keeping `dist/` and the
 * build results so the cache stays valid. Run it from a fresh process (see `harness clean`).
 */
export async function pruneBuildNodeModules(workRoot: string): Promise<{ pruned: string[]; failed: string[] }> {
  const buildsDir = join(workRoot, 'builds');
  const pruned: string[] = [];
  const failed: string[] = [];
  if (!existsSync(buildsDir)) return { pruned, failed };
  for (const e of await readdir(buildsDir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const nm = join(buildsDir, e.name, 'node_modules');
    if (!existsSync(nm)) continue;
    ((await rmBestEffort(nm, 2)) ? pruned : failed).push(e.name);
  }
  return { pruned, failed };
}
