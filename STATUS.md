# DepLens — project tracker

**One page that says where everything stands.** Updated 3 Oct 2026.

- What the project *is*: `docs/README.md` → `docs/01-project-definition.md`
- How it works in plain English: `docs/12-how-it-works-simple.md`
- Dated decisions and experiment results: `docs/research-log.md`
- Honest weaknesses and fallbacks: `docs/10-honest-assessment.md`
- Phase-by-phase plan: `docs/09-phases-and-roadmap.md`

---

## 1. The one-sentence state of play

**The whole software pipeline is built and tested end to end. The dataset is not collected, so the
millisecond numbers are predictions from a placeholder model, not research results.** Everything
that does not depend on measured data is done; everything that does is blocked on one thing — a
quiet machine to measure on.

---

## 2. What works right now (you can run all of this today)

| Capability | Command | State |
|---|---|---|
| Measure a real paired A/B cost in Chromium | `pnpm harness run …` | ✅ works; needs a quiet machine for valid numbers |
| Static analysis: bytes + 78 features + prediction | `pnpm harness analyze …` | ✅ works, ~5–20 s per candidate |
| Compare several candidates and rank them | `pnpm harness analyze --pkg a --pkg b …` | ✅ works, marks ties honestly |
| Web app: accounts, projects, analysis UI, results | `pnpm web` | ✅ works |
| Job queue + worker (the deploy architecture) | `pnpm worker`, `pnpm jobs` | ✅ works |
| ML pipeline: splits, 5 baselines, model, intervals | `pnpm ml:eval -- --synthetic` | ✅ runs; **no real dataset yet** |
| Feature schema shared by TS and Python | `pnpm test` + `pnpm test:ml` | ✅ contract enforced both sides |

### The project's central claim, demonstrated

The same import, on two different apps, measured by the real pipeline (3 Oct 2026):

| Host app | `import { format } from 'date-fns'` | Why |
|---|---|---|
| `react` (222 KB baseline) | **+19,918 B** | date-fns is new to the app |
| `react-heavy` (411 KB baseline) | **+204 B** | the app already ships date-fns |

**98× difference for identical source code.** No existing tool reports this, because no existing
tool looks at *your* app. This is the RQ1 example, and it is produced by `pnpm harness analyze`,
not by hand.

---

## 3. Test and code inventory

| Area | Package | Lines (src+test) | Tests |
|---|---|---|---|
| Contracts: provenance, profiles, risk rules, Zod schemas | `packages/shared` | 1,171 | 44 |
| Lockfile parsing (npm v1–v3, pnpm 5/6/9, yarn classic + berry) | `packages/lockfile` | 1,094 | 48 |
| Injection, isolated builds, metafile diff, exact bytes | `packages/bundler-kit` | 1,796 | 41 |
| Feature extractors G1–G5, G7 (83-feature schema) | `packages/features` | 2,019 | 100 |
| The analysis pipeline + B3 placeholder predictor | `packages/analyzer` | 649 | 24 |
| Measurement harness (browser, traces, statistics) | `packages/harness` | 2,291 | 31 |
| Postgres schema, migrations, job queue | `packages/db` | 873 | — |
| Next.js app (auth, projects, analysis, results) | `apps/web` | 4,234 | 51 + 34 e2e |
| Tier-2 analysis worker + queue inspector | `services/analyzer` | 160 | covered by e2e |
| ML pipeline (dataset, splits, baselines, model, metrics) | `ml/` | 1,684 | 60 |

**433 test cases pass**: 288 TypeScript unit · 60 Python · 51 web auth/page · 34 analysis e2e.
`pnpm typecheck` is clean across all 10 projects, `ruff` is clean, all 8 host apps pass their
contract check, and the web app passes its own JS budget — heaviest route **102.2 KB brotli of
150 KB**, with the two new analysis routes at 99.2 KB and 91.0 KB (the forest plot is inline SVG,
so it adds no library).

```bash
pnpm test        # 288 TypeScript unit tests
pnpm test:ml     # 60 Python tests (schema contract + pipeline)
pnpm typecheck   # all projects
```

---

## 4. Phase status

| Phase | What it is | State |
|---|---|---|
| **P0** De-risking spike | Does the measurement idea work at all? | ✅ **done** — but on a noisy container, so a functional spike, not data |
| **P1** Harness v1 + hosts | 8 host apps, calibration, drift abort, storage | 🟡 **mostly done** — A/A exit criterion blocked on hardware |
| **P2** Pilot | 50-cell pilot to size the campaign | ⛔ **blocked** on the same machine |
| **P3** Static analyzer & features | lockfile · bundler-kit · features | ✅ **done** (3 Oct 2026) — see §5 |
| **P4** Corpus & full collection | ~5,000 dataset cells | ⛔ **blocked** on the machine |
| **P5** Web platform | auth, analysis UI, results, deployment | 🟡 **auth + analysis UI done**; verify flow and project-bound analyses open |
| **P6** ML pipeline | baselines, model, intervals, statistics | 🟡 **code done and tested**; needs the dataset for real numbers |
| **P7** Product integration | Verify flow, measured-vs-predicted view | ⛔ needs P4 |
| **P8** Paper | Write-up | ⛔ needs P4/P6 results |

### What changed today (3 Oct 2026)

- **P3 finished.** Four new packages, 213 new unit tests, the 83-feature schema fully extracted,
  and `pnpm harness analyze` producing a complete report end to end.
- **P5 analysis UI built.** New-analysis form, polling results page, forest plot, feature inspector.
- **P6 pipeline built.** Splits S1–S4 with leakage guards, baselines B0–B4, LightGBM with
  monotone constraints, split-conformal intervals, an evaluation script that writes a results table.
- **Deployment architecture realised.** Postgres job queue, tier-2 worker, two GitHub Actions
  workflows.

---

## 5. P3 exit criteria — all met

Doc 09 sets three. Each is checked by a test, not by inspection:

| Criterion | Evidence |
|---|---|
| Features for all pilot cells | `pnpm harness analyze` produced 78 features (G1+G2+G3+G4+G5+G7) on 5 of the 8 hosts across 6 packages |
| Extractor ≤ 5 s per cell (excluding install) | **43–359 ms** measured across the runs above — two orders of margin |
| Schema contract test TS ↔ Python passes | `packages/features/test/schema.test.ts` and `ml/tests/test_schema_contract.py` both derive the contract independently and compare to `packages/feature-schema/contract.json`; both assert the same SHA-256 digest |

The 83 features break down as declared: G1 11 · G2 8 · G3 10 · G4 41 · G5 7 · G6 5 (measured, not
produced by static analysis) · G7 1.

---

## 6. The one blocker, stated plainly

**Everything still open depends on a quiet measurement machine.**

From `docs/research-log.md` (1 Oct 2026), measured on the dev laptop:

| Machine state | Calibration drift between sweeps | A/A noise on ΔScript | Verdict |
|---|---|---|---|
| **Idle** | 4–11 % | ±0.3 ms, MDE₉₅ = 1.26 ms | usable |
| **Loaded** | 14–52 % | ±4 ms | **unusable** — and it resolved every device profile to the wrong rate |

A dataset cell measured on a loaded machine is not a noisy measurement, it is a wrong one. So P2,
P4, P6's real numbers, P7 and P8 are gated on: a desktop or bare-metal machine, plugged in,
performance power plan, nothing else running, re-calibrated idle, rate-1 sweep spread under ~5 %.

Nothing in the software is waiting on software.

---

## 7. Honest caveats — read these before quoting any number

1. **Every millisecond figure the product currently shows is from a placeholder.** It is the B3
   baseline from doc 08 §4 — a linear function of added bytes — reporting `kind: b3-bytes-linear`
   and `trainedOnCells: null`. Its intervals are deliberately wide because Phase 0 measured four
   imports of 62–75 KB costing between ≈0 ms and +117 ms. Bytes cannot tell those apart; that is
   the project's premise, not a bug in the placeholder.

2. **Byte figures are exact and trustworthy today.** They come from differencing two real
   production builds with fixed compression settings. They carry provenance `exact`.

3. **The ranking is currently uninformative, and says so.** In the four-way date-library
   comparison every pair came back "no clear difference", because the placeholder's intervals all
   overlap. That is the correct behaviour for a bytes-only predictor — and it is the clearest
   possible argument for why the measured dataset is needed.

4. **The ML numbers in `ml/reports/synthetic/` are not results.** They come from a generator that
   encodes the project's own hypothesis, so of course the pipeline recovers it. `assert_real()`
   refuses to let a synthetic frame reach a reporting path, and every synthetic row is stamped.

5. **The budget check needs a production build.** `next dev` writes the same manifest path, and
   dev bundles measure ~1.3 MB per route — a meaningless number that reads as a budget failure. The
   script now detects dev output and refuses rather than reporting it. Run
   `pnpm --filter @deplens/web build` first.

6. **A known pipeline issue, found today:** on the unseen-package split (S2) the conformal
   intervals under-covered (0.78 against a nominal 0.90) on synthetic data, while S1/S3/S4 were
   within tolerance. Plain split-conformal assumes exchangeability that a grouped split breaks.
   P6 should use group-aware (Mondrian) conformal. Doc 08 §8's ±5 pt coverage criterion is what
   caught it.

---

## 8. What to do next, in order

1. **Get a quiet machine** and run `pnpm harness calibrate --cpu 1,2,3,4,6,10 --repeats 3 --save`
   idle. Require a rate-1 spread under ~5 %.
2. **Close the P1 A/A exit criterion**: ≥ 10 A/A sessions per host, CI covering 0 in ≥ 90 %.
3. **Run the P2 pilot** (50 cells) to size the full campaign.
4. **Collect P4** (~5,000 cells). The harness resumes a crashed campaign from its session store.
5. **Re-run `pnpm ml:eval --dataset …`** — the pipeline is ready and waiting; swap the predictor in
   `packages/analyzer/src/predictor.ts` for the trained model.
6. **Add the 2 realistic OSS hosts** (Conduit-style) still open from P1.
7. Finish P5's open items: the Verify flow and project-bound analyses (`analysis`/`prediction`
   tables exist and are unused).

---

## 9. Running it, from nothing

```bash
pnpm install
pnpm fixtures                 # synthetic calibration packages

# --- static analysis, no browser, no database ---
pnpm harness analyze --host research/hosts/react \
  --pkg date-fns@4.1.0 --import "import { format } from 'date-fns'" \
  --profile mid-tier-mobile --budget-ms 50

# --- the web app ---
pnpm db:serve                 # terminal A: local Postgres, nothing to install
pnpm db:migrate               # terminal B: once
pnpm web                      # terminal B: http://localhost:3000
pnpm worker --watch           # terminal C: runs queued analyses

# --- tests ---
pnpm test && pnpm test:ml && pnpm typecheck
```

Full deployment guide: `docs/13-deployment-guide.md`. A demo runbook with exact commands and
expected output: `docs/14-demo-runbook.md`.

### Environment notes

- **Node must be ≥ 22.** The dev machine currently has v20.20.0, so every pnpm command prints
  `WARN Unsupported engine`. It works today but the toolchain assumes 22.
- `pnpm db:serve` writes to `packages/db/.work/pglite`, not the repo-root `.work/`. It ignores
  `DEPLENS_PGLITE_DIR` from `apps/web/.env.local`.
- Two `next dev` processes cannot share `apps/web/.next` (EPERM on `.next/trace`); stop one first.
- Next dev compiles each route on first request, so warm the routes before running the web test
  suite, or run it twice.
