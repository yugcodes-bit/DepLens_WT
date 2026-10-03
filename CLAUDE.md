# CLAUDE.md — instructions for Claude Code on the DepLens repo

## What this project is
DepLens predicts — and on demand measures — the **incremental browser runtime cost** of adding an npm dependency (with a specific import) to a specific web app, for a device profile. It is a web-technology course project whose second goal is a research paper (target: ICWE 2027 / EASE 2027). Read `docs/README.md`, then `docs/01-project-definition.md` and `docs/10-honest-assessment.md` before making design decisions.

## Source of truth
- **Decisions & requirements:** `docs/` (01 definition · 04 features · 05 SRS · 06 architecture · 07 measurement · 08 ML · 09 roadmap).
- **Measurement protocol:** `docs/07-measurement-methodology.md`. Do **not** change how labels are produced (injection, sink, pairing, trace buckets, estimator) without (1) a dated entry in `docs/research-log.md` and (2) re-running the harness validation tests (doc 07 §8, `research/experiments/phase0.ts`).
- **Requirement IDs** (FR-xx, NFR-xx in doc 05) — reference them in commit messages and test names.

## Current status
> **`STATUS.md` at the repo root is the single project tracker** — phase table, test inventory, the
> one blocker, and what to do next. Read it first. `docs/14-demo-runbook.md` is the demo script.

- **Phase 0 (de-risking spike) — done.** `packages/harness` works end to end; results in `docs/research-log.md`.
  Produced on a noisy 2-vCPU cloud container **and with esbuild-built hosts**, so the numbers are a
  functional spike, not data — re-run on the measurement machine with the Vite hosts.
- **Phase 1 (harness v1 + host apps) — mostly done** (doc 09 §3 has the item-by-item table):
  - Vite builder + `deplens-stats` plugin; esbuild and Vite share one `BuildResult`. Builds run in a
    child process (`harness build --json`).
  - **8 host apps** (`empty`, `vanilla`, `react`, `vue`, `svelte`, `preact`, `solid`, `react-heavy`),
    baselines 84 B → 411 KB, all passing the contract check and **building deterministically**.
  - Profiles resolved per machine from a measured calibration curve; drift abort (FR-33), invalid-cell
    detection (FR-34), trace + session storage with a per-cell resume key (FR-35, FR-51).
  - `packages/db`: Drizzle schema for all 14 tables of doc 06 §6, migration generated.
  - 49 unit tests.
- **Open P1 items:** 2 realistic OSS hosts (Conduit-style); the A/A exit criterion (≥ 10 A/A sessions
  per host, CI covering 0 in ≥ 90%) — **blocked on a quiet measurement machine**. Idle, the dev laptop
  reaches MDE₉₅ ≈ 1.3 ms with 100% A/A coverage; loaded, its calibration moves 14–52% between sweeps and
  A/A noise reaches ±4 ms, so dataset cells need the tuned machine.
- **Phase 5 (web platform) — pulled forward, auth + shell done** (doc 09 §P5 has the table):
  - `apps/web` (Next.js 15 App Router): landing, how-it-works, register, verify (OTP), login, forgot,
    reset, dashboard, new project. Responsive at 360/768/1366/1920 px.
  - Own authentication (doc 06 §8): Argon2id, server-side sessions in `httpOnly` cookies, hashed
    single-use OTP and reset tokens, CSRF double-submit + origin check, self-hosted vector-stroke
    CAPTCHA, per-IP and per-account rate limiting, audit log, roles enforced server-side.
  - One Zod schema per form, validated in the browser **and** again on the server.
  - **51 page/API test cases pass** (`pnpm test:web`); the app passes its own JS budget
    (heaviest route 102.2 KB brotli of 150 KB, `pnpm --filter @deplens/web test:budget` — it needs a
    **production** build; the script now refuses to measure `next dev` output, which is ~1.3 MB/route
    and would read as a spurious failure).
  - Deployment: Vercel + Neon + Resend + GitHub Actions, all free — see `docs/13-deployment-guide.md`.
- **Phase 3 (static analyzer & features) — done** (3 Oct 2026; research log has the detail):
  - `packages/lockfile` (npm v1–v3, pnpm 5/6/9, yarn classic + berry → one flat dependency graph),
    `packages/bundler-kit` (injection, isolated builds, metafile diff, exact bytes),
    `packages/features` (all of G1–G5 + G7 of the 83-feature schema), `packages/shared`
    (provenance, profiles, FR-24 risk rules, Zod schemas), `packages/analyzer` (the pipeline).
  - `build.ts`, `viteBuild.ts`, `inject.ts`, `importSpec.ts`, `bundleStats.ts` and `profiles.ts`
    **moved out of the harness** into `bundler-kit`/`shared`, with re-export shims so no internal
    import path changed. The web app and the CI worker therefore never load Playwright.
  - Exit criteria met: 78 features per cell (83 minus the 5 measured G6), extraction **43–359 ms**
    against a 5 s budget, and a TS ↔ Python schema-contract test asserting the same digest.
  - `pnpm harness analyze` runs the whole pipeline end to end. The context effect it reports:
    `date-fns` costs **19,918 B** on `react` and **204 B** on `react-heavy` — 98×, same source.
- **Phase 5 analysis UI + deployment architecture — done**: `/analyze`, `/analyses/[id]` with a
  forest plot and provenance badges, `POST/GET /api/analyses`, a Postgres job queue
  (`packages/db/src/queue.ts`, atomic `FOR UPDATE SKIP LOCKED` claim), the tier-2 worker
  (`services/analyzer`), and two GitHub Actions workflows. 34 more e2e test cases.
- **Phase 6 pipeline code — done, results blocked**: `ml/` has splits S1–S4 with leakage guards,
  baselines B0–B4, LightGBM with monotone constraints, split-conformal intervals and an evaluation
  script. 60 Python tests. **There is no dataset**, so it is exercised on a clearly-stamped
  synthetic generator and `assert_real()` stops synthetic data reaching a reporting path.
- **433 test cases pass**: 288 TS unit · 60 Python · 51 web auth/page · 34 analysis e2e.
- Next: everything open needs **a quiet measurement machine** — close P1's A/A criterion, run the
  P2 pilot, collect P4, then P6's real numbers and P7/P8. Nothing is waiting on software.

## Repository layout (target — see doc 06 §5)
```
packages/harness      measurement harness: browser, traces, statistics  ← exists
packages/db           Postgres schema (Drizzle) + migrations + job queue ← exists
apps/web              Next.js app: auth, projects, analysis, results     ← exists
packages/shared       provenance, profiles, risk rules, Zod schemas      ← exists
packages/feature-schema feature-schema.json + contract.json (TS+Python)  ← exists
packages/bundler-kit  injector/builds/metafile diff/isolated builds      ← exists
packages/features     AST + bundle + metadata features (G1–G5, G7)       ← exists
packages/lockfile     npm/pnpm/yarn lockfile parsing                     ← exists
packages/analyzer     the static pipeline + B3 placeholder predictor     ← exists
services/analyzer     tier-2 worker (no timing) + queue inspector        ← exists
apps/api  apps/cli  services/measurer                      ← TODO P7 (the CLI is `harness analyze` for now)
research/hosts        host apps (inject marker + app-ready mark)
research/fixtures     synthetic calibration packages (generate.mjs)
research/experiments  validation & pilot experiments
ml/                   Python (uv): dataset, splits, baselines, model, eval ← exists; FastAPI service TODO P6
```

## Commands
```bash
pnpm install                         # workspace deps
pnpm fixtures                        # generate research/fixtures/packages (work-K, bytes-K, eager-K)
pnpm test                            # 288 unit tests, all packages
pnpm test:ml                         # 60 Python tests (schema contract + ML pipeline); needs `cd ml && uv sync`
pnpm typecheck
pnpm contract                        # regenerate feature-schema contract.json after a schema change

# --- static analysis: no browser, no database (doc 06 §7.2) ---
pnpm harness analyze --host research/hosts/react --pkg date-fns@4.1.0 \
  --import "import { format } from 'date-fns'" --profile mid-tier-mobile --budget-ms 50
pnpm harness analyze --host research/hosts/react --pkg moment@2.30.1 --pkg dayjs@1.11.13 \
  --import "import moment from 'moment'|||import dayjs from 'dayjs'"   # one spec per --pkg, '|||'-separated
#   add --features to dump the whole feature vector, --json for machine-readable output

pnpm harness hosts                   # list host apps + contract checks (marker, app-ready, determinism inputs)
pnpm harness hosts --determinism     # build every host 3x in separate processes, compare dist hashes (doc 07 §8.4)
pnpm harness build --host research/hosts/react [--import "..."] [--dep pkg@ver]   # one build, no browser
pnpm harness calibrate --cpu 1,2,4,6 --repeats 3   # measure + store this machine's calibration curve
pnpm harness machine                 # show the stored reference and the rate each profile resolves to
pnpm harness aa  --host research/hosts/react --profile mid-tier-mobile --pairs 10 --seed 11
pnpm harness run --host research/hosts/react --import "import { format } from 'date-fns'" --dep date-fns@4.1.0 --profile mid-tier-mobile
pnpm harness iso --import "import _ from 'lodash'" --dep lodash@4.17.21 --profile mid-tier-mobile   # C_iso on the empty host
pnpm harness noise                   # A/A noise floor (MDE95) from stored sessions
pnpm harness clean                   # prune node_modules from cached builds (run after a campaign)

# --- web app (doc 13 has the full deployment guide) ---
pnpm db:serve                        # local Postgres with nothing installed (PGlite behind a socket)
pnpm db:migrate                      # apply the committed migrations to $DATABASE_URL
pnpm web                             # next dev on :3000
pnpm worker --watch                  # tier-2 analysis worker: claims queued analyses (no timing)
pnpm jobs                            # queue inspector: status / worker / error, one line per job
pnpm test:web                        # 51 page/API test cases (needs `DEPLENS_E2E=1 pnpm dev -p 3111`)
node apps/web/test/e2e-analysis.mjs  # 20 analysis API cases; add --with-worker for all 34
pnpm --filter @deplens/web test:budget   # NFR-P5: initial JS per route vs the 150 KB brotli budget

# --- ML (dataset does not exist yet; see STATUS.md §6) ---
cd ml && uv sync                     # core deps only; `uv sync --extra research` adds shap/optuna/xgboost
pnpm ml:eval -- --synthetic          # exercise the pipeline. NOT results — output goes to reports/synthetic/
pnpm ml:eval -- --dataset ../.work/dataset/cells.parquet   # the real thing, once a campaign has run

cd packages/db && npx drizzle-kit generate    # regenerate the migration after a schema change
cd packages/harness && npx tsx ../../research/experiments/phase0.ts   # Phase 0 validation (≈35 min)
```
Sessions are stored in `.work/sessions/` (one JSON per session + `index.jsonl`); the machine reference
lives in `.work/machine.json`. `--drift-tolerance` exists for smoke tests only — never raise it for
dataset cells.

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
- **Never let `NODE_ENV` reach a Vite build.** Vite lets an inherited `NODE_ENV` override
  `mode: 'production'`, producing a development bundle that is larger *and* non-deterministic (the dev
  JSX transform embeds absolute paths). Vite also sets `NODE_ENV=production` and does not restore it,
  which makes the next `npm install` in the same process skip `devDependencies` — so the installer
  passes `--include=dev` and its own `NODE_ENV`.
- Host builds need `base: './'`: baseline and treatment are served under `/a` and `/b` on one origin.
- On Windows, a work dir whose rollup/esbuild native binaries were loaded cannot be deleted until the
  loading process exits — hence one child process per build, and `harness clean` afterwards.
- A CDP throttling rate is **not** a slowdown factor: rate 4 measured 4.28× on the idle dev laptop and
  ≈4.8× on the Phase 0 container. Always resolve the rate from the machine's calibration curve — and
  **calibrate the machine idle**: under load the same laptop reported 8.4× at rate 4 and resolved every
  profile to the wrong rate.

## Web app rules
- **One driver for the database, everywhere**: the app always speaks Postgres over the wire (`pg`).
  Local dev points `DATABASE_URL` at the PGlite socket server (`pnpm db:serve`) — never embed PGlite in
  Next, its WASM loader breaks on Next's `URL` shim. The local server takes `maxConnections` (set to
  10) and queues at the *query* level, so the app and the worker can both run; it defaulted to 1,
  which is what used to make the second process fail with `read ECONNRESET`.
- **Analysis never runs in a request handler.** It installs npm packages and runs two bundlers,
  which does not fit a Vercel function's 60 s / 512 MB `/tmp`. `POST /api/analyses` validates and
  writes a `job` row; `services/analyzer` claims it. The job table *is* the queue (doc 06 §7.3) —
  there is no Redis on the free tiers.
- **The host name in an analysis request is checked against an allowlist**, not sanitised: it
  reaches a file path in the worker, and an allowlist cannot be talked round.
- **Validate twice, from one schema.** Every form has one Zod schema in `apps/web/lib/validation.ts`,
  run in the browser for feedback and again in the route handler, which is the only trusted side.
- **Never leak whether an account exists.** Login, registration, reset and resend all answer
  identically for a known and an unknown address (see `GENERIC_LOGIN_FAILURE`).
- **CAPTCHA must not be text.** The answer is drawn as vector strokes; an SVG `<text>` element would
  put it in the markup for any bot to read.
- `DEPLENS_E2E=1` makes `/api/captcha` return the answer so the test script can submit forms. It is
  ignored when `NODE_ENV=production`; never set it on a deployment.
