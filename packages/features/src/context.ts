/**
 * Feature groups G3 (in-context delta) and G5 (host context) — doc 08 §3.
 *
 * G3 is the heart of the project's claim: the same import costs different amounts in different
 * apps, and `ctx_shared_packages` / `ctx_shared_bytes_saved` are the features that say *why*.
 * They are exact, not modelled — they come from differencing two real builds — so a row's G3
 * values carry provenance `exact`.
 */
import { duplicateVersions, hasPackage, type DepGraph } from '@deplens/lockfile';
import type { FeatureVector } from './schema.ts';

export type HostFramework = 'vanilla' | 'react' | 'vue' | 'svelte' | 'preact' | 'solid' | 'other';
export type BuildTarget = 'es2015' | 'es2017' | 'es2020' | 'es2022' | 'esnext';

const FRAMEWORKS: HostFramework[] = ['vanilla', 'react', 'vue', 'svelte', 'preact', 'solid'];
const TARGETS: BuildTarget[] = ['es2015', 'es2017', 'es2020', 'es2022', 'esnext'];

/** Maps a host's declared framework onto the schema's closed category list. */
export function normaliseFramework(raw: string | undefined): HostFramework {
  const v = (raw ?? '').toLowerCase().trim();
  if (FRAMEWORKS.includes(v as HostFramework)) return v as HostFramework;
  // `none` is what the empty host declares; it ships no framework, which is what `vanilla` means.
  if (v === 'none' || v === '') return 'vanilla';
  return 'other';
}

export function normaliseTarget(raw: string | undefined): BuildTarget {
  const v = (raw ?? '').toLowerCase().trim();
  return TARGETS.includes(v as BuildTarget) ? (v as BuildTarget) : 'esnext';
}

export interface ContextFeatures extends FeatureVector {
  ctx_delta_min_bytes: number;
  ctx_delta_gz_bytes: number;
  ctx_delta_br_bytes: number;
  ctx_delta_modules: number;
  ctx_new_packages: number;
  ctx_shared_packages: number;
  ctx_shared_bytes_saved: number;
  ctx_dup_versions: number;
  ctx_in_initial_chunk: boolean;
  ctx_delta_chunks: number;
}

/** The shape both bundlers' build results share (doc 07 §2.3) — only the fields G3/G5 need. */
export interface BuildSummary {
  initial: { minBytes: number; gzipBytes: number; brotliBytes: number };
  modules: number;
  packages: { name: string; bytesInOutput: number }[];
  /** Number of initial JS output files. */
  initialChunks?: number;
}

export function extractContext(args: {
  baseline: BuildSummary;
  treatment: BuildSummary;
  /** Packages the candidate needs, from the isolated build. */
  candidatePackages: readonly string[];
  /** `iso_min_bytes`, so the bytes the context saved can be computed. */
  isoMinBytes: number;
  /** `initial` or `lazy` — the placement the import spec asked for (FR-14). */
  placement?: 'initial' | 'lazy';
  /** The host's lockfile graph, for duplicate-version detection. */
  hostGraph?: DepGraph;
  /** Versions the candidate install resolved to, to spot a duplicate of an already-present package. */
  candidateVersions?: Record<string, string>;
}): ContextFeatures {
  const { baseline, treatment, candidatePackages, isoMinBytes } = args;
  const basePackages = new Map(baseline.packages.map((p) => [p.name, p.bytesInOutput]));

  const newPackages = treatment.packages.filter((p) => p.name !== '(app)' && !basePackages.has(p.name)).length;
  const sharedPackages = candidatePackages.filter((n) => basePackages.has(n)).length;

  const deltaMin = treatment.initial.minBytes - baseline.initial.minBytes;

  return {
    ctx_delta_min_bytes: deltaMin,
    ctx_delta_gz_bytes: treatment.initial.gzipBytes - baseline.initial.gzipBytes,
    ctx_delta_br_bytes: treatment.initial.brotliBytes - baseline.initial.brotliBytes,
    ctx_delta_modules: treatment.modules - baseline.modules,
    ctx_new_packages: newPackages,
    ctx_shared_packages: sharedPackages,
    // The context effect on bytes: what the app's existing dependencies saved the candidate.
    ctx_shared_bytes_saved: isoMinBytes - deltaMin,
    ctx_dup_versions: countDuplicateVersions(args.hostGraph, args.candidateVersions),
    ctx_in_initial_chunk: (args.placement ?? 'initial') === 'initial',
    ctx_delta_chunks: (treatment.initialChunks ?? 0) - (baseline.initialChunks ?? 0),
  };
}

/**
 * Versions the candidate adds that duplicate a package the host already has at a *different*
 * version. Those bytes are paid twice, which is a cost no size tool reports.
 */
function countDuplicateVersions(hostGraph?: DepGraph, candidateVersions?: Record<string, string>): number {
  if (!hostGraph) return 0;
  if (!candidateVersions) return duplicateVersions(hostGraph).length;
  let n = 0;
  for (const [name, version] of Object.entries(candidateVersions)) {
    if (!hasPackage(hostGraph, name)) continue;
    if (hostGraph.nodes.some((node) => node.name === name && node.version !== version)) n++;
  }
  return n;
}

export interface HostFeatures extends FeatureVector {
  host_framework: HostFramework;
  host_baseline_min_bytes: number;
  host_modules: number;
  host_packages: number;
  host_build_target: BuildTarget;
  host_entry_eval_share: number;
  host_entry_task_ms_est: number;
}

/**
 * Bytes-per-millisecond used by the *static* estimate of the host's entry-evaluation task
 * (`host_entry_task_ms_est`).
 *
 * This is a deliberately crude linear stand-in, and it is a **modelled** number, never reported to
 * a user as measured. Its only job is to give the static-only model a host-scale signal; the hybrid
 * model replaces it with `host_entry_task_ms` (G6), which is measured. The constant comes from the
 * Phase 0 spike on the dev laptop at profile slowdown 1 (see docs/research-log.md) and is
 * re-derivable from any calibration sweep.
 */
export const STATIC_MS_PER_KB = 0.055;

export function extractHost(args: {
  framework: string | undefined;
  baseline: BuildSummary;
  buildTarget?: string;
  /** Bytes of the entry chunk alone, when the bundler reported per-chunk sizes. */
  entryChunkBytes?: number;
  profileSlowdown?: number;
}): HostFeatures {
  const baselineBytes = args.baseline.initial.minBytes;
  const entryShare = baselineBytes > 0 && args.entryChunkBytes !== undefined ? args.entryChunkBytes / baselineBytes : 1;
  const slowdown = args.profileSlowdown ?? 1;

  return {
    host_framework: normaliseFramework(args.framework),
    host_baseline_min_bytes: baselineBytes,
    host_modules: args.baseline.modules,
    host_packages: args.baseline.packages.filter((p) => p.name !== '(app)').length,
    host_build_target: normaliseTarget(args.buildTarget),
    host_entry_eval_share: Math.min(1, Math.max(0, entryShare)),
    host_entry_task_ms_est: (baselineBytes / 1024) * STATIC_MS_PER_KB * slowdown,
  };
}

export interface ProfileFeatures extends FeatureVector {
  profile_slowdown: number;
}

/** Feature group G7 — the device profile, as a calibrated slowdown rather than a CDP rate. */
export function extractProfile(slowdown: number): ProfileFeatures {
  return { profile_slowdown: slowdown };
}
