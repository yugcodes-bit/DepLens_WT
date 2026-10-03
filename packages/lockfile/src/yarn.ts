/**
 * yarn.lock, both generations.
 *
 * **Berry (v2+)** is real YAML: entries keyed `"name@npm:range"` with a `version` and a
 * `dependencies` map, and a `__metadata` block that identifies the format.
 *
 * **Classic (v1)** is a YAML-*like* format that is not valid YAML — bare values are quoted
 * inconsistently and the `key value` pairs have no colon. It is a strict two-space indented
 * format though, so a small line parser reads it exactly rather than approximately.
 */
import { parse as parseYaml } from 'yaml';
import { sortNodes } from './npm.ts';
import type { DepGraph, DepNode, PackageJsonLike } from './types.ts';

/** `"@scope/name@npm:^1.0.0"` / `lodash@^4.17.21` → the package name. */
export function nameOfDescriptor(descriptor: string): string | null {
  const d = descriptor.trim().replace(/^["']|["']$/g, '');
  const at = d.lastIndexOf('@');
  if (at <= 0) return null;
  return d.slice(0, at);
}

const unquote = (s: string) => s.trim().replace(/^["']|["']$/g, '');

interface ClassicEntry {
  descriptors: string[];
  version?: string;
  dependencies: string[];
  peerDependencies: string[];
}

/** Line parser for `# yarn lockfile v1`. Two-space indentation, `key "value"` pairs. */
export function parseYarnClassicEntries(text: string): { entries: ClassicEntry[]; warnings: string[] } {
  const warnings: string[] = [];
  const entries: ClassicEntry[] = [];
  let current: ClassicEntry | null = null;
  /** Which nested block (`dependencies:` / `optionalDependencies:` / `peerDependencies:`) we are inside. */
  let block: 'dependencies' | 'optionalDependencies' | 'peerDependencies' | null = null;

  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim() || raw.trimStart().startsWith('#')) continue;
    const indent = raw.length - raw.trimStart().length;
    const line = raw.trim();

    if (indent === 0) {
      if (!line.endsWith(':')) {
        warnings.push(`yarn v1: ignored unexpected top-level line ${JSON.stringify(line)}`);
        continue;
      }
      current = { descriptors: line.slice(0, -1).split(',').map(unquote), dependencies: [], peerDependencies: [] };
      entries.push(current);
      block = null;
      continue;
    }
    if (!current) continue;

    if (indent === 2) {
      block = null;
      if (line === 'dependencies:') block = 'dependencies';
      else if (line === 'optionalDependencies:') block = 'optionalDependencies';
      else if (line === 'peerDependencies:') block = 'peerDependencies';
      else {
        const m = /^version\s+(.+)$/.exec(line);
        if (m) current.version = unquote(m[1]!);
      }
      continue;
    }
    // indent >= 4: a dependency inside the current block. Key and range are space-separated.
    if (block) {
      const sp = line.indexOf(' ');
      const name = unquote(sp === -1 ? line : line.slice(0, sp));
      if (!name) continue;
      if (block === 'peerDependencies') current.peerDependencies.push(name);
      else current.dependencies.push(name);
    }
  }
  return { entries, warnings };
}

export function parseYarnClassic(text: string, pkgJson?: PackageJsonLike): DepGraph {
  const { entries, warnings } = parseYarnClassicEntries(text);
  const byKey = new Map<string, DepNode>();

  for (const e of entries) {
    const name = nameOfDescriptor(e.descriptors[0] ?? '');
    if (!name) {
      warnings.push(`yarn v1: could not read a name from ${JSON.stringify(e.descriptors[0] ?? '')}`);
      continue;
    }
    if (!e.version) {
      warnings.push(`yarn v1: ${name} has no version`);
      continue;
    }
    const key = `${name}@${e.version}`;
    const existing = byKey.get(key);
    if (existing) {
      for (const d of e.dependencies) if (!existing.deps.includes(d)) existing.deps.push(d);
      continue;
    }
    // yarn v1 does not record whether a package is dev-only; `dev` is derived from reachability below.
    byKey.set(key, {
      name,
      version: e.version,
      dev: false,
      deps: [...new Set(e.dependencies)],
      peerDeps: [...new Set(e.peerDependencies)],
    });
  }

  return {
    kind: 'yarn-classic',
    lockfileVersion: '1',
    nodes: sortNodes([...byKey.values()]),
    direct: Object.keys(pkgJson?.dependencies ?? {}),
    directDev: Object.keys(pkgJson?.devDependencies ?? {}),
    warnings,
  };
}

interface BerryEntry {
  version?: string;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

export function parseYarnBerry(text: string, pkgJson?: PackageJsonLike): DepGraph {
  const doc = (parseYaml(text) ?? {}) as Record<string, BerryEntry & { version?: number }>;
  const warnings: string[] = [];
  const byKey = new Map<string, DepNode>();
  const metaVersion = String((doc['__metadata'] as { version?: number } | undefined)?.version ?? '');

  for (const [rawKey, entry] of Object.entries(doc)) {
    if (rawKey === '__metadata') continue;
    // A single entry can cover several descriptors: "foo@npm:^1, foo@npm:^1.2".
    const name = nameOfDescriptor(rawKey.split(',')[0] ?? '');
    if (!name) {
      warnings.push(`yarn berry: could not read a name from key ${JSON.stringify(rawKey)}`);
      continue;
    }
    // The workspace root lists itself with `@workspace:.`; it is not an installed package.
    if (rawKey.includes('@workspace:')) continue;
    const version = entry.version !== undefined ? String(entry.version) : undefined;
    if (!version) {
      warnings.push(`yarn berry: ${name} has no version`);
      continue;
    }
    const key = `${name}@${version}`;
    const deps = Object.keys(entry.dependencies ?? {});
    const existing = byKey.get(key);
    if (existing) {
      for (const d of deps) if (!existing.deps.includes(d)) existing.deps.push(d);
      continue;
    }
    byKey.set(key, {
      name,
      version,
      dev: false,
      deps: [...new Set(deps)],
      peerDeps: Object.keys(entry.peerDependencies ?? {}),
    });
  }

  return {
    kind: 'yarn-berry',
    lockfileVersion: metaVersion,
    nodes: sortNodes([...byKey.values()]),
    direct: Object.keys(pkgJson?.dependencies ?? {}),
    directDev: Object.keys(pkgJson?.devDependencies ?? {}),
    warnings,
  };
}
