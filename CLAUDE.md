# CLAUDE.md — instructions for Claude Code on the DepLens repo

## What this project is
DepLens predicts — and on demand measures — the **incremental browser runtime cost** of adding an npm dependency (with a specific import) to a specific web app, for a device profile. It is a web-technology course project whose second goal is a research paper (target: ICWE 2027 / EASE 2027). Read `docs/README.md`, then `docs/01-project-definition.md` and `docs/10-honest-assessment.md` before making design decisions.

## Source of truth
- **Decisions & requirements:** `docs/` (01 definition · 04 features · 05 SRS · 06 architecture · 07 measurement · 08 ML · 09 roadmap).
- **Measurement protocol:** `docs/07-measurement-methodology.md`. Do **not** change how labels are produced (injection, sink, pairing, trace buckets, estimator) without (1) a dated entry in `docs/research-log.md` and (2) re-running the harness validation tests (doc 07 §8, `research/experiments/phase0.ts`).
- **Requirement IDs** (FR-xx, NFR-xx in doc 05) — reference them in commit messages and test names.

## Current status
- Phase 0 (de-risking spike) — `packages/harness` works end to end: inject → npm install (`--ignore-scripts`) → esbuild bundle → Chromium (Playwright + CDP) under CPU throttling → trace → per-bucket self-time → paired Hodges–Lehmann estimate with bootstrap CI. Unit tests: `pnpm --filter @deplens/harness test`.
- Phase 0 results live in `docs/research-log.md` (they were produced on a noisy 2-vCPU cloud container — re-run on the dedicated measurement machine).
- Next: Phase 1 (doc 09 §3): Vite builder + `deplens-stats` plugin, more hosts, calibration/drift abort, trace storage, Postgres schema.

## Repository layout (target — see doc 06 §5)
```
packages/harness      measurement harness (TS)            ← exists
packages/shared       Zod schemas, profiles, risk rules   ← TODO P5
packages/feature-schema feature-schema.json (TS+Python)   ← draft exists
packages/bundler-kit  injector/builds/metafile diff       ← TODO P3 (split out of harness/build.ts)
packages/features     AST + bundle + metadata features    ← TODO P3
packages/lockfile     npm/pnpm/yarn lockfile parsing       ← TODO P3
apps/web  apps/api  apps/cli  services/analyzer  services/measurer   ← TODO P5/P7
research/hosts        host apps (inject marker + app-ready mark)
research/fixtures     synthetic calibration packages (generate.mjs)
research/experiments  validation & pilot experiments
ml/                   Python (uv): dataset, models, eval, FastAPI service ← TODO P6
```

## Commands
```bash
pnpm install                         # workspace deps
pnpm fixtures                        # generate research/fixtures/packages (work-K, bytes-K, eager-K)
pnpm --filter @deplens/harness test  # unit tests (stats, import specs/injection, trace parser)
pnpm --filter @deplens/harness typecheck
pnpm harness aa --cpu 4 --pairs 10   # A/A noise session on the vanilla host
pnpm harness run --import "import { format } from 'date-fns'" --dep date-fns@4.1.0 --cpu 4 --pairs 10
pnpm harness calibrate --cpu 1,2,4,6
cd packages/harness && npx tsx ../../research/experiments/phase0.ts   # Phase 0 validation (≈35 min)
```
Chromium: Playwright's bundled Chromium is used; set `DEPLENS_CHROMIUM=/path/to/chrome` to override.

## Conventions
- TypeScript `strict`, ESM, Node ≥ 22; run `.ts` directly with `tsx` in dev. Relative imports include the `.ts` extension.
- Every number shown to users carries its provenance: `exact` | `modeled` | `predicted` | `measured`.
- Feature names come only from `packages/feature-schema/feature-schema.json` (bump `schemaVersion` on change).
- Seed every random choice and log the seed.
- Python (later): 3.11+, `uv`, ruff; results for the paper must come from scripts, not notebooks.

## Hard rules (research validity & safety)
1. **Never run two measurement sessions concurrently on one machine**, and never run measurements on CI runners or shared cloud VMs for the dataset (fine for smoke tests).
2. **Never execute npm install scripts** (`--ignore-scripts` always). Treat candidate packages as untrusted code.
3. **Split by package name** (not version, not row) in any ML evaluation.
4. Do not report random-row-split results as headline numbers.
5. Keep baselines honest: always compare against in-context Δbytes (B3) and isolated measured cost (B4) — doc 08 §4.
6. Don't add features outside doc 04's MUST/SHOULD list without updating doc 04.

## Measurement gotchas learned so far
- Chrome CPU throttling stretches **both** wall time (`dur`) and thread time (`tdur`) in traces — see the research log for the measured ratio. Thread time is the primary label (`scriptThread`).
- `mainThreadWall` (all task time) is much noisier than `scriptThread` in A/A runs — don't use it as a label.
- Busy-wait fixtures based on `performance.now()` are wrong under throttling (wall clock keeps running); use fixed-work loops (`work-K`).
- Static `import` declarations are hoisted: the injected import always evaluates before the host's own code.
