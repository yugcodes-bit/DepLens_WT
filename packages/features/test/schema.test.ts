/**
 * The schema is the single source of truth for feature names (CLAUDE.md), and doc 09's P3 exit
 * criterion is that the TS and Python sides agree on it. These tests are the TS half of that
 * contract; `ml/tests/test_schema_contract.py` is the other half and asserts the same digest.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  assertCoversGroups,
  assertValid,
  featureDef,
  featureNames,
  namesInGroup,
  SCHEMA,
  SCHEMA_VERSION,
  schemaContract,
  SchemaViolationError,
  validateVector,
} from '../src/schema.ts';

const require = createRequire(import.meta.url);
const contractPath = require.resolve('@deplens/feature-schema/contract.json');
const committed = JSON.parse(readFileSync(contractPath, 'utf8')) as {
  schemaVersion: number;
  featureCount: number;
  countsByGroup: Record<string, number>;
  targets: string[];
  digest: string;
  names: string[];
};

describe('schema contract (doc 09 P3 exit criterion)', () => {
  it('matches the committed contract snapshot', () => {
    const live = schemaContract();
    expect(live.schemaVersion).toBe(committed.schemaVersion);
    expect(live.featureCount).toBe(committed.featureCount);
    expect(live.countsByGroup).toEqual(committed.countsByGroup);
    expect(live.targets).toEqual(committed.targets);
    expect(live.names).toEqual(committed.names);
  });

  it('reproduces the committed digest', () => {
    const digest = createHash('sha256')
      .update(
        JSON.stringify(
          SCHEMA.features.map((f) => [f.name, f.group, f.type]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
        ),
      )
      .digest('hex');
    expect(digest).toBe(committed.digest);
  });

  it('has no duplicate feature names', () => {
    const names = featureNames();
    expect(new Set(names).size).toBe(names.length);
  });

  it('declares a group and a type for every feature', () => {
    for (const f of SCHEMA.features) {
      expect(f.group).toMatch(/^G[1-7]$/);
      expect(['number', 'integer', 'boolean', 'category']).toContain(f.type);
      expect(f.description.length).toBeGreaterThan(0);
    }
  });

  it('gives every category feature a closed value list', () => {
    for (const f of SCHEMA.features.filter((x) => x.type === 'category')) {
      expect(f.values, `${f.name} must declare its allowed values`).toBeDefined();
      expect(f.values!.length).toBeGreaterThan(1);
    }
  });

  it('declares exactly one primary target', () => {
    expect(SCHEMA.targets.filter((t) => t.primary)).toHaveLength(1);
    expect(SCHEMA.targets.find((t) => t.primary)!.name).toBe('delta_script_ms');
  });

  it('groups add up to the feature count', () => {
    const sum = (['G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7'] as const).reduce((s, g) => s + namesInGroup(g).length, 0);
    expect(sum).toBe(SCHEMA.features.length);
  });
});

describe('validateVector', () => {
  it('accepts a well-typed vector', () => {
    expect(validateVector({ pkg_js_files: 3, pkg_has_wasm: false, pkg_format: 'esm' })).toEqual([]);
  });

  it('rejects a name that is not in the schema — no invented features', () => {
    expect(validateVector({ made_up_feature: 1 })).toEqual([
      { feature: 'made_up_feature', problem: 'not declared in feature-schema.json' },
    ]);
  });

  it('rejects a category value outside its declared list', () => {
    const v = validateVector({ pkg_format: 'typescript' });
    expect(v).toHaveLength(1);
    expect(v[0]!.problem).toMatch(/is not one of esm \| cjs \| dual \| umd/);
  });

  it('rejects a non-integer where an integer is declared', () => {
    expect(validateVector({ pkg_js_files: 3.5 })[0]!.problem).toMatch(/expected an integer/);
  });

  it('rejects NaN and Infinity — a non-finite number must never reach a model', () => {
    expect(validateVector({ iso_treeshake_ratio: Number.NaN })[0]!.problem).toMatch(/expected a finite number/);
    expect(validateVector({ iso_treeshake_ratio: Number.POSITIVE_INFINITY })[0]!.problem).toMatch(/expected a finite number/);
  });

  it('rejects a string where a number is declared', () => {
    expect(validateVector({ iso_min_bytes: '100' as unknown as number })[0]!.problem).toMatch(/expected a finite number/);
  });

  it('allows an explicit null, which the pipeline imputes', () => {
    expect(validateVector({ iso_min_bytes: null })).toEqual([]);
  });

  it('assertValid throws a listing error', () => {
    expect(() => assertValid({ nope: 1, pkg_format: 'bad' })).toThrow(SchemaViolationError);
    try {
      assertValid({ nope: 1 });
    } catch (e) {
      expect((e as SchemaViolationError).violations).toHaveLength(1);
      expect((e as Error).message).toContain(`v${SCHEMA_VERSION}`);
    }
  });
});

describe('assertCoversGroups', () => {
  it('accepts a vector that covers a group exactly', () => {
    const vector = Object.fromEntries(namesInGroup('G7').map((n) => [n, 1]));
    expect(() => assertCoversGroups(vector, ['G7'])).not.toThrow();
  });

  it('rejects a half-filled group', () => {
    expect(() => assertCoversGroups({ iso_min_bytes: 1 }, ['G2'])).toThrow(/missing from a vector that claims to cover G2/);
  });

  it('rejects a feature from a group that was not extracted', () => {
    const vector = { ...Object.fromEntries(namesInGroup('G7').map((n) => [n, 1])), iso_min_bytes: 5 };
    expect(() => assertCoversGroups(vector, ['G7'])).toThrow(/present but outside G7/);
  });
});

describe('featureDef', () => {
  it('exposes monotonicity for the features that have it, so a constraint can be set', () => {
    expect(featureDef('iso_min_bytes')?.monotone).toBe(1);
    expect(featureDef('profile_slowdown')?.monotone).toBe(1);
  });

  it('returns undefined for an unknown name', () => {
    expect(featureDef('not_a_feature')).toBeUndefined();
  });
});
