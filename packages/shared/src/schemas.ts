/**
 * Zod schemas — validated in the browser for feedback and again on the server, which is the only
 * trusted side (CLAUDE.md "validate twice, from one schema").
 *
 * These are the *analysis* schemas. The auth form schemas live in `apps/web/lib/validation.ts`
 * because they are specific to those forms; anything the API and a worker both have to agree on
 * belongs here.
 */
import { z } from 'zod';
import { PROVENANCES } from './provenance.ts';
import { RISK_LEVELS, BUDGET_VERDICTS } from './risk.ts';

/** A feature vector as it crosses a process boundary. Names are checked by @deplens/features. */
export type FeatureVector = Record<string, number | boolean | string | null>;

export const profileNameSchema = z.enum(['desktop', 'mid-tier-mobile', 'low-end-mobile']);

/**
 * An import spec, as typed by a developer.
 *
 * The regex is a guard, not a parser (`@deplens/bundler-kit` parses it properly): it rejects
 * anything that is not a sequence of import declarations, so a submitted spec cannot smuggle in
 * arbitrary statements that would then be injected into a host build.
 */
export const importSpecSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1, 'Enter the import statement you want to add')
    .max(2000, 'That import statement is unusually long — please shorten it')
    .refine((s) => /^\s*import\s/.test(s), 'Must start with an `import` statement')
    .refine(
      (s) => !/[;{]\s*(?!\s*import\b)[A-Za-z_$]/.test(s.replace(/import[^;]*;?/g, '')),
      'Only import declarations are allowed here',
    ),
  placement: z.enum(['initial', 'lazy']).default('initial'),
  sink: z.string().max(500).optional(),
});

export type ImportSpecInput = z.infer<typeof importSpecSchema>;

/** `name@version` or a bare name. Follows the npm naming rules rather than a loose pattern. */
export const packageSpecSchema = z
  .string()
  .trim()
  .min(1, 'Enter a package name')
  .max(214, 'Package names are at most 214 characters')
  .regex(
    /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*(@[\w.^~>=<| -]+)?$/,
    'That does not look like an npm package name',
  );

export const budgetSchema = z
  .object({
    scriptMs: z.coerce.number().positive().max(10_000).optional(),
    brotliKb: z.coerce.number().positive().max(100_000).optional(),
  })
  .optional();

/** One candidate to analyse: a package, the exact import, and where it should land. */
export const candidateSchema = z.object({
  pkg: packageSpecSchema,
  spec: importSpecSchema,
});

export const analysisRequestSchema = z.object({
  projectId: z.string().uuid().optional(),
  /** The host to analyse against. A named research host, or a project the user submitted. */
  host: z.string().trim().min(1).max(200),
  candidates: z.array(candidateSchema).min(1, 'Add at least one candidate').max(8, 'At most 8 candidates per analysis'),
  profile: profileNameSchema.default('mid-tier-mobile'),
  budget: budgetSchema,
});

export type AnalysisRequest = z.infer<typeof analysisRequestSchema>;

export const intervalSchema = z.object({
  point: z.number(),
  low: z.number(),
  high: z.number(),
});

export const attributedNumberSchema = z.object({
  value: z.number(),
  provenance: z.enum(PROVENANCES),
  unit: z.string().optional(),
  interval: z.tuple([z.number(), z.number()]).optional(),
  note: z.string().optional(),
});

export const reasonSchema = z.object({
  text: z.string(),
  ms: z.number().nullable(),
  feature: z.string(),
});

export const adviceSchema = z.object({
  type: z.enum(['native', 'alternative', 'placement', 'import-style', 'duplicate']),
  text: z.string(),
});

/** The per-candidate report (doc 01 §4.2). Every number carries its provenance. */
export const candidateReportSchema = z.object({
  candidate: z.object({
    name: z.string(),
    version: z.string().nullable(),
    import: z.string(),
  }),
  profile: profileNameSchema,
  bytes: z.object({
    min: attributedNumberSchema,
    gzip: attributedNumberSchema,
    brotli: attributedNumberSchema,
    newPackages: z.array(z.string()),
    sharedWithApp: z.array(z.string()),
  }),
  network: attributedNumberSchema.extend({ model: z.string() }),
  script: attributedNumberSchema,
  tbt: attributedNumberSchema,
  verdict: z.object({
    risk: z.enum(RISK_LEVELS),
    budget: z.enum(BUDGET_VERDICTS),
    verifyRecommended: z.boolean(),
    reason: z.string(),
  }),
  why: z.array(reasonSchema),
  advice: z.array(adviceSchema),
  outOfDistribution: z.object({ outOfDistribution: z.boolean(), reasons: z.array(z.string()) }),
  model: z.object({
    kind: z.string(),
    version: z.string(),
    trainedOnCells: z.number().nullable(),
    note: z.string().optional(),
  }),
  features: z.record(z.union([z.number(), z.boolean(), z.string(), z.null()])),
  featureGroups: z.array(z.string()),
  notes: z.array(z.string()),
  timings: z.object({ installMs: z.number(), buildMs: z.number(), extractMs: z.number(), totalMs: z.number() }),
});

export type CandidateReport = z.infer<typeof candidateReportSchema>;

export const analysisResultSchema = z.object({
  host: z.object({ name: z.string(), framework: z.string(), baselineMinBytes: z.number() }),
  profile: profileNameSchema,
  profileSlowdown: z.number(),
  budget: budgetSchema,
  reports: z.array(candidateReportSchema),
  /** Candidates ranked cheapest-first, with ties the intervals cannot separate marked. */
  ranking: z.array(
    z.object({
      name: z.string(),
      rank: z.number(),
      tiedWithPrevious: z.boolean(),
    }),
  ),
  schemaVersion: z.number(),
  generatedAt: z.string(),
});

export type AnalysisResult = z.infer<typeof analysisResultSchema>;

/** Project intake (FR-01, FR-03) — Quick mode: a manifest, no repository. */
export const projectIntakeSchema = z.object({
  name: z.string().trim().min(1, 'Give the project a name').max(120),
  packageJson: z
    .string()
    .trim()
    .min(2, 'Paste your package.json')
    .max(512_000, 'That file is too large')
    .refine((s) => {
      try {
        const parsed = JSON.parse(s) as unknown;
        return typeof parsed === 'object' && parsed !== null;
      } catch {
        return false;
      }
    }, 'That is not valid JSON')
    .refine((s) => {
      try {
        const p = JSON.parse(s) as { dependencies?: object; devDependencies?: object };
        return Object.keys(p.dependencies ?? {}).length > 0 || Object.keys(p.devDependencies ?? {}).length > 0;
      } catch {
        return false;
      }
    }, 'That package.json has no dependencies to analyse'),
  lockfile: z.string().max(8_000_000).optional(),
  lockfileName: z.string().max(200).optional(),
});

export type ProjectIntake = z.infer<typeof projectIntakeSchema>;
