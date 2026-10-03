/**
 * Feature group G1 — package metadata (doc 08 §3).
 *
 * Everything here is read from the installed package directory and its manifest. No network, and
 * no registry metadata: a feature that cannot be recomputed from the tarball on disk would make
 * the dataset unreproducible.
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { transitiveClosure, type DepGraph } from '@deplens/lockfile';
import type { FeatureVector } from './schema.ts';

export type PkgFormat = 'esm' | 'cjs' | 'dual' | 'umd';
export type SideEffectsDecl = 'false' | 'array' | 'absent' | 'true';

export interface PkgMetaFeatures extends FeatureVector {
  pkg_unpacked_bytes: number;
  pkg_js_files: number;
  pkg_format: PkgFormat;
  pkg_has_exports_map: boolean;
  pkg_sideeffects: SideEffectsDecl;
  pkg_n_deps: number;
  pkg_n_peer_deps: number;
  pkg_n_transitive: number;
  pkg_has_wasm: boolean;
  pkg_has_worker: boolean;
  pkg_ships_minified: boolean;
}

export interface Manifest {
  name?: string;
  version?: string;
  type?: string;
  main?: string;
  module?: string;
  browser?: string | Record<string, unknown>;
  unpkg?: string;
  exports?: unknown;
  sideEffects?: unknown;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  [key: string]: unknown;
}

const JS_EXT = /\.(js|mjs|cjs|jsx)$/i;

/**
 * Module format of the resolved entry.
 *
 * `dual` means the package ships both an ESM and a CJS entry, which matters because a bundler can
 * then tree-shake it; `umd` is detected from the shipped file's own shape, since a UMD bundle
 * declares itself as CJS in the manifest but costs more at runtime (the factory wrapper runs).
 */
export function detectFormat(manifest: Manifest, entrySource: string | null): PkgFormat {
  const hasEsm = manifest.module !== undefined || manifest.type === 'module' || hasConditional(manifest.exports, 'import');
  const hasCjs =
    manifest.main !== undefined || hasConditional(manifest.exports, 'require') || (manifest.type !== 'module' && manifest.main === undefined);

  if (entrySource && isUmd(entrySource)) return 'umd';
  if (hasEsm && hasCjs && manifest.main !== undefined) return 'dual';
  if (hasEsm) return 'esm';
  return 'cjs';
}

/** The classic UMD preamble: a factory invoked with checks for `exports`/`define`. */
function isUmd(source: string): boolean {
  const head = source.slice(0, 2000);
  return /typeof exports\s*===?\s*['"]object['"]/.test(head) && /typeof define\s*===?\s*['"]function['"]/.test(head);
}

function hasConditional(exportsField: unknown, condition: string): boolean {
  if (!exportsField || typeof exportsField !== 'object') return false;
  let found = false;
  const visit = (value: unknown) => {
    if (found || !value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (key === condition) {
        found = true;
        return;
      }
      visit(child);
    }
  };
  visit(exportsField);
  return found;
}

export function detectSideEffects(manifest: Manifest): SideEffectsDecl {
  const v = manifest.sideEffects;
  if (v === undefined) return 'absent';
  if (v === false) return 'false';
  if (v === true) return 'true';
  if (Array.isArray(v)) return 'array';
  // A string is accepted by some bundlers; treat it the same as a one-element array.
  return 'array';
}

/**
 * Pre-bundled/minified heuristic: long lines with few newlines. A shipped-minified entry means V8
 * sees one huge script rather than many modules, which changes compile behaviour.
 */
export function looksMinified(source: string): boolean {
  if (source.length < 1024) return false;
  const lines = source.split('\n');
  const avgLineLength = source.length / lines.length;
  return avgLineLength > 200;
}

interface DirScan {
  bytes: number;
  jsFiles: number;
  hasWasm: boolean;
  hasWorker: boolean;
}

/** Recursively measures an installed package, skipping its own nested dependencies. */
async function scanPackageDir(dir: string): Promise<DirScan> {
  const out: DirScan = { bytes: 0, jsFiles: 0, hasWasm: false, hasWorker: false };
  const walk = async (current: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      // Nested node_modules belong to a *different* package; counting them here would double-count
      // bytes that `pkg_n_transitive` already describes.
      if (e.name === 'node_modules') continue;
      const p = join(current, e.name);
      if (e.isDirectory()) {
        await walk(p);
        continue;
      }
      if (!e.isFile()) continue;
      try {
        out.bytes += (await stat(p)).size;
      } catch {
        continue;
      }
      if (JS_EXT.test(e.name)) out.jsFiles++;
      if (e.name.endsWith('.wasm')) out.hasWasm = true;
      if (/worker/i.test(e.name)) out.hasWorker = true;
    }
  };
  await walk(dir);
  return out;
}

/** The entry file a bundler would pick, preferring the ESM one — the same order esbuild uses. */
export async function readEntrySource(dir: string, manifest: Manifest): Promise<string | null> {
  const candidates = [manifest.module, typeof manifest.browser === 'string' ? manifest.browser : undefined, manifest.main, 'index.js'];
  for (const rel of candidates) {
    if (!rel || typeof rel !== 'string') continue;
    try {
      return await readFile(join(dir, rel), 'utf8');
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Extracts G1 for one candidate package.
 *
 * `graph` is the *candidate's own* dependency graph (from its isolated install), which is where
 * `pkg_n_transitive` comes from. When no lockfile is available the count falls back to the
 * packages the isolated bundle actually contained, which is a lower bound and is marked as such
 * by the caller rather than silently reported as exact.
 */
export async function extractPkgMeta(args: {
  packageDir: string;
  manifest: Manifest;
  /** Dependency graph of the isolated install, if one was parsed. */
  graph?: DepGraph;
  /** Fallback when there is no graph: packages observed in the isolated bundle. */
  bundledPackages?: readonly string[];
}): Promise<PkgMetaFeatures> {
  const { packageDir, manifest } = args;
  const scan = await scanPackageDir(packageDir);
  const entrySource = await readEntrySource(packageDir, manifest);
  const name = manifest.name ?? '';

  const transitive = args.graph
    ? transitiveClosure(args.graph, [name]).size
    : Math.max(0, (args.bundledPackages ?? []).filter((p) => p !== name).length);

  const workerInManifest = JSON.stringify(manifest).toLowerCase().includes('worker');

  return {
    pkg_unpacked_bytes: scan.bytes,
    pkg_js_files: scan.jsFiles,
    pkg_format: detectFormat(manifest, entrySource),
    pkg_has_exports_map: manifest.exports !== undefined,
    pkg_sideeffects: detectSideEffects(manifest),
    pkg_n_deps: Object.keys(manifest.dependencies ?? {}).length,
    pkg_n_peer_deps: Object.keys(manifest.peerDependencies ?? {}).length,
    pkg_n_transitive: transitive,
    pkg_has_wasm: scan.hasWasm,
    pkg_has_worker: scan.hasWorker || workerInManifest,
    pkg_ships_minified: entrySource ? looksMinified(entrySource) : false,
  };
}
