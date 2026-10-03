/**
 * `@deplens/lockfile` — read any JS package manager's lockfile into one dependency graph (FR-02).
 *
 * Used in two places: the analyzer, to tell what a host app already ships (feature group G3,
 * `ctx_shared_packages` / `ctx_dup_versions`), and project intake in the web app, to report how
 * many dependencies a submitted project has without installing anything.
 */
export * from './types.ts';
export * from './graph.ts';
export { parseNpmLock } from './npm.ts';
export { parsePnpmLock, parsePnpmKey, stripPeerSuffix } from './pnpm.ts';
export { parseYarnBerry, parseYarnClassic, parseYarnClassicEntries, nameOfDescriptor } from './yarn.ts';

import { parseNpmLock } from './npm.ts';
import { parsePnpmLock } from './pnpm.ts';
import { parseYarnBerry, parseYarnClassic } from './yarn.ts';
import { markDevByReachability } from './graph.ts';
import type { DepGraph, LockKind, PackageJsonLike } from './types.ts';

/** Canonical lockfile names, in the order we prefer them when a repo has more than one. */
export const LOCKFILE_NAMES = ['pnpm-lock.yaml', 'package-lock.json', 'yarn.lock', 'npm-shrinkwrap.json'] as const;

/** Identifies a lockfile from its name and, where the name is ambiguous, its content. */
export function detectLockKind(fileName: string, text: string): LockKind | null {
  const base = fileName.replace(/\\/g, '/').split('/').pop() ?? fileName;
  if (base === 'pnpm-lock.yaml' || base === 'pnpm-lock.yml') return 'pnpm';
  if (base === 'package-lock.json' || base === 'npm-shrinkwrap.json') return 'npm';
  if (base === 'yarn.lock') return /^__metadata:/m.test(text) ? 'yarn-berry' : 'yarn-classic';
  // Fall back to content sniffing so a renamed or pasted lockfile still works.
  if (/^\s*\{/.test(text) && /"lockfileVersion"/.test(text)) return 'npm';
  if (/^lockfileVersion:/m.test(text)) return 'pnpm';
  if (/^__metadata:/m.test(text)) return 'yarn-berry';
  if (/^# yarn lockfile v1/m.test(text)) return 'yarn-classic';
  return null;
}

export class UnknownLockfileError extends Error {
  constructor(public readonly fileName: string) {
    super(
      `Unrecognised lockfile ${JSON.stringify(fileName)}. Supported: ${LOCKFILE_NAMES.join(', ')} ` +
        `(npm lockfileVersion 1-3, pnpm 5/6/9, yarn classic and berry).`,
    );
    this.name = 'UnknownLockfileError';
  }
}

/**
 * Parses a lockfile into a dependency graph. `pkgJson` is optional but strongly recommended:
 * yarn lockfiles carry no dev/runtime distinction at all, so without a manifest every package
 * counts as runtime.
 */
export function parseLockfile(fileName: string, text: string, pkgJson?: PackageJsonLike): DepGraph {
  const kind = detectLockKind(fileName, text);
  if (!kind) throw new UnknownLockfileError(fileName);
  const graph =
    kind === 'npm'
      ? parseNpmLock(text, pkgJson)
      : kind === 'pnpm'
        ? parsePnpmLock(text, pkgJson)
        : kind === 'yarn-berry'
          ? parseYarnBerry(text, pkgJson)
          : parseYarnClassic(text, pkgJson);
  // One definition of `dev` for every format, derived the same way (see markDevByReachability).
  return markDevByReachability(graph);
}
