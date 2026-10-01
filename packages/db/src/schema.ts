/**
 * PostgreSQL schema for DepLens — the ERD in doc 06 §6, as Drizzle tables.
 *
 * Two groups of tables share one database (doc 06 §1):
 *   - **research**: package · import_spec · host_app · profile · machine · build · session · run ·
 *     label · feature_row · model — everything a dataset release is built from.
 *   - **product**: project · analysis · prediction — what a user's analysis produces.
 *
 * Conventions:
 *   - UUID primary keys, `timestamptz` timestamps, JSONB for anything whose shape belongs to a
 *     versioned schema elsewhere (metrics, feature vectors) rather than to SQL.
 *   - Measured values keep their provenance: a label row always points at the session, machine and
 *     profile that produced it (NFR-REP1), and raw traces live in object storage with only the URI here.
 *   - Natural keys get unique constraints so a resumed campaign cannot create duplicates (FR-51).
 */
import { relations } from 'drizzle-orm';
import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const now = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

/** Why a package is or is not in the corpus (doc 07 §6.2 — the reason is recorded, not just the verdict). */
export const packageStatus = pgEnum('package_status', ['candidate', 'included', 'excluded', 'failed']);
/** Import scenario per package (doc 07 §2.2). */
export const importKind = pgEnum('import_kind', ['full', 'typical', 'subpath', 'custom']);
export const placement = pgEnum('placement', ['initial', 'lazy']);
/** Paired treatment, A/A noise, isolated-on-empty-page (doc 06 §6). */
export const sessionKind = pgEnum('session_kind', ['ab', 'aa', 'iso']);
export const sessionStatus = pgEnum('session_status', ['queued', 'running', 'ok', 'failed', 'aborted', 'invalid']);
export const buildStatus = pgEnum('build_status', ['ok', 'failed', 'invalid']);
export const runArm = pgEnum('run_arm', ['a', 'b']);
export const projectMode = pgEnum('project_mode', ['quick', 'full']);
export const analysisStatus = pgEnum('analysis_status', ['queued', 'resolving', 'building', 'extracting', 'predicting', 'done', 'error']);

// ---------------------------------------------------------------------------- research: what we measure

export const packages = pgTable(
  'package',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    version: text('version').notNull(),
    tarballSha: text('tarball_sha'),
    unpackedBytes: integer('unpacked_bytes'),
    /** esm | cjs | dual | unknown — of the resolved browser entry. */
    moduleFormat: text('module_format'),
    /** package.json `sideEffects` as written (false, true, or a glob list). */
    sideEffects: text('side_effects'),
    deps: jsonb('deps').$type<Record<string, string>>(),
    peerDeps: jsonb('peer_deps').$type<Record<string, string>>(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    weeklyDownloads: integer('weekly_downloads'),
    category: text('category'),
    status: packageStatus('status').notNull().default('candidate'),
    /** Why it was excluded (doc 07 §6.2): node-only, cli, type-only, fails-to-bundle, … */
    statusReason: text('status_reason'),
    /** Alternative group, e.g. 'dates' or 'http', used for the ranking evaluation (RQ4). */
    alternativeGroup: text('alternative_group'),
    createdAt: now(),
  },
  (t) => [uniqueIndex('package_name_version_uq').on(t.name, t.version), index('package_group_idx').on(t.alternativeGroup)],
);

export const importSpecs = pgTable(
  'import_spec',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    packageId: uuid('package_id')
      .notNull()
      .references(() => packages.id, { onDelete: 'cascade' }),
    kind: importKind('kind').notNull(),
    /** The exact import statement(s) injected into the host entry. */
    code: text('code').notNull(),
    sinkExpr: text('sink_expr'),
    placement: placement('placement').notNull().default('initial'),
    /** Set when the import text was drafted by an LLM and then checked by a human (doc 09 R6). */
    humanVerified: boolean('human_verified').notNull().default(false),
    createdAt: now(),
  },
  (t) => [uniqueIndex('import_spec_uq').on(t.packageId, t.code, t.placement)],
);

export const hostApps = pgTable(
  'host_app',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull().unique(),
    framework: text('framework').notNull(),
    bundler: text('bundler').notNull().default('vite'),
    repoUrl: text('repo_url'),
    commitSha: text('commit_sha'),
    /** Content hash of the host sources — the same value the harness computes (hostFingerprint). */
    fingerprint: text('fingerprint'),
    baselineMinBytes: integer('baseline_min_bytes'),
    baselineBrotliBytes: integer('baseline_brotli_bytes'),
    createdAt: now(),
  },
);

export const profiles = pgTable('profile', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().unique(),
  /** Target calibration slowdown, not a raw CDP rate (doc 07 §3.3). */
  targetSlowdown: doublePrecision('target_slowdown').notNull(),
  rttMs: integer('rtt_ms').notNull(),
  downKbps: integer('down_kbps').notNull(),
  calibrationRef: text('calibration_ref'),
  createdAt: now(),
});

export const machines = pgTable('machine', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** Stable machine id the harness derives from hostname + CPU + cores. */
  harnessId: text('harness_id').notNull().unique(),
  hostname: text('hostname').notNull(),
  cpuModel: text('cpu_model').notNull(),
  cpus: integer('cpus').notNull(),
  os: text('os').notNull(),
  chromiumVersion: text('chromium_version').notNull(),
  playwrightVersion: text('playwright_version'),
  nodeVersion: text('node_version'),
  /** rate → median calibration ms (the whole curve, doc 07 §3.3). */
  calibration: jsonb('calibration').$type<Record<string, number>>().notNull(),
  machineIndex: integer('machine_index'),
  /** Conditions that disqualify the machine for dataset cells (doc 07 §3.1). */
  warnings: jsonb('warnings').$type<string[]>(),
  createdAt: now(),
});

export const builds = pgTable(
  'build',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    hostAppId: uuid('host_app_id')
      .notNull()
      .references(() => hostApps.id, { onDelete: 'cascade' }),
    /** null = the baseline build of this host. */
    importSpecId: uuid('import_spec_id').references(() => importSpecs.id, { onDelete: 'cascade' }),
    /** The harness build key — content hash of host + spec + deps + bundler. */
    buildKey: text('build_key').notNull(),
    bundler: text('bundler').notNull(),
    bundlerVersion: text('bundler_version').notNull(),
    minBytes: integer('min_bytes').notNull(),
    gzBytes: integer('gz_bytes').notNull(),
    brBytes: integer('br_bytes').notNull(),
    modules: integer('modules'),
    /** Bytes in the initial JS per package, and the resolved versions that were installed. */
    packageBytes: jsonb('package_bytes').$type<{ name: string; bytesInOutput: number }[]>(),
    resolvedDeps: jsonb('resolved_deps').$type<Record<string, string>>(),
    metafileUri: text('metafile_uri'),
    status: buildStatus('status').notNull().default('ok'),
    statusReason: text('status_reason'),
    buildMs: integer('build_ms'),
    installMs: integer('install_ms'),
    createdAt: now(),
  },
  (t) => [uniqueIndex('build_key_uq').on(t.buildKey), index('build_host_idx').on(t.hostAppId)],
);

export const sessions = pgTable(
  'session',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    hostAppId: uuid('host_app_id')
      .notNull()
      .references(() => hostApps.id, { onDelete: 'cascade' }),
    /** null for A/A sessions, which have no treatment. */
    importSpecId: uuid('import_spec_id').references(() => importSpecs.id, { onDelete: 'cascade' }),
    profileId: uuid('profile_id')
      .notNull()
      .references(() => profiles.id),
    machineId: uuid('machine_id')
      .notNull()
      .references(() => machines.id),
    baselineBuildId: uuid('baseline_build_id').references(() => builds.id),
    treatmentBuildId: uuid('treatment_build_id').references(() => builds.id),
    kind: sessionKind('kind').notNull(),
    /** Resume key: identical cells must not be measured twice (FR-51). */
    cellKey: text('cell_key').notNull(),
    kPairs: integer('k_pairs').notNull(),
    seed: integer('seed').notNull(),
    cpuRate: doublePrecision('cpu_rate').notNull(),
    calibrationBeforeMs: doublePrecision('calibration_before_ms'),
    calibrationAfterMs: doublePrecision('calibration_after_ms'),
    calibrationRefMs: doublePrecision('calibration_ref_ms'),
    /** Exact byte deltas of this cell — the B3 baseline and a feature group (doc 08 §4). */
    deltaMinBytes: integer('delta_min_bytes'),
    deltaGzBytes: integer('delta_gz_bytes'),
    deltaBrBytes: integer('delta_br_bytes'),
    newPackages: jsonb('new_packages').$type<string[]>(),
    sharedPackages: jsonb('shared_packages').$type<string[]>(),
    status: sessionStatus('status').notNull().default('queued'),
    statusReason: text('status_reason'),
    invalidRuns: integer('invalid_runs').notNull().default(0),
    /** Chromium/Playwright/Node versions, flags, trace categories — the reproducibility record. */
    env: jsonb('env').$type<Record<string, unknown>>(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    durationMs: integer('duration_ms'),
    createdAt: now(),
  },
  (t) => [
    uniqueIndex('session_cell_key_uq').on(t.cellKey, t.machineId),
    index('session_host_profile_idx').on(t.hostAppId, t.profileId),
    index('session_kind_idx').on(t.kind),
  ],
);

export const runs = pgTable(
  'run',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    arm: runArm('arm').notNull(),
    /** Pair index within the session; the warm-up pair is not stored. */
    pairIndex: integer('pair_index').notNull(),
    orderAb: text('order_ab').notNull(),
    /** Per-run metrics exactly as the trace parser produced them (doc 07 §4). */
    metrics: jsonb('metrics').$type<Record<string, unknown>>().notNull(),
    traceUri: text('trace_uri'),
    error: text('error'),
    createdAt: now(),
  },
  (t) => [uniqueIndex('run_uq').on(t.sessionId, t.pairIndex, t.arm), index('run_session_idx').on(t.sessionId)],
);

export const labels = pgTable(
  'label',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    /** scriptThread (primary), tbtLoad, compileThread, … (LABEL_METRICS in the harness). */
    metric: text('metric').notNull(),
    /** Hodges–Lehmann estimate of the paired differences, with a bootstrap CI. */
    estimate: doublePrecision('estimate').notNull(),
    ciLow: doublePrecision('ci_low').notNull(),
    ciHigh: doublePrecision('ci_high').notNull(),
    nValid: integer('n_valid').notNull(),
    /** Median of the baseline arm — needed to express a cost relative to the host. */
    baselineMedian: doublePrecision('baseline_median'),
    /** True when |estimate| is below the host/profile A/A noise floor (doc 07 §7). */
    withinNoise: boolean('within_noise'),
    createdAt: now(),
  },
  (t) => [uniqueIndex('label_uq').on(t.sessionId, t.metric), index('label_metric_idx').on(t.metric)],
);

export const featureRows = pgTable(
  'feature_row',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    hostAppId: uuid('host_app_id')
      .notNull()
      .references(() => hostApps.id, { onDelete: 'cascade' }),
    importSpecId: uuid('import_spec_id')
      .notNull()
      .references(() => importSpecs.id, { onDelete: 'cascade' }),
    /** Bumped whenever feature-schema.json changes; invalidates cached vectors (NFR-M3). */
    schemaVersion: integer('schema_version').notNull(),
    vector: jsonb('vector').$type<Record<string, number | string | boolean | null>>().notNull(),
    createdAt: now(),
  },
  (t) => [uniqueIndex('feature_row_uq').on(t.hostAppId, t.importSpecId, t.schemaVersion)],
);

export const models = pgTable('model', {
  id: uuid('id').primaryKey().defaultRandom(),
  version: text('version').notNull().unique(),
  /** Hash of the frozen dataset the model was trained on, and the code that trained it. */
  datasetHash: text('dataset_hash').notNull(),
  gitSha: text('git_sha').notNull(),
  schemaVersion: integer('schema_version').notNull(),
  metrics: jsonb('metrics').$type<Record<string, unknown>>(),
  artifactUri: text('artifact_uri').notNull(),
  current: boolean('current').notNull().default(false),
  createdAt: now(),
});

// ---------------------------------------------------------------------------- product: what a user asks

export const projects = pgTable('project', {
  id: uuid('id').primaryKey().defaultRandom(),
  mode: projectMode('mode').notNull(),
  manifestHash: text('manifest_hash').notNull(),
  framework: text('framework'),
  storageUri: text('storage_uri'),
  /** Uploaded projects are deleted after 24 h unless the user opts in (NFR-S2). */
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  contributeOptIn: boolean('contribute_opt_in').notNull().default(false),
  createdAt: now(),
});

export const analyses = pgTable(
  'analysis',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    profileId: uuid('profile_id')
      .notNull()
      .references(() => profiles.id),
    candidates: jsonb('candidates').$type<{ name: string; version?: string; import?: string; placement?: string }[]>().notNull(),
    budget: jsonb('budget').$type<{ scriptMs?: number; brotliBytes?: number }>(),
    status: analysisStatus('status').notNull().default('queued'),
    statusReason: text('status_reason'),
    result: jsonb('result').$type<Record<string, unknown>>(),
    createdAt: now(),
  },
  (t) => [index('analysis_project_idx').on(t.projectId)],
);

export const predictions = pgTable(
  'prediction',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    analysisId: uuid('analysis_id')
      .notNull()
      .references(() => analyses.id, { onDelete: 'cascade' }),
    candidateIdx: integer('candidate_idx').notNull(),
    modelId: uuid('model_id')
      .notNull()
      .references(() => models.id),
    metric: text('metric').notNull().default('scriptThread'),
    point: doublePrecision('point').notNull(),
    p10: doublePrecision('p10').notNull(),
    p90: doublePrecision('p90').notNull(),
    /** TreeSHAP contributions, which the UI turns into the "why" list (FR-23). */
    contributions: jsonb('contributions').$type<{ feature: string; value: number }[]>(),
    /** Set when the request falls outside the training distribution (FR-25). */
    outOfDistribution: boolean('out_of_distribution').notNull().default(false),
    /** The session that verified this prediction, once the user clicks Verify (FR-07). */
    verifiedSessionId: uuid('verified_session_id').references(() => sessions.id),
    createdAt: now(),
  },
  (t) => [uniqueIndex('prediction_uq').on(t.analysisId, t.candidateIdx, t.metric, t.modelId)],
);

// ---------------------------------------------------------------------------- relations

export const packagesRelations = relations(packages, ({ many }) => ({ importSpecs: many(importSpecs) }));

export const importSpecsRelations = relations(importSpecs, ({ one, many }) => ({
  package: one(packages, { fields: [importSpecs.packageId], references: [packages.id] }),
  sessions: many(sessions),
  builds: many(builds),
  featureRows: many(featureRows),
}));

export const hostAppsRelations = relations(hostApps, ({ many }) => ({
  sessions: many(sessions),
  builds: many(builds),
  featureRows: many(featureRows),
}));

export const sessionsRelations = relations(sessions, ({ one, many }) => ({
  hostApp: one(hostApps, { fields: [sessions.hostAppId], references: [hostApps.id] }),
  importSpec: one(importSpecs, { fields: [sessions.importSpecId], references: [importSpecs.id] }),
  profile: one(profiles, { fields: [sessions.profileId], references: [profiles.id] }),
  machine: one(machines, { fields: [sessions.machineId], references: [machines.id] }),
  runs: many(runs),
  labels: many(labels),
}));

export const runsRelations = relations(runs, ({ one }) => ({
  session: one(sessions, { fields: [runs.sessionId], references: [sessions.id] }),
}));

export const labelsRelations = relations(labels, ({ one }) => ({
  session: one(sessions, { fields: [labels.sessionId], references: [sessions.id] }),
}));

export const analysesRelations = relations(analyses, ({ one, many }) => ({
  project: one(projects, { fields: [analyses.projectId], references: [projects.id] }),
  predictions: many(predictions),
}));

export const predictionsRelations = relations(predictions, ({ one }) => ({
  analysis: one(analyses, { fields: [predictions.analysisId], references: [analyses.id] }),
  model: one(models, { fields: [predictions.modelId], references: [models.id] }),
}));
