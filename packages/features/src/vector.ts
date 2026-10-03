/**
 * Assembling a full feature vector, and recording which groups it actually contains.
 *
 * A vector is never "partly filled and hope for the best": `FeatureBundle` names the groups that
 * were extracted, so the ML pipeline can refuse a row that is missing a group its model needs, and
 * the UI can label a number's provenance honestly (CLAUDE.md: every number carries its provenance).
 */
import { extractAstFeatures, type AstFeatures } from './ast.ts';
import { extractContext, extractHost, extractProfile, type ContextFeatures, type HostFeatures, type ProfileFeatures } from './context.ts';
import { extractPkgMeta, type PkgMetaFeatures } from './pkgMeta.ts';
import {
  assertCoversGroups,
  assertValid,
  namesInGroup,
  SCHEMA_VERSION,
  type FeatureGroup,
  type FeatureVector,
} from './schema.ts';

/** Where a number came from (CLAUDE.md convention). */
export type Provenance = 'exact' | 'modeled' | 'predicted' | 'measured';

/** Provenance of each feature group, so the UI never shows a modelled number as measured. */
export const GROUP_PROVENANCE: Record<FeatureGroup, Provenance> = {
  G1: 'exact', // read from the installed tarball
  G2: 'exact', // byte counts from a real isolated build
  G3: 'exact', // differencing two real builds
  G4: 'exact', // AST of real added code
  G5: 'exact', // the host's own build, except host_entry_task_ms_est (see below)
  G6: 'measured', // from a measurement session
  G7: 'exact', // the machine's calibration curve
};

/**
 * Features that are modelled rather than exact, even though their group is otherwise exact.
 * `host_entry_task_ms_est` is a linear estimate (see `STATIC_MS_PER_KB`), so it must never be
 * presented as a measured millisecond.
 */
export const MODELED_FEATURES = new Set(['host_entry_task_ms_est']);

export interface FeatureBundle {
  schemaVersion: number;
  /** The groups this vector covers. */
  groups: FeatureGroup[];
  vector: FeatureVector;
  /** Non-fatal notes: a fallback that was used, a count that is a lower bound, etc. */
  notes: string[];
  extractMs: number;
}

export interface G2Metrics {
  iso_min_bytes: number;
  iso_gz_bytes: number;
  iso_br_bytes: number;
  iso_full_min_bytes: number;
  iso_treeshake_ratio: number;
  iso_modules: number;
  iso_packages: number;
  iso_cjs_byte_share: number;
}

/** Pulls exactly the G2 names out of an isolated-metrics result, so no extra key leaks through. */
export function g2Vector(metrics: G2Metrics): FeatureVector {
  const out: FeatureVector = {};
  for (const name of namesInGroup('G2')) out[name] = (metrics as unknown as Record<string, number>)[name] ?? 0;
  return out;
}

export interface BuildVectorArgs {
  /** G1 */
  pkg?: Parameters<typeof extractPkgMeta>[0];
  /** G2 — already computed by `isolatedMetrics` in @deplens/bundler-kit. */
  iso?: G2Metrics;
  /** G3 */
  context?: Parameters<typeof extractContext>[0];
  /** G4 — the unminified added code. */
  addedCode?: string;
  /** G5 */
  host?: Parameters<typeof extractHost>[0];
  /** G7 */
  profileSlowdown?: number;
}

/**
 * Builds a feature vector from whichever inputs are available, validates it against the schema,
 * and reports which groups it covers.
 *
 * Deliberately permissive about *which* groups are supplied and strict about what is inside them:
 * the tier-2 CI worker has no measurement machine, so it produces G1–G5 and G7 and no G6, while a
 * hybrid row adds G6 later. Either way a group that is present is complete.
 */
export async function buildFeatureVector(args: BuildVectorArgs): Promise<FeatureBundle> {
  const t0 = performance.now();
  const vector: FeatureVector = {};
  const groups: FeatureGroup[] = [];
  const notes: string[] = [];

  if (args.pkg) {
    const g1: PkgMetaFeatures = await extractPkgMeta(args.pkg);
    Object.assign(vector, g1);
    groups.push('G1');
    if (!args.pkg.graph) {
      notes.push('pkg_n_transitive is a lower bound: no lockfile was available for the isolated install, so it counts packages observed in the bundle.');
    }
  }

  if (args.iso) {
    Object.assign(vector, g2Vector(args.iso));
    groups.push('G2');
  }

  if (args.context) {
    const g3: ContextFeatures = extractContext(args.context);
    Object.assign(vector, g3);
    groups.push('G3');
    if (!args.context.hostGraph) notes.push('ctx_dup_versions is 0 by default: the host lockfile was not supplied.');
  }

  if (args.addedCode !== undefined) {
    const g4: AstFeatures = extractAstFeatures(args.addedCode);
    Object.assign(vector, g4);
    groups.push('G4');
    if (args.addedCode.trim() === '') {
      notes.push('The added code is empty — the host already ships everything this import needs, so every G4 feature is 0.');
    }
  }

  if (args.host) {
    const g5: HostFeatures = extractHost(args.host);
    Object.assign(vector, g5);
    groups.push('G5');
    notes.push('host_entry_task_ms_est is modelled, not measured (see STATIC_MS_PER_KB).');
  }

  if (args.profileSlowdown !== undefined) {
    const g7: ProfileFeatures = extractProfile(args.profileSlowdown);
    Object.assign(vector, g7);
    groups.push('G7');
  }

  assertValid(vector);
  assertCoversGroups(vector, groups);

  return { schemaVersion: SCHEMA_VERSION, groups, vector, notes, extractMs: performance.now() - t0 };
}

/**
 * Orders a vector's values as a dataset row, using the schema's sorted names so the CSV/Parquet
 * column order is identical in TypeScript and in Python. Missing features become `null`, which is
 * what the ML pipeline imputes — never 0, which would be a real value.
 */
export function toRow(vector: FeatureVector, names: readonly string[]): (number | boolean | string | null)[] {
  return names.map((n) => (n in vector ? vector[n]! : null));
}
