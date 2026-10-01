/**
 * Vite builder for host apps (doc 07 §2.3: "host apps are built with their own Vite config
 * in production mode, with a small `deplens-stats` plugin").
 *
 * We deliberately load **the host's own Vite** (from the prepared work dir's `node_modules`)
 * rather than a Vite pinned by the harness: the host app is the thing under study, so its
 * toolchain version is part of the experimental unit and is recorded in the build result.
 * The `deplens-stats` plugin is a plain Rollup plugin object, so it works across Vite versions.
 */
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { deplensStats, type BundleStats } from './bundleStats.ts';

/** The (tiny) part of the Vite module API we use. */
interface ViteModule {
  version: string;
  build(config: Record<string, unknown>): Promise<unknown>;
}

export interface ViteBuildOutcome {
  stats: BundleStats;
  viteVersion: string;
}

/** Resolves the Vite that the prepared host work dir has installed. */
export async function loadVite(workDir: string): Promise<ViteModule> {
  const require = createRequire(join(workDir, 'package.json'));
  let entry: string;
  try {
    entry = require.resolve('vite');
  } catch {
    throw new Error(
      `Host in ${workDir} declares a Vite build but 'vite' is not installed. ` +
        `Add vite to the host's devDependencies.`,
    );
  }
  const mod = (await import(pathToFileURL(entry).href)) as ViteModule & { default?: ViteModule };
  const vite = mod.default && typeof mod.default.build === 'function' ? mod.default : mod;
  if (typeof vite.build !== 'function') throw new Error(`Resolved 'vite' from ${entry} has no build()`);
  return vite;
}

/**
 * Production build of the prepared host work dir. `index.html` is the Vite entry, so the
 * output already contains the rewritten script tags — nothing is copied by hand.
 */
export async function buildWithVite(workDir: string, outDir = 'dist'): Promise<ViteBuildOutcome> {
  const vite = await loadVite(workDir);
  let stats: BundleStats | null = null;
  // Vite sets process.env.NODE_ENV for the build; restore it so later npm installs in this process
  // still see their devDependencies (npm omits them when NODE_ENV=production).
  const nodeEnvBefore = process.env.NODE_ENV;
  try {
    await vite.build({
      root: workDir,
      mode: 'production',
      logLevel: 'error',
      // Relative asset URLs: the measurement server serves the baseline and treatment dists under
      // path prefixes on one origin (doc 07 §3.5 wants the same port for A and B), and Vite's
      // default base '/' would make every chunk 404 there.
      base: './',
      // Inline plugins run alongside the ones in the host's vite.config.
      plugins: [deplensStats((s) => (stats = s))],
      build: {
        outDir,
        emptyOutDir: true,
        sourcemap: false,
        // We compress ourselves with fixed settings (gzip-9 / brotli-11) — Vite's own report is
        // both slower and uses different levels, which would make Δbytes non-comparable.
        reportCompressedSize: false,
      },
    });
  } finally {
    if (nodeEnvBefore === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = nodeEnvBefore;
  }
  if (!stats) throw new Error('deplens-stats produced no bundle stats — did the Vite build emit anything?');
  return { stats, viteVersion: vite.version };
}
