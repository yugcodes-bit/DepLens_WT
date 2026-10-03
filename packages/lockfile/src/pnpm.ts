/**
 * pnpm `pnpm-lock.yaml`, lockfileVersion 5.x, 6.x and 9.x.
 *
 * The three generations differ in how a package is keyed and where its edges live:
 *   v5  `packages: { '/foo/1.2.3': { dependencies: {...} } }`
 *   v6  `packages: { '/foo@1.2.3': { dependencies: {...} } }`
 *   v9  `packages: { 'foo@1.2.3': { … } }` + a separate `snapshots` map holding the edges
 * In every generation the suffix in parentheses is a peer-resolution marker, not part of the
 * version: `foo@1.2.3(react@18.3.1)` is still `foo@1.2.3`.
 */
import { parse as parseYaml } from 'yaml';
import { sortNodes } from './npm.ts';
import type { DepGraph, DepNode, PackageJsonLike } from './types.ts';

interface PnpmEntry {
  version?: string;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  dev?: boolean;
}

interface PnpmImporter {
  dependencies?: Record<string, { version?: string; specifier?: string } | string>;
  devDependencies?: Record<string, { version?: string; specifier?: string } | string>;
}

interface PnpmLock {
  lockfileVersion?: string | number;
  importers?: Record<string, PnpmImporter>;
  dependencies?: Record<string, unknown>;
  devDependencies?: Record<string, unknown>;
  packages?: Record<string, PnpmEntry>;
  snapshots?: Record<string, PnpmEntry>;
}

/** Strips the `(peer@1.0.0)` resolution suffix pnpm appends to a key or a version. */
export function stripPeerSuffix(s: string): string {
  const i = s.indexOf('(');
  return i === -1 ? s : s.slice(0, i);
}

/**
 * Reads a pnpm package key of any generation into name + version.
 * `/foo/1.2.3` · `/@scope/foo/1.2.3` · `/foo@1.2.3` · `foo@1.2.3(react@18.0.0)`
 */
export function parsePnpmKey(raw: string): { name: string; version: string } | null {
  let key = stripPeerSuffix(raw);
  if (key.startsWith('/')) key = key.slice(1);
  // v5 style: the version is the last path segment and starts with a digit.
  const lastSlash = key.lastIndexOf('/');
  if (lastSlash > 0 && /^\d/.test(key.slice(lastSlash + 1))) {
    return { name: key.slice(0, lastSlash), version: key.slice(lastSlash + 1) };
  }
  // v6/v9 style: name@version, where a leading @ belongs to the scope.
  const at = key.lastIndexOf('@');
  if (at <= 0) return null;
  return { name: key.slice(0, at), version: key.slice(at + 1) };
}

export function parsePnpmLock(text: string, pkgJson?: PackageJsonLike): DepGraph {
  const lock = (parseYaml(text) ?? {}) as PnpmLock;
  const version = String(lock.lockfileVersion ?? '');
  const warnings: string[] = [];
  const byKey = new Map<string, DepNode>();

  // v9 keeps metadata in `packages` and edges in `snapshots`; earlier versions keep both in `packages`.
  const edgeSource = lock.snapshots ?? lock.packages ?? {};
  const metaSource = lock.packages ?? {};

  const entries = new Set([...Object.keys(metaSource), ...Object.keys(edgeSource)]);
  for (const rawKey of entries) {
    const parsed = parsePnpmKey(rawKey);
    if (!parsed) {
      warnings.push(`pnpm: could not read a name@version from key ${JSON.stringify(rawKey)}`);
      continue;
    }
    const meta = metaSource[rawKey] ?? {};
    const edges = edgeSource[rawKey] ?? {};
    const deps = Object.keys({ ...(edges.dependencies ?? {}), ...(edges.optionalDependencies ?? {}) });
    const key = `${parsed.name}@${parsed.version}`;
    const existing = byKey.get(key);
    if (existing) {
      for (const d of deps) if (!existing.deps.includes(d)) existing.deps.push(d);
      existing.dev = existing.dev && meta.dev === true;
      continue;
    }
    byKey.set(key, {
      name: parsed.name,
      version: parsed.version,
      dev: meta.dev === true,
      deps: [...new Set(deps)],
      peerDeps: Object.keys(meta.peerDependencies ?? {}),
    });
  }

  // Direct dependencies: package.json wins; otherwise read the root importer ('.').
  const rootImporter = lock.importers?.['.'];
  const direct = Object.keys(pkgJson?.dependencies ?? rootImporter?.dependencies ?? lock.dependencies ?? {});
  const directDev = Object.keys(pkgJson?.devDependencies ?? rootImporter?.devDependencies ?? lock.devDependencies ?? {});

  if (byKey.size === 0) warnings.push('pnpm: no packages found — empty graph');

  return { kind: 'pnpm', lockfileVersion: version, nodes: sortNodes([...byKey.values()]), direct, directDev, warnings };
}
