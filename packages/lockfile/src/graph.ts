/**
 * Queries over a parsed `DepGraph`. These are exactly the questions doc 08 §3's features ask:
 * how many packages does a candidate drag in (G1 `pkg_n_transitive`), does the app already ship
 * it (G3 `ctx_shared_packages`), and will adding it duplicate a version (G3 `ctx_dup_versions`).
 */
import type { DepGraph, DepNode } from './types.ts';

/** Every node for a package name, newest-first is *not* assumed — order is lockfile order. */
export function versionsOf(graph: DepGraph, name: string): DepNode[] {
  return graph.nodes.filter((n) => n.name === name);
}

export function hasPackage(graph: DepGraph, name: string): boolean {
  return graph.nodes.some((n) => n.name === name);
}

/** Package names present at more than one version — each costs duplicated bytes in a bundle. */
export function duplicateVersions(graph: DepGraph): { name: string; versions: string[] }[] {
  const byName = new Map<string, Set<string>>();
  for (const n of graph.nodes) {
    let s = byName.get(n.name);
    if (!s) byName.set(n.name, (s = new Set()));
    s.add(n.version);
  }
  return [...byName.entries()]
    .filter(([, versions]) => versions.size > 1)
    .map(([name, versions]) => ({ name, versions: [...versions].sort() }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Names reachable from `roots` by following runtime edges, excluding the roots themselves.
 * Edges are followed by *name*, because that is all a lockfile's dependency maps record; when a
 * name exists at several versions every version's edges are followed (an over-approximation that
 * errs toward counting more transitive packages, never fewer).
 */
export function transitiveClosure(graph: DepGraph, roots: readonly string[]): Set<string> {
  const byName = new Map<string, DepNode[]>();
  for (const n of graph.nodes) {
    const list = byName.get(n.name);
    if (list) list.push(n);
    else byName.set(n.name, [n]);
  }
  const seen = new Set<string>();
  const stack = [...roots];
  while (stack.length) {
    const name = stack.pop()!;
    for (const node of byName.get(name) ?? []) {
      for (const dep of node.deps) {
        if (seen.has(dep)) continue;
        seen.add(dep);
        stack.push(dep);
      }
    }
  }
  for (const r of roots) seen.delete(r);
  return seen;
}

/**
 * Marks nodes reachable only through devDependencies as `dev`. npm records this itself; pnpm
 * records it for some generations; yarn never does — so this recomputes it from reachability and
 * makes the field mean the same thing for every format.
 */
export function markDevByReachability(graph: DepGraph): DepGraph {
  if (graph.direct.length === 0 && graph.directDev.length === 0) return graph;
  const runtime = new Set<string>(graph.direct);
  for (const n of transitiveClosure(graph, graph.direct)) runtime.add(n);
  return {
    ...graph,
    nodes: graph.nodes.map((n) => ({ ...n, dev: !runtime.has(n.name) })),
  };
}

/** Counts that feed G1/G5 directly. Dev-only packages are excluded: they never reach the browser. */
export function graphSummary(graph: DepGraph): {
  totalNodes: number;
  runtimeNodes: number;
  distinctRuntimePackages: number;
  duplicatedPackages: number;
  directRuntime: number;
  directDev: number;
} {
  const runtime = graph.nodes.filter((n) => !n.dev);
  return {
    totalNodes: graph.nodes.length,
    runtimeNodes: runtime.length,
    distinctRuntimePackages: new Set(runtime.map((n) => n.name)).size,
    duplicatedPackages: duplicateVersions(graph).length,
    directRuntime: graph.direct.length,
    directDev: graph.directDev.length,
  };
}
