# CLAUDE.md — instructions for Claude Code on the DepLens repo

## What this project is
DepLens predicts — and on demand measures — the **incremental browser runtime cost** of adding an npm dependency (with a specific import) to a specific web app, for a device profile. It is a web-technology course project whose second goal is a research paper (target: ICWE 2027 / EASE 2027). Read `docs/README.md`, then `docs/01-project-definition.md` and `docs/10-honest-assessment.md` before making design decisions.

## Source of truth
- **Decisions & requirements:** `docs/` (01 definition · 04 features · 05 SRS · 06 architecture · 07 measurement · 08 ML · 09 roadmap).
- **Measurement protocol:** `docs/07-measurement-methodology.md`. Do **not** change how labels are produced (injection, sink, pairing, trace buckets, estimator) without (1) a dated entry in `docs/research-log.md` and (2) re-running the harness validation tests (doc 07 §8, `research/experiments/phase0.ts`).
- **Requirement IDs** (FR-xx, NFR-xx in doc 05) — reference them in commit messages and test names.

## Current status
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
    (heaviest route 102.1 KB brotli of 150 KB, `pnpm --filter @deplens/web test:budget`).
  - Deployment: Vercel + Neon + Resend + GitHub Actions, all free — see `docs/13-deployment-guide.md`.
- Next: finish the open P1 items, then Phase 3 (`bundler-kit`, `features`, `lockfile`) so the analysis
  UI and the CI worker have a feature vector to show, then Phase 2 (pilot, doc 09 §3).

## Repository layout (target — see doc 06 §5)
```
packages/harness      measurement harness (TS)            ← exists
packages/db           Postgres schema (Drizzle) + migrations ← exists
apps/web              Next.js app: auth, projects, results        ← exists
packages/shared       Zod schemas, profiles, risk rules   ← TODO P5
packages/feature-schema feature-schema.json (TS+Python)   ← draft exists
packages/bundler-kit  injector/builds/metafile diff       ← TODO P3 (split out of harness/build.ts)
packages/features     AST + bundle + metadata features    ← TODO P3
packages/lockfile     npm/pnpm/yarn lockfile parsing       ← TODO P3
apps/api  apps/cli  services/analyzer  services/measurer   ← TODO P5/P7
research/hosts        host apps (inject marker + app-ready mark)
research/fixtures     synthetic calibration packages (generate.mjs)
research/experiments  validation & pilot experiments
ml/                   Python (uv): dataset, models, eval, FastAPI service ← TODO P6
```

## Commands
```bash
pnpm install                         # workspace deps
pnpm fixtures                        # generate research/fixtures/packages (work-K, bytes-K, eager-K)
pnpm test                            # unit tests, all packages
pnpm typecheck

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
pnpm test:web                        # 51 page/API test cases (needs `DEPLENS_E2E=1 pnpm dev -p 3111`)
pnpm --filter @deplens/web test:budget   # NFR-P5: initial JS per route vs the 150 KB brotli budget

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
  Next, its WASM loader breaks on Next's `URL` shim. The local server serves **one connection**, so the
  pool is capped at 1 for it.
- **Validate twice, from one schema.** Every form has one Zod schema in `apps/web/lib/validation.ts`,
  run in the browser for feedback and again in the route handler, which is the only trusted side.
- **Never leak whether an account exists.** Login, registration, reset and resend all answer
  identically for a known and an unknown address (see `GENERIC_LOGIN_FAILURE`).
- **CAPTCHA must not be text.** The answer is drawn as vector strokes; an SVG `<text>` element would
  put it in the markup for any bot to read.
- `DEPLENS_E2E=1` makes `/api/captcha` return the answer so the test script can submit forms. It is
  ignored when `NODE_ENV=production`; never set it on a deployment.
