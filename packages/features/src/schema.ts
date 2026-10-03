/**
 * The feature schema is the single source of truth for feature names (CLAUDE.md, doc 08 §3).
 *
 * Nothing in this package may invent a feature name: every extractor emits a record which is
 * checked against `feature-schema.json` before it leaves the package. That check is what keeps the
 * TypeScript extractors and the Python ML pipeline from drifting apart — both read this one file,
 * and `schemaContract` is asserted on both sides (doc 09 P3 exit criterion).
 */
import schemaJson from '@deplens/feature-schema/feature-schema.json' with { type: 'json' };

export type FeatureGroup = 'G1' | 'G2' | 'G3' | 'G4' | 'G5' | 'G6' | 'G7';
export type FeatureType = 'number' | 'integer' | 'boolean' | 'category';

export interface FeatureDef {
  name: string;
  group: FeatureGroup;
  type: FeatureType;
  unit: string | null;
  description: string;
  values?: string[];
  monotone?: number;
}

export interface TargetDef {
  name: string;
  description: string;
  primary: boolean;
}

export interface FeatureSchema {
  schemaVersion: number;
  groups: Record<FeatureGroup, string>;
  targets: TargetDef[];
  features: FeatureDef[];
}

export const SCHEMA = schemaJson as unknown as FeatureSchema;
export const SCHEMA_VERSION = SCHEMA.schemaVersion;

const BY_NAME = new Map<string, FeatureDef>(SCHEMA.features.map((f) => [f.name, f]));

export const featureNames = (): string[] => SCHEMA.features.map((f) => f.name);

export const featureDef = (name: string): FeatureDef | undefined => BY_NAME.get(name);

export const namesInGroup = (group: FeatureGroup): string[] =>
  SCHEMA.features.filter((f) => f.group === group).map((f) => f.name);

/** A feature value. Categories are strings; everything else is numeric or boolean. */
export type FeatureValue = number | boolean | string | null;

export type FeatureVector = Record<string, FeatureValue>;

export interface SchemaViolation {
  feature: string;
  problem: string;
}

/**
 * Checks a vector against the schema: no unknown names, no wrong types, no category value outside
 * its declared set, and no non-finite numbers (a NaN reaching a model is a silent bug).
 */
export function validateVector(vector: FeatureVector): SchemaViolation[] {
  const violations: SchemaViolation[] = [];
  for (const [name, value] of Object.entries(vector)) {
    const def = BY_NAME.get(name);
    if (!def) {
      violations.push({ feature: name, problem: 'not declared in feature-schema.json' });
      continue;
    }
    if (value === null) continue; // an explicitly missing feature is allowed; the model imputes it
    switch (def.type) {
      case 'boolean':
        if (typeof value !== 'boolean') violations.push({ feature: name, problem: `expected boolean, got ${typeof value}` });
        break;
      case 'category':
        if (typeof value !== 'string') violations.push({ feature: name, problem: `expected string, got ${typeof value}` });
        else if (def.values && !def.values.includes(value)) {
          violations.push({ feature: name, problem: `value ${JSON.stringify(value)} is not one of ${def.values.join(' | ')}` });
        }
        break;
      case 'integer':
        if (typeof value !== 'number' || !Number.isFinite(value)) {
          violations.push({ feature: name, problem: `expected a finite number, got ${JSON.stringify(value)}` });
        } else if (!Number.isInteger(value)) {
          violations.push({ feature: name, problem: `expected an integer, got ${value}` });
        }
        break;
      case 'number':
        if (typeof value !== 'number' || !Number.isFinite(value)) {
          violations.push({ feature: name, problem: `expected a finite number, got ${JSON.stringify(value)}` });
        }
        break;
    }
  }
  return violations;
}

export class SchemaViolationError extends Error {
  constructor(public readonly violations: SchemaViolation[]) {
    super(
      `Feature vector violates feature-schema.json (v${SCHEMA_VERSION}):\n` +
        violations.map((v) => `  ${v.feature}: ${v.problem}`).join('\n'),
    );
    this.name = 'SchemaViolationError';
  }
}

/** Validates and returns the vector, or throws. Every extractor's exit point goes through this. */
export function assertValid(vector: FeatureVector): FeatureVector {
  const violations = validateVector(vector);
  if (violations.length > 0) throw new SchemaViolationError(violations);
  return vector;
}

/**
 * Asserts that a vector covers exactly the named groups — no feature of those groups missing, and
 * nothing from a group that was not extracted. Used by the contract test and by the analyzer, so a
 * half-filled vector cannot reach the dataset.
 */
export function assertCoversGroups(vector: FeatureVector, groups: readonly FeatureGroup[]): void {
  const expected = new Set(groups.flatMap(namesInGroup));
  const actual = new Set(Object.keys(vector));
  const missing = [...expected].filter((n) => !actual.has(n));
  const extra = [...actual].filter((n) => !expected.has(n));
  const violations: SchemaViolation[] = [
    ...missing.map((feature) => ({ feature, problem: `missing from a vector that claims to cover ${groups.join('+')}` })),
    ...extra.map((feature) => ({ feature, problem: `present but outside ${groups.join('+')}` })),
  ];
  if (violations.length > 0) throw new SchemaViolationError(violations);
}

/**
 * The contract both language sides assert on. Keeping it as data (rather than a hand-written list)
 * means a schema edit that forgets to bump `schemaVersion` still shows up as a changed digest.
 */
export interface SchemaContract {
  schemaVersion: number;
  featureCount: number;
  /** Feature names, sorted — the order a dataset's columns are written in. */
  names: string[];
  countsByGroup: Record<string, number>;
  targets: string[];
}

export function schemaContract(): SchemaContract {
  const countsByGroup: Record<string, number> = {};
  for (const f of SCHEMA.features) countsByGroup[f.group] = (countsByGroup[f.group] ?? 0) + 1;
  return {
    schemaVersion: SCHEMA_VERSION,
    featureCount: SCHEMA.features.length,
    names: [...featureNames()].sort(),
    countsByGroup,
    targets: SCHEMA.targets.map((t) => t.name),
  };
}
