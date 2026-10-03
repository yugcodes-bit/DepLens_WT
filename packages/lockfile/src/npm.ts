/**
 * npm `package-lock.json`, lockfileVersion 1, 2 and 3.
 *
 * v2/v3 carry a flat `packages` map keyed by install path (`node_modules/a/node_modules/b`), which
 * is already the shape we want. v1 carries a nested `dependencies` tree and is still produced by
 * npm 6, so it is walked recursively.
 */
import { packageOfNodeModulesPath, type DepGraph, type DepNode, type PackageJsonLike } from './types.ts';

interface NpmV3Entry {
  version?: string;
  dev?: boolean;
  devOptional?: boolean;
  optional?: boolean;
  link?: boolean;
  resolved?: string;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

interface NpmV1Entry {
  version?: string;
  dev?: boolean;
  optional?: boolean;
  requires?: Record<string, string> | boolean;
  dependencies?: Record<string, NpmV1Entry>;
}

interface NpmLock {
  lockfileVersion?: number;
  name?: string;
  packages?: Record<string, NpmV3Entry>;
  dependencies?: Record<string, NpmV1Entry>;
}

export function parseNpmLock(text: string, pkgJson?: PackageJsonLike): DepGraph {
  const lock = JSON.parse(text) as NpmLock;
  const version = String(lock.lockfileVersion ?? 1);
  const warnings: string[] = [];
  const byKey = new Map<string, DepNode>();

  const add = (name: string, v: string, dev: boolean, deps: string[], peerDeps: string[]) => {
    const key = `${name}@${v}`;
    const existing = byKey.get(key);
    if (existing) {
      // The same name@version can appear at several install paths; dev is only true when every
      // occurrence is dev, so a single non-dev occurrence makes the node a runtime node.
      existing.dev = existing.dev && dev;
      for (const d of deps) if (!existing.deps.includes(d)) existing.deps.push(d);
      return;
    }
    byKey.set(key, { name, version: v, dev, deps: [...new Set(deps)], peerDeps: [...new Set(peerDeps)] });
  };

  if (lock.packages) {
    for (const [path, entry] of Object.entries(lock.packages)) {
      if (path === '') continue; // the root project itself
      if (entry.link) continue; // workspace symlink, the target is listed separately
      const name = packageOfNodeModulesPath(path);
      if (!name) {
        warnings.push(`npm: could not read a package name from lock path ${JSON.stringify(path)}`);
        continue;
      }
      if (!entry.version) {
        warnings.push(`npm: ${name} at ${path} has no version`);
        continue;
      }
      add(
        name,
        entry.version,
        entry.dev === true || entry.devOptional === true,
        Object.keys(entry.dependencies ?? {}),
        Object.keys(entry.peerDependencies ?? {}),
      );
    }
  } else if (lock.dependencies) {
    const walk = (tree: Record<string, NpmV1Entry>, inheritedDev: boolean) => {
      for (const [name, entry] of Object.entries(tree)) {
        if (!entry.version) {
          warnings.push(`npm v1: ${name} has no version`);
          continue;
        }
        const requires = typeof entry.requires === 'object' && entry.requires !== null ? Object.keys(entry.requires) : [];
        add(name, entry.version, inheritedDev || entry.dev === true, requires, []);
        if (entry.dependencies) walk(entry.dependencies, inheritedDev || entry.dev === true);
      }
    };
    walk(lock.dependencies, false);
  } else {
    warnings.push('npm: lockfile has neither a "packages" nor a "dependencies" map — empty graph');
  }

  return {
    kind: 'npm',
    lockfileVersion: version,
    nodes: sortNodes([...byKey.values()]),
    direct: Object.keys(pkgJson?.dependencies ?? rootDeps(lock, 'dependencies')),
    directDev: Object.keys(pkgJson?.devDependencies ?? rootDeps(lock, 'devDependencies')),
    warnings,
  };
}

/** v2/v3 store the root project's manifest under the "" key, so we can recover direct deps without package.json. */
function rootDeps(lock: NpmLock, field: 'dependencies' | 'devDependencies'): Record<string, string> {
  const root = lock.packages?.[''] as (NpmV3Entry & { devDependencies?: Record<string, string> }) | undefined;
  return (root?.[field] as Record<string, string> | undefined) ?? {};
}

export function sortNodes(nodes: DepNode[]): DepNode[] {
  return nodes.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
}
