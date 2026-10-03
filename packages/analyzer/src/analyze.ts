/**
 * The static analysis pipeline (doc 01 §5, doc 06 §2).
 *
 *   host app + candidate + import spec + profile
 *     → baseline build · treatment build · isolated builds
 *     → exact Δbytes · feature vector (G1–G5, G7)
 *     → prediction + interval · verdict · "why" · advice
 *
 * No browser anywhere in this file. That is what lets the same code run on the quiet measurement
 * machine and on a GitHub Actions runner (doc 06 §7.2): byte counts are deterministic, so a shared
 * runner produces identical numbers — only *timing* needs the tuned machine.
 */
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  build,
  isolatedMetrics,
  readHostConfig,
  type BuildResult,
  type ImportSpec,
} from '@deplens/bundler-kit';
import { buildFeatureVector, type FeatureBundle } from '@deplens/features';
import { detectLockKind, LOCKFILE_NAMES, parseLockfile, type DepGraph } from '@deplens/lockfile';
import {
  adviceFor,
  attributed,
  checkDistribution,
  networkCost,
  profileByName,
  topReasons,
  verdictFor,
  type Budget,
  type CandidateReport,
  type Profile,
  type ProfileName,
} from '@deplens/shared';
import { defaultPredictor, PLACEHOLDER_DISTRIBUTION, type Predictor } from './predictor.ts';

/** Peers a host provides that an isolated build must not bundle. */
const FRAMEWORK_PEERS: Record<string, string[]> = {
  react: ['react', 'react-dom'],
  preact: ['preact'],
  vue: ['vue'],
  svelte: ['svelte'],
  solid: ['solid-js'],
  vanilla: [],
  none: [],
};

export interface AnalyzedHost {
  name: string;
  framework: string;
  baseline: BuildResult;
  graph?: DepGraph;
  workRoot: string;
  hostDir: string;
}

/**
 * Builds the host once, as the baseline every candidate is differenced against, and parses its
 * lockfile so we can tell which of a candidate's dependencies the app already ships.
 */
export async function analyzeHost(args: { hostDir: string; workRoot: string }): Promise<AnalyzedHost> {
  const host = await readHostConfig(args.hostDir);
  const baseline = await build({ hostDir: args.hostDir, spec: null, workRoot: args.workRoot });
  return {
    name: host.name,
    framework: host.framework,
    baseline,
    graph: await readHostGraph(args.hostDir),
    workRoot: args.workRoot,
    hostDir: args.hostDir,
  };
}

/** Reads whichever lockfile the host has, or none. A missing lockfile degrades features, not the run. */
async function readHostGraph(hostDir: string): Promise<DepGraph | undefined> {
  let pkgJson: Record<string, unknown> | undefined;
  try {
    pkgJson = JSON.parse(await readFile(join(hostDir, 'package.json'), 'utf8')) as Record<string, unknown>;
  } catch {
    pkgJson = undefined;
  }
  for (const name of LOCKFILE_NAMES) {
    const p = join(hostDir, name);
    if (!existsSync(p)) continue;
    const text = await readFile(p, 'utf8');
    if (!detectLockKind(name, text)) continue;
    return parseLockfile(name, text, pkgJson);
  }
  return undefined;
}

export interface CandidateInput {
  /** `name` or `name@version`. */
  pkg: string;
  spec: ImportSpec;
}

/** Splits `name@version` into the pieces npm install needs, handling scoped names. */
export function splitPkgSpec(pkg: string): { name: string; range: string } {
  const at = pkg.lastIndexOf('@');
  if (at <= 0) return { name: pkg, range: 'latest' };
  return { name: pkg.slice(0, at), range: pkg.slice(at + 1) };
}

export interface AnalyzeCandidateOptions {
  host: AnalyzedHost;
  candidate: CandidateInput;
  profile: ProfileName;
  profileSlowdown: number;
  budget?: Budget;
  predictor?: Predictor;
}

/**
 * Analyses one candidate against one host.
 *
 * The order matters: the isolated build runs **first**, because it is what tells us which packages
 * the candidate needs — and that is the input to "which of them does this app already ship?",
 * which is the context effect the project is about.
 */
export async function analyzeCandidate(opts: AnalyzeCandidateOptions): Promise<CandidateReport> {
  const t0 = performance.now();
  const { host, candidate } = opts;
  const { name, range } = splitPkgSpec(candidate.pkg);
  const deps = { [name]: range };
  const profile: Profile = profileByName(opts.profile);
  const peers = FRAMEWORK_PEERS[host.framework] ?? [];

  // 1) Isolated build: what does this import cost on its own, and what does it need?
  const iso = await isolatedMetrics({
    spec: candidate.spec,
    deps,
    workRoot: host.workRoot,
    peers,
    sharedPackages: sharedWith(host, []),
  });

  // 2) Re-derive the added code now that we know the candidate's packages: anything the host
  //    already ships is not "added", so it must be external in the AST pass.
  const shared = sharedWith(host, iso.candidatePackages);
  const isoInContext =
    shared.length > 0
      ? await isolatedMetrics({ spec: candidate.spec, deps, workRoot: host.workRoot, peers, sharedPackages: shared })
      : iso;

  // 3) Treatment build: the host with the import actually added.
  const treatment = await build({ hostDir: host.hostDir, spec: candidate.spec, deps, workRoot: host.workRoot });

  // 4) Features.
  const bundle: FeatureBundle = await buildFeatureVector({
    pkg: {
      packageDir: join(iso.workDir, 'node_modules', ...name.split('/')),
      manifest: (iso.manifests[name] ?? { name }) as Record<string, unknown>,
      bundledPackages: iso.candidatePackages,
    },
    iso,
    context: {
      baseline: summarise(host.baseline),
      treatment: summarise(treatment),
      candidatePackages: iso.candidatePackages,
      isoMinBytes: iso.iso_min_bytes,
      placement: candidate.spec.placement ?? 'initial',
      hostGraph: host.graph,
      candidateVersions: iso.resolvedDeps,
    },
    addedCode: isoInContext.addedCode,
    host: {
      framework: host.framework,
      baseline: summarise(host.baseline),
      buildTarget: host.baseline.bundler === 'vite' ? 'es2020' : 'es2020',
      profileSlowdown: opts.profileSlowdown,
    },
    profileSlowdown: opts.profileSlowdown,
  });

  // 5) Prediction, verdict, explanation.
  const predictor = opts.predictor ?? defaultPredictor;
  const prediction = predictor.predict(bundle.vector, { profileSlowdown: opts.profileSlowdown });
  const ood = checkDistribution(bundle.vector, PLACEHOLDER_DISTRIBUTION);
  const verdict = verdictFor(prediction.script, opts.budget, { outOfDistribution: ood.outOfDistribution });

  const deltaMin = treatment.initial.minBytes - host.baseline.initial.minBytes;
  const deltaGzip = treatment.initial.gzipBytes - host.baseline.initial.gzipBytes;
  const deltaBrotli = treatment.initial.brotliBytes - host.baseline.initial.brotliBytes;
  const newPackages = treatment.packages
    .filter((p) => p.name !== '(app)' && !host.baseline.packages.some((b) => b.name === p.name))
    .map((p) => p.name)
    .sort();

  const network = networkCost({
    brotliBytes: Math.max(0, deltaBrotli),
    profile,
    newChunks: Math.max(0, (treatment.outputs.filter((o) => o.initial && o.path.endsWith('.js')).length) - (host.baseline.outputs.filter((o) => o.initial && o.path.endsWith('.js')).length)),
  });

  const totalMs = performance.now() - t0;

  return {
    candidate: {
      name,
      version: iso.resolvedDeps[name] ?? null,
      import: candidate.spec.code,
    },
    profile: opts.profile,
    bytes: {
      // Counted by differencing two real builds — the one part of the report that is exact.
      min: attributed(deltaMin, 'exact', { unit: 'B' }),
      gzip: attributed(deltaGzip, 'exact', { unit: 'B' }),
      brotli: attributed(deltaBrotli, 'exact', { unit: 'B' }),
      newPackages,
      sharedWithApp: shared,
    },
    network: { ...attributed(network.ms, network.provenance, { unit: 'ms' }), model: network.model },
    script: attributed(prediction.script.point, 'predicted', {
      unit: 'ms',
      interval: [prediction.script.low, prediction.script.high],
      note: prediction.model.note,
    }),
    tbt: attributed(prediction.tbt.point, 'predicted', {
      unit: 'ms',
      interval: [prediction.tbt.low, prediction.tbt.high],
    }),
    verdict,
    why: topReasons(bundle.vector),
    advice: adviceFor(bundle.vector, { packageName: name }),
    outOfDistribution: ood,
    model: prediction.model,
    features: bundle.vector,
    featureGroups: bundle.groups,
    notes: bundle.notes,
    timings: {
      installMs: iso.installMs,
      buildMs: iso.buildMs + treatment.buildMs,
      extractMs: bundle.extractMs,
      totalMs,
    },
  };
}

/** Candidate packages the host's baseline bundle already contains. */
function sharedWith(host: AnalyzedHost, candidatePackages: readonly string[]): string[] {
  const inBaseline = new Set(host.baseline.packages.filter((p) => p.name !== '(app)').map((p) => p.name));
  return candidatePackages.filter((p) => inBaseline.has(p)).sort();
}

/** Narrows a `BuildResult` to the fields the feature extractors read. */
function summarise(b: BuildResult) {
  return {
    initial: b.initial,
    modules: b.modules,
    packages: b.packages,
    initialChunks: b.outputs.filter((o) => o.initial && o.path.endsWith('.js')).length,
  };
}

export interface RankedCandidate {
  name: string;
  rank: number;
  /** True when this candidate's interval overlaps the previous one's — "no clear difference". */
  tiedWithPrevious: boolean;
}

/**
 * Ranks candidates cheapest-first and marks pairs the intervals cannot separate.
 *
 * Doc 05's UC-02 asks for exactly this honesty: `dayjs` and `date-fns` should come back as "no
 * clear difference" rather than as 1st and 2nd place, because claiming an order the data does not
 * support is the failure mode of every size-comparison tool.
 */
export function rankCandidates(reports: readonly CandidateReport[]): RankedCandidate[] {
  const sorted = [...reports].sort((a, b) => a.script.value - b.script.value);
  return sorted.map((r, i) => {
    const prev = sorted[i - 1];
    const tied =
      prev !== undefined &&
      intervalsOverlap(
        r.script.interval ?? [r.script.value, r.script.value],
        prev.script.interval ?? [prev.script.value, prev.script.value],
      );
    return { name: r.candidate.name, rank: i + 1, tiedWithPrevious: tied };
  });
}

const intervalsOverlap = (a: [number, number], b: [number, number]) => a[0] <= b[1] && b[0] <= a[1];
