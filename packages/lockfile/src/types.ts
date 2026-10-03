/**
 * One dependency-graph shape for every lockfile format (doc 06 §5, FR-02).
 *
 * The graph is deliberately *flat*: a set of distinct `name@version` nodes plus the edges between
 * them. Every lockfile format already resolved the tree, so the only thing that differs between
 * npm, pnpm and yarn is how that resolution is written down — and the features in doc 08 §3 (G1
 * `pkg_n_transitive`, G3 `ctx_dup_versions`) are all questions about this flat set.
 */

export type LockKind = 'npm' | 'pnpm' | 'yarn-classic' | 'yarn-berry';

export interface DepNode {
  name: string;
  version: string;
  /**
   * `true` when every path from a root importer to this node goes through a devDependency.
   * Runtime cost analysis ignores dev-only packages: they are never in the browser bundle.
   */
  dev: boolean;
  /** Names of this node's own runtime dependencies (edges out). */
  deps: string[];
  /** Peer dependency names, which the lockfile does not necessarily install. */
  peerDeps: string[];
}

export interface DepGraph {
  kind: LockKind;
  /** The format's own version marker, verbatim ('3', '9.0', '1', '6'…). */
  lockfileVersion: string;
  /** Distinct `name@version` nodes, sorted by name then version. */
  nodes: DepNode[];
  /** Direct runtime dependency names, from package.json when supplied, else the lockfile's roots. */
  direct: string[];
  /** Direct dev dependency names. */
  directDev: string[];
  /** Parse problems that did not stop us producing a graph. Surfaced, never swallowed. */
  warnings: string[];
}

/** `name@version` — the node key used everywhere. */
export const nodeKey = (name: string, version: string): string => `${name}@${version}`;

export interface PackageJsonLike {
  name?: string;
  version?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

/**
 * Splits a bare specifier or a lockfile key into package name and the rest.
 * Handles scopes (`@scope/name@1.2.3` → `@scope/name`, `1.2.3`).
 */
export function splitNameVersion(key: string): { name: string; version: string } {
  const at = key.lastIndexOf('@');
  if (at <= 0) return { name: key, version: '' };
  return { name: key.slice(0, at), version: key.slice(at + 1) };
}

/** Package name from a `node_modules/...` path, including nested node_modules and scopes. */
export function packageOfNodeModulesPath(path: string): string | null {
  const p = path.replace(/\\/g, '/');
  const idx = p.lastIndexOf('node_modules/');
  if (idx === -1) return null;
  const rest = p.slice(idx + 'node_modules/'.length).split('/');
  if (rest[0]?.startsWith('@')) return rest[1] ? `${rest[0]}/${rest[1]}` : null;
  return rest[0] ?? null;
}
