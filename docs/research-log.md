# Research Log (append-only)

Record every decision that affects labels, features, splits or claims. Newest entries at the bottom. Format:

```
## YYYY-MM-DD — <short title>
**Context:** why this came up
**Experiment / evidence:** what was run, on which machine, with which versions; link to data/report
**Decision:** what we will do
**Consequences:** what changes in code/docs; which cells/models must be recomputed
```

---

## 2026-09-28 — Project framing
**Context:** original pitch (static features → LightGBM → execution time; compare with bundle size).
**Decision:** reframe as *incremental, context-dependent* cost ΔC(H, P, I, D); primary label ΔScript (compile + eval + GC in load window), secondary ΔTBT; INP dropped as a label; baselines include in-context Δbytes (B3) and isolated measured cost (B4); grouped evaluation (unseen packages / hosts / both); conformal intervals; predict-then-verify evaluation.
**Consequences:** docs 01–11 written; Phase 0 must resolve the dur-vs-tdur throttling question (doc 07 §4.7).

## 2026-09-28 — Phase 0 spike results (build container, NOT the measurement machine)
**Context:** first end-to-end run of `packages/harness` + `research/experiments/phase0.ts`. Machine: cloud container, 2 shared vCPUs (Xeon 2.1 GHz), Chromium 141.0.7390.37 (Playwright 1.56.1), esbuild bundles, vanilla host, 10 pairs + 1 warm-up per session. Report: `research/experiments/results/phase0-container-2026-09-28.md`; raw runs: `…results.jsonl.gz`.
**Evidence:**
- **E1 throttling:** the slope of ΔScript vs injected work is **3.99× larger at 4× than at 1× for trace thread time (`tdur`)** and 3.56× for wall time. In-page calibration: 16.8 / 40.2 / 81.3 / 109.7 ms at 1/2/4/6×. ⇒ `tdur` reflects throttling almost exactly.
- **E2 A/A noise:** at 1× both A/A CIs contain 0 (|HL| ≤ 0.6 ms, CI half-width ≈ 1–1.2 ms). At 4× CI half-widths are ≈ 7–10 ms and one of two A/A sessions **excluded 0** (−8.9 [−17.5, −2.1] ms) → on this VM, 4× labels are far noisier than 4× the 1× noise.
- **E3 injected cost:** at 1× ΔScript = 1.93 + 0.155·units (R² = 0.989); at 4× ΔScript = 5.72 + 0.619·units (R² = 0.972). Differences below ≈ 2 ms (1×) are not resolvable here. Intercept ≈ 1.6–1.9 ms for a 67-byte module is unexplained (module instantiation overhead vs. systematic A/B bias) → investigate in P1 with more A/A sessions and a 0-work module.
- **E4 bytes vs executed code (1×):** up to 246 KB of **never-called** functions adds ≈ 0 ms main-thread script time (within noise); the **same bytes executed once** add 3.5 / 7.9 / 15.4 / 32.4 ms for 30 / 60 / 120 / 246 KB (≈ 0.13 ms/KB, mostly compile). ⇒ identical sizes can differ by > 30× in cost.
- **E5 real packages (4×, vanilla host):** four imports of similar size (62–75 KB minified) cost luxon `{DateTime}` −4.3 [−8.5, 1.1], date-fns namespace 3.2 [−4.8, 8.1], moment 22.6 [17.0, 30.5], **lodash default 117.2 [110.1, 141.6] ms (+93.6 ms TBT, +0.85 MB heap)**. Import form matters: `lodash/debounce` 7.2 [4.1, 13.0] vs `lodash-es {debounce}` 1.5 [−1.7, 4.0] ms. Spearman(min bytes, ΔScript) over the 8 imports = 0.12 (n = 8, several within noise — illustrative only, not a result).
**Decision:**
1. Primary label = main-thread **thread time** (`scriptThread`); `mainThreadWall` is too noisy to use as a label.
2. Strongly consider **measuring CPU cost at 1× (low noise) and projecting to profiles** with the calibrated slowdown (ratio 3.99 for pure CPU work here). Must be validated on ≥ 30 real packages in P1 (compile/GC/TBT may not scale linearly) before adopting.
3. A/A noise at 4× on shared VMs is unacceptable for labels → confirms doc 07 §3.1: dataset measurements only on the dedicated machine.
4. The E4/E5 contrast (same size, very different cost) is the paper's motivating example candidate — re-measure on the dedicated machine.
**Consequences:** P1 adds (a) 1×-vs-4× projection validation on real packages, (b) ≥ 10 A/A sessions per host to estimate MDE properly, (c) the 0-work intercept investigation.

## 2026-10-01 — P1: host apps move to Vite; three build bugs found and fixed
**Context:** P1 (doc 09 §3) requires host apps built with **their own Vite config** plus the `deplens-stats` plugin (doc 07 §2.3). Phase 0 built the two hosts with esbuild. Building the host family exposed three defects that silently corrupt builds.
**Experiment / evidence:** 8 hosts (`empty`, `vanilla`, `react`, `vue`, `svelte`, `preact`, `solid`, `react-heavy`) built 3× each, every build in its own process and work root (`pnpm harness hosts --determinism`). Machine: i7-11800H (16 cores), Windows 11, Node 20.20, Vite 7.3.6, Chromium 141.0.7390.37 (Playwright 1.56.1) — same Chromium build as Phase 0.
- **All 8 hosts build deterministically** (identical dist hash across 3 independent builds). Baseline initial JS spans 84 B (`empty`) → 491 B (`vanilla`) → 8.6 KB (`solid`) → 11 KB (`preact`) → 31 KB (`svelte`) → 63 KB (`vue`) → 222 KB (`react`) → 411 KB (`react-heavy`). That is the range doc 07 §5 asks for.
- **Bug 1 — NODE_ENV leak.** Vite's `build()` sets `process.env.NODE_ENV=production` and does not restore it. npm omits `devDependencies` when NODE_ENV=production, so the *second* host build in one process installed no Vite at all ("up to date", empty tree). Fixed: `buildWithVite` saves/restores NODE_ENV, and the npm child always gets `--include=dev` plus its own `NODE_ENV=development`.
- **Bug 2 — inherited NODE_ENV flips Vite to a dev build.** Passing `NODE_ENV=development` to a build child makes Vite ignore `mode: 'production'`. The React host then grew 222 KB → 430 KB and became **non-deterministic**, because the dev JSX transform embeds absolute file paths. 5 of 8 hosts failed the determinism check until the child env stopped setting NODE_ENV. *Any* future build wrapper must leave NODE_ENV unset.
- **Bug 3 — absolute asset URLs.** Vite's default `base: '/'` emits `/assets/index-*.js`, which 404s because the measurement server serves baseline and treatment under path prefixes (`/a`, `/b`) on one origin (doc 07 §3.5 wants one port for A and B). Every run failed with no `app-ready`. Fixed: the harness build passes `base: './'`.
**Decision:**
1. **All dataset hosts are built with Vite** (`empty` and `vanilla` included), with `base: './'`, `sourcemap: false`, `reportCompressedSize: false`, and compression measured by us at gzip-9 / brotli-11. The esbuild path stays in `build()` for hosts without a Vite config and for P3's isolated package-only builds.
2. **Builds run in a child process** (`harness build --json`). On Windows a work dir whose rollup/esbuild native binaries have been loaded cannot be deleted by any process until the loader exits, so in-process building would leave one `node_modules` per cell on disk. `harness clean` prunes them afterwards.
3. Phase 0's E1–E5 numbers are **not comparable** to P1 onwards (different bundler for the same hosts). They must be re-run on the measurement machine with the Vite hosts before any dataset claim uses them.
**Consequences:** doc 07 §2.3/§3.5 updated; `research/hosts/` now has 8 hosts with committed lockfiles; `packages/harness` gains `bundleStats.ts`, `viteBuild.ts`, `hosts.ts`, `profiles.ts`, `machine.ts`, `store.ts`; 47 unit tests (was 15).

## 2026-10-01 — Profiles resolved from a measured calibration curve; first machine is unfit for the dataset
**Context:** doc 07 §3.3 defines profiles by a **target calibration slowdown** rather than a raw CDP throttling rate, because Chrome's rate is relative to the host machine. P1 implements that resolution and needs a per-machine reference for the drift abort (FR-33).
**Experiment / evidence:** `pnpm harness calibrate --cpu 1,2,3,4,6 --repeats 3` on the i7-11800H laptop; then A/A and treatment sessions on the Vite hosts at the desktop profile (rate 1, 10 pairs + 1 warm-up).
- **Machine load distorts the calibration curve super-linearly — measure it idle.** Two sweeps of the same machine, hours apart:

  | state | machine index | rate 1 | 2 | 3 | 4 | 6 | sweep spread | slowdown at rate 4 |
  |---|---|---|---|---|---|---|---|---|
  | **loaded** | 58,928 | 20.8 ms | 57.4 | 101.8 | 174.7 | 314.2 | 14–52% | **8.4×** |
  | **idle** | 105,320 | 11.3 ms | 23.9 | 37.6 | 48.4 | 83.6 | 4–11% | **4.28×** |

  Under load the higher throttling rates suffer disproportionately (rate 6: 15.1× loaded vs 7.4× idle),
  so a curve measured on a busy machine both overstates the slowdown and mis-resolves every profile
  (`mid-tier-mobile` resolved to rate 2.58 loaded, 3.7 idle). On an idle machine the rate is close to
  the slowdown (4 → 4.28×). **Correction to the first version of this entry:** the "rate is not the
  slowdown" effect we first recorded was mostly a load artifact, not a property of the machine.
  Calibration-based profile resolution (doc 07 §3.3) is still required — Phase 0's container gave
  ≈ 4.8× at rate 4, and the idle laptop gives 4.28× — but the curve must be measured idle to mean anything.
- **A/A noise is dominated by machine quietness, not by the harness.** Same host, profile and pair count,
  `vanilla` at the desktop profile, 10 pairs: loaded machine → ΔScript thread **−1.4 [−4.0, 1.3] ms**;
  idle machine → **0.1 [−0.1, 0.3]** and **−0.1 [−0.3, 0.1] ms**. Over the three sessions
  MDE₉₅ = **1.26 ms** with 100% CI coverage of 0 (`pnpm harness noise`). On a quiet machine this harness
  resolves sub-millisecond differences at rate 1; on a busy one it cannot see 4 ms.
- **The laptop is development-only until it is tuned.** A session once started 108% slower than its own
  reference and the drift abort correctly refused to measure. Before any dataset run: plugged in,
  performance power plan, nothing else running, then re-calibrate and require a rate-1 sweep spread
  under ~5%.
- **A/A at the desktop profile, `vanilla`, 10 pairs:** ΔScript thread **−1.4 [−4.0, 1.3] ms** (CI contains 0 ✓), ΔTBT 0.0, but Δ`mainThreadWall` **−8.5 [−13.5, −1.5] ms** — the CI *excludes* 0. Independent confirmation of the Phase 0 decision that `mainThreadWall` is unusable as a label and `scriptThread` is the label.
- **Session cost:** 38–40 s for 10 pairs on small hosts, well inside the P1 exit criterion (≤ 90 s).
- **Context effect, first real measurement.** `import _ from 'lodash'` on the `react` host: Δmin **73,468 B**, ΔScript thread **37.4 [27.0, 50.3] ms** (compile 28.5 / eval 6.7 / gc 2.5), ΔTBT 11.1, ΔHeap 0.76 MB. The same kind of import on a host that *already ships the package* — `import { format } from 'date-fns'` on `react-heavy` — costs Δmin **204 B** and ΔScript **1.6 [−0.5, 4.4] ms**, with `date-fns` reported as **shared**. Same ecosystem, two orders of magnitude apart purely from context. This is the RQ1 example to re-measure on the dedicated machine.
**Decision:**
1. A machine reference (`.work/machine.json`) holds the whole calibration curve; profiles resolve to a rate by interpolating it. Sessions abort when calibration deviates > 10% from that reference (FR-33), and flag > 5% before/after drift within a session.
2. `harness calibrate` measures the curve `--repeats` times and stores the **median**, reporting the spread. **A machine whose rate-1 spread exceeds ~5% must not produce dataset cells**, and the curve must be re-measured whenever the machine's state changes — a reference taken under load silently mis-resolves every profile.
3. Dataset collection waits for a quiet machine: desktop or bare metal, plugged in, performance power plan, nothing else running. The laptop stays for development.
4. Record the machine index with every session: it is the cheapest signal that a reference was taken in the wrong state (58,928 loaded vs 105,320 idle on the same laptop).
**Consequences:** `--drift-tolerance` exists for smoke tests only and must never be raised for dataset cells; doc 07 §3.3 gains the measured curve as the worked example; the P1 A/A exit criterion (CI covers 0 in ≥ 90% of sessions) is still **open** — it needs ≥ 10 A/A sessions per host on the quiet machine.

## 2026-10-02 — Deployment split into three tiers; course security requirements folded into the design
**Context:** the course guidelines require a deployed full-stack system with login, sessions, cookies, encryption, authorization, CAPTCHA, OTP, email verification, a validation suite and responsive layouts. None of that existed in docs 04/05/06. Separately, "deploy it for free" collides with the fact that timing measurement needs a quiet machine with a real browser.
**Evidence:** measured on the dev laptop (research log 2026-10-01): A/A noise on ΔScript is **±0.3 ms idle** versus **±4 ms loaded**, and a session once started 108% slower than its own calibration reference. No free hosting tier offers a dedicated idle machine, a real Chromium, or arbitrary `npm install`. Vercel's free Node functions cap at 60 s with a 512 MB `/tmp`, which is too tight for installing and building a large package; GitHub Actions gives unlimited minutes on a public repository.
**Decision:**
1. **Three tiers, split by the *kind* of number each produces** (doc 06 §7): tier 1 = Next.js + API on Vercel with Neon Postgres (always on, serves stored `exact`/`predicted` values); tier 2 = **GitHub Actions** worker for install → build → Δbytes → features → prediction (always on, **no timing**); tier 3 = the quiet machine for every `measured` number and all dataset collection.
2. **Running tier 2 on a shared CI runner does not violate hard rule 1 / NFR-REP3.** That rule exists because *timing* is sensitive to machine load; byte counts are deterministic and reproduce identically on a busy runner. Timing stays in tier 3, and the UI labels every number with the tier that produced it.
3. **Jobs live in Postgres, not Redis** (doc 06 §7.3). Workers claim a job with a single atomic `UPDATE ... WHERE status='queued' RETURNING`, and a job abandoned past its lease returns to `queued` — which is also the resume mechanism for a crashed campaign (FR-51). BullMQ remains the design for a self-hosted deployment.
4. **Own authentication, not OAuth** (doc 06 §8): Argon2id password hashing, opaque server-side sessions in `httpOnly`/`Secure`/`SameSite=Lax` cookies, hashed single-use OTP and reset tokens, CSRF double-submit, CAPTCHA on auth forms, roles `user`/`researcher`/`admin` enforced server-side. A third-party identity provider would hide exactly the mechanisms the course asks us to implement and document.
5. Local development uses a **Neon branch** rather than Docker — neither Docker nor a local Postgres is installed on the dev machine, and a shared schema stops dev and production from drifting. The harness keeps working with no database and no network.
**Consequences:** doc 04 gains F25–F32 (§2.1, each with a product justification, not only a rubric one); doc 05 gains FR-60–FR-73 (auth/authorization), FR-74–FR-80 (the six validators), NFR-U4–U7 (responsiveness) and NFR-D1–D4 (deployment); doc 06 gains §7.1–7.4 and §8; `docs/12-how-it-works-simple.md` explains the whole system as inputs/outputs for non-specialist readers and is the source for the Methodology chapter. `packages/db` must grow the `user`, `session`, `otp`, `password_reset`, `audit_log` and `job` tables. Phase 5 is pulled forward in doc 09.

## 2026-10-02 — Web platform: own auth, and one database driver everywhere
**Context:** P5 pulled forward (doc 09) to deliver the course's deployed full-stack requirement. Two implementation choices needed recording because they are not obvious from the code.
**Evidence / problems hit:**
- **PGlite cannot be embedded in Next.js.** Running PGlite (Postgres in WASM) inside a Next route handler fails with `ERR_INVALID_ARG_TYPE: The "path" argument … Received an instance of URL` — Next's `URL` shim is not the one `node:fs` recognises, so PGlite's WASM asset loading breaks. It works fine under plain `tsx`.
- **The PGlite socket server serves one connection.** With the default pool of 5, every second query failed with `read ECONNRESET`.
- **An SVG `<text>` CAPTCHA is not a CAPTCHA.** The first implementation drew the challenge with `<text>` elements, which puts the answer in the response for any bot to extract with a regex. Replaced with a hand-written stroke font rendered as `<path>` geometry, with per-point jitter, rotation and decoy curves.
**Decision:**
1. **One database driver everywhere.** The app always speaks the Postgres wire protocol via `pg`; local development runs PGlite behind `@electric-sql/pglite-socket` (`pnpm db:serve`), so dev and production differ only in the value of `DATABASE_URL`. A dev setup on a different driver would hide bugs. The pool is capped at 1 when the URL is the local socket server.
2. **Own authentication, no identity provider** (doc 06 §8): Argon2id (19 MiB / 2 passes), opaque 256-bit session ids stored **hashed** in `auth_session` with `httpOnly`/`Secure`/`SameSite=Lax` cookies, idle 7 d / absolute 30 d, hashed single-use OTP and reset tokens, CSRF double-submit **plus** an origin check, per-IP limits counted from the audit log and per-account lockout on the user row.
3. **Migrations are applied by our own runner** (`packages/db/src/client.ts`), which executes the committed Drizzle SQL and records it in `_deplens_migration`. Idempotent, driver-agnostic, and safe to run on every deploy.
4. **`DEPLENS_E2E=1`** exposes the CAPTCHA answer from `/api/captcha` so the test script can submit forms. It is gated on `NODE_ENV !== 'production'` **and** the flag, and there is deliberately **no bypass inside `verifyCaptcha`** — the checking path is identical in every environment.
**Validation:** 51 page/API test cases pass end to end against a real Postgres (`apps/web/test/e2e-auth.mjs`), covering validation of all six validator kinds, CAPTCHA enforcement, OTP issue/verify/replay, session grant and revocation, CSRF with and without token and from a foreign origin, account lockout after 5 failures, and reset-token single use. The app passes its own performance budget: heaviest route **102.1 KB brotli** against the 150 KB NFR-P5 limit, measured with the same brotli-11 setting the harness uses for Δbytes (`apps/web/test/bundle-budget.mjs`).
**Consequences:** `packages/db` gains `user`, `auth_session`, `otp_code`, `password_reset`, `audit_log` and `job`; `project` gains an owner. `docs/13-deployment-guide.md` documents the free-tier deployment. The analysis/compare UI and the GitHub Actions worker wait on P3's feature extraction.
