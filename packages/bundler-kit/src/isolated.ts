/**
 * Isolated builds — the candidate import bundled **alone**, with nothing of the host around it.
 *
 * Three builds answer three different questions (doc 08 §3):
 *   1. `spec`, minified      → `iso_min_bytes` / `iso_gz_bytes` / `iso_br_bytes`: what this exact
 *                              import costs in bytes, bundlejs-style.
 *   2. `namespace`, minified → `iso_full_min_bytes`: what the *whole* package costs,
 *                              Bundlephobia-style. The ratio of the two is how tree-shakeable the
 *                              import is (`iso_treeshake_ratio`).
 *   3. `spec`, **unminified**, with the host's already-shipped packages marked external
 *                            → the "unminified delta" that feature group G4 is defined on. Marking
 *                              shared packages external is what makes this the *added* code rather
 *                              than the whole candidate: code the app already ships is not added.
 *
 * All three run in one work dir, so the install happens once.
 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import * as esbuild from 'esbuild';
import { sizesOf, type ByteSizes } from './compress.ts';
import { installDeps, readInstalledManifest } from './install.ts';
import { breakdown, packagesIn } from './metafile.ts';
import { packageNamesOf, SINK, treatmentBlock, type ImportSpec } from './importSpec.ts';

/** Build target for every isolated build. Fixed, because bytes must be comparable across cells. */
export const ISO_TARGET = 'es2020';

export type IsolatedMode = 'spec' | 'namespace';

export interface IsolatedBuildRequest {
  spec: ImportSpec;
  /** Packages to install, e.g. `{ 'date-fns': '4.1.0' }`. */
  deps: Record<string, string>;
  workRoot: string;
  /** Packages resolved to nothing (peers the host provides, or packages it already ships). */
  external?: readonly string[];
  minify?: boolean;
  mode?: IsolatedMode;
  /** Reuse an existing work dir instead of installing again. */
  reuseDir?: string;
}

export interface IsolatedBuild {
  /** The bundled JavaScript. For the unminified build this is the input to the G4 AST extractor. */
  code: string;
  sizes: ByteSizes;
  modules: number;
  /** Distinct npm packages that ended up in the bundle. */
  packages: string[];
  cjsByteShare: number;
  metafile: esbuild.Metafile;
  resolvedDeps: Record<string, string>;
  workDir: string;
  installMs: number;
  buildMs: number;
  esbuildVersion: string;
}

const hashOf = (parts: unknown[]) => createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 16);

/**
 * The entry module for an isolated build.
 *
 * `spec` mode reuses exactly the same injection block the measurement harness puts into a host
 * (`treatmentBlock`), so an isolated byte count and an in-context byte count are produced from
 * identical source — otherwise the two would not be comparable.
 *
 * `namespace` mode replaces it with a full namespace import per package, which is what
 * Bundlephobia reports and what makes `iso_treeshake_ratio` meaningful.
 */
export function isolatedEntry(spec: ImportSpec, mode: IsolatedMode): string {
  if (mode === 'spec') return treatmentBlock(spec);
  const names = packageNamesOf(spec);
  if (names.length === 0) throw new Error(`Import spec references no npm package: ${spec.code}`);
  const imports = names.map((n, i) => `import * as __ns${i} from ${JSON.stringify(n)};`).join('\n');
  return `${imports}\n${SINK} = [${names.map((_, i) => `__ns${i}`).join(', ')}];`;
}

/**
 * Bundles an import spec on its own. Installs into `workRoot/iso/<hash>` unless `reuseDir` points
 * at a directory that already has the packages.
 */
export async function isolatedBuild(req: IsolatedBuildRequest): Promise<IsolatedBuild> {
  const mode = req.mode ?? 'spec';
  const minify = req.minify ?? true;
  const external = [...(req.external ?? [])];
  const key = hashOf([req.spec, req.deps, external, esbuild.version]);
  const workDir = req.reuseDir ?? resolve(req.workRoot, 'iso', key);

  let installMs = 0;
  let resolvedDeps: Record<string, string> = {};
  if (!req.reuseDir) {
    await rm(workDir, { recursive: true, force: true });
    await mkdir(workDir, { recursive: true });
    await writeFile(join(workDir, 'package.json'), JSON.stringify({ name: `deplens-iso-${key}`, private: true }, null, 2));
    const installed = await installDeps(workDir, req.deps);
    installMs = installed.installMs;
    resolvedDeps = installed.resolved;
    await writeFile(join(workDir, 'resolved-deps.json'), JSON.stringify(resolvedDeps, null, 2));
  } else {
    const p = join(workDir, 'resolved-deps.json');
    if (existsSync(p)) resolvedDeps = JSON.parse(await readFile(p, 'utf8')) as Record<string, string>;
  }

  // Fail loudly when a requested package is missing: bundling would otherwise succeed with an
  // empty bundle and silently produce a zero-cost row (FR-34).
  for (const name of packageNamesOf(req.spec)) {
    if (name in req.deps && !(name in resolvedDeps) && !external.includes(name)) {
      throw new Error(`Dependency ${name} was not installed in ${workDir} — refusing to emit a zero-byte isolated build`);
    }
  }

  const variant = `${mode}-${minify ? 'min' : 'raw'}`;
  const entryName = `entry-${variant}.js`;
  await writeFile(join(workDir, entryName), isolatedEntry(req.spec, mode));

  const t0 = performance.now();
  const result = await esbuild.build({
    entryPoints: [join(workDir, entryName)],
    absWorkingDir: workDir,
    bundle: true,
    write: false,
    // An explicit outdir is required even with `write: false`: without one esbuild names the
    // single output "<stdout>", which leaves the metafile with no usable output key.
    outdir: `out-${variant}`,
    format: 'esm',
    platform: 'browser',
    target: ISO_TARGET,
    minify,
    external,
    metafile: true,
    legalComments: 'none',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"', global: 'globalThis' },
    logLevel: 'error',
  });
  const buildMs = performance.now() - t0;

  const js = result.outputFiles.find((f) => f.path.endsWith('.js'));
  if (!js) throw new Error('isolated build produced no JS output');
  const code = js.text;
  const b = breakdown(result.metafile);

  return {
    code,
    sizes: sizesOf(code),
    modules: b.modules,
    packages: packagesIn(result.metafile),
    cjsByteShare: b.cjsByteShare,
    metafile: result.metafile,
    resolvedDeps,
    workDir,
    installMs,
    buildMs,
    esbuildVersion: esbuild.version,
  };
}

export interface IsolatedMetrics {
  /** Feature group G2 (doc 08 §3), ready to merge into a feature vector. */
  iso_min_bytes: number;
  iso_gz_bytes: number;
  iso_br_bytes: number;
  iso_full_min_bytes: number;
  iso_treeshake_ratio: number;
  iso_modules: number;
  iso_packages: number;
  iso_cjs_byte_share: number;
  /** Packages the candidate pulls in — the input to "which of these does the app already ship?". */
  candidatePackages: string[];
  /** Unminified added code, the input to the G4 AST extractor. */
  addedCode: string;
  /** Manifest of each directly requested package, for feature group G1. */
  manifests: Record<string, Record<string, unknown> | null>;
  resolvedDeps: Record<string, string>;
  workDir: string;
  installMs: number;
  buildMs: number;
  esbuildVersion: string;
}

/**
 * Everything the static analyzer needs from isolated builds, in one install.
 *
 * `sharedPackages` are the packages the host app already ships. They are marked external in the
 * unminified build only: the byte features must describe the candidate as a whole, while the AST
 * features must describe only what is genuinely *added* in this context.
 */
export async function isolatedMetrics(args: {
  spec: ImportSpec;
  deps: Record<string, string>;
  workRoot: string;
  sharedPackages?: readonly string[];
  /** Peers the host provides (react, vue…). Always external, in every build. */
  peers?: readonly string[];
}): Promise<IsolatedMetrics> {
  const peers = [...(args.peers ?? [])];
  const specMin = await isolatedBuild({ spec: args.spec, deps: args.deps, workRoot: args.workRoot, external: peers, minify: true, mode: 'spec' });

  // Reuse the installed tree for the remaining builds.
  const reuse = { reuseDir: specMin.workDir, workRoot: args.workRoot, deps: args.deps, spec: args.spec };
  const nsMin = await isolatedBuild({ ...reuse, external: peers, minify: true, mode: 'namespace' });
  const addedRaw = await isolatedBuild({
    ...reuse,
    external: [...new Set([...peers, ...(args.sharedPackages ?? [])])],
    minify: false,
    mode: 'spec',
  });

  const manifests: Record<string, Record<string, unknown> | null> = {};
  for (const name of Object.keys(args.deps)) {
    manifests[name] = await readInstalledManifest(specMin.workDir, name);
  }

  return {
    iso_min_bytes: specMin.sizes.minBytes,
    iso_gz_bytes: specMin.sizes.gzipBytes,
    iso_br_bytes: specMin.sizes.brotliBytes,
    iso_full_min_bytes: nsMin.sizes.minBytes,
    // A namespace import can tree-shake to nothing for a package with no side effects, so guard
    // the division rather than emitting Infinity into a feature vector.
    iso_treeshake_ratio: nsMin.sizes.minBytes > 0 ? specMin.sizes.minBytes / nsMin.sizes.minBytes : 0,
    iso_modules: specMin.modules,
    iso_packages: specMin.packages.length,
    iso_cjs_byte_share: specMin.cjsByteShare,
    candidatePackages: specMin.packages,
    addedCode: addedRaw.code,
    manifests,
    resolvedDeps: specMin.resolvedDeps,
    workDir: specMin.workDir,
    installMs: specMin.installMs,
    buildMs: specMin.buildMs + nsMin.buildMs + addedRaw.buildMs,
    esbuildVersion: specMin.esbuildVersion,
  };
}
