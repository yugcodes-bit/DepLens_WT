# 07 — Measurement Methodology (ground truth)

**This document is the scientific core.** If the labels are noisy or biased, no model and no paper survives review. Change this protocol only with a dated entry in `docs/research-log.md` and a re-run of the validation tests in §8.

## 1. What a label is

For a **cell** (host H, import spec I of package P@v, profile D) we run a **session**: k interleaved pairs of page loads, baseline (A = H) and treatment (B = H ⊕ I).

Per run we extract metrics (§4). The label for metric m is the **Hodges–Lehmann (HL) estimate of the paired differences** d_j = m(B_j) − m(A_j), j = 1..k, i.e. the median of all Walsh averages (d_i + d_j)/2, with a **95% bootstrap CI** (2,000 resamples of pairs, percentile method). We store estimate, CI, k_valid, and the per-run values.

Why paired + HL: pairs cancel slow drift (thermal, background activity); HL is robust to outliers yet more efficient than the plain median; bootstrap CIs are distribution-free.

## 2. Building baseline and treatment

### 2.1 Injection
Each host app's entry module contains a marker:

```js
/* @deplens-inject */
globalThis.__DL_SINK__ = [];          // baseline: empty sink
/* @deplens-end */
```

The injector replaces the block between the markers for the treatment, e.g.:

```js
/* @deplens-inject */
import { format, parseISO } from 'date-fns';
globalThis.__DL_SINK__ = [format, parseISO];
/* @deplens-end */
```

- The **sink** keeps imported bindings alive so tree-shaking reflects "I will use these exports" without executing extra code. The baseline has an empty sink so the only difference is the import.
- Import placement: top of the entry module (initial chunk) = default. **Lazy variant:** `globalThis.__DL_SINK__ = () => import('date-fns')` (not called during load) — measures what remains in the initial load.

### 2.2 Import scenarios per package
| Scenario | Import | Purpose |
|---|---|---|
| **full** | `import * as ns from 'pkg'; globalThis.__DL_SINK__ = [ns];` (+ default if present) | Upper bound; what Bundlephobia-style tools implicitly assume |
| **typical** | 1–3 most common named/default imports (from README examples/types; curated) | What developers actually do |
| **sub-path** (where it exists) | e.g. `lodash/debounce` | For import-form advice evaluation |

### 2.3 Build
- Host apps are built with **their own Vite config** in production mode, with a small `deplens-stats` plugin that writes chunk → modules → rendered length.
- Pinned toolchain per dataset release (Node, Vite, esbuild versions recorded in the session).
- The harness adds four inline settings to every host build (P1, see research log 2026-10-01):
  `base: './'` (relative asset URLs — A and B are served under path prefixes on one origin, §3.5),
  `mode: 'production'` with **NODE_ENV left unset** (an inherited NODE_ENV overrides the mode and
  silently produces a development build: larger and non-deterministic), `sourcemap: false`, and
  `reportCompressedSize: false` — we compress ourselves at fixed gzip-9 / brotli-11 so byte deltas
  are comparable across hosts and releases.
- **Each build runs in its own process.** On Windows a work dir whose rollup/esbuild native binaries
  have been loaded cannot be deleted until the loading process exits, so an in-process campaign would
  leave one `node_modules` per cell behind. `harness build --json` is the single-build entry point.
- Host apps keep their build toolchain in `devDependencies`, as a real app does; the installer passes
  `--include=dev` explicitly because npm omits dev dependencies when NODE_ENV=production.
- Sanity checks (FR-34): treatment Δbytes > 0 (unless the package is genuinely empty after tree-shaking — then label as "zero-cost", do not measure); the package appears in the stats; the build is deterministic (same hash on rebuild).

## 3. Measurement environment

### 3.1 Machine
- **Dedicated, idle** desktop or bare-metal machine. Not a shared cloud VM (Laaber et al. 2019 show large cloud variability) and not a laptop on battery.
- Linux: CPU governor `performance`; disable turbo boost if possible (reduces thermal drift); no GUI apps; no cron jobs during campaigns.
- Record: CPU model, cores, RAM, OS/kernel, Chromium build, Playwright version, Node version, flags.

### 3.2 Calibration & drift control
- At session start, run a fixed JS microbenchmark inside the page (e.g., a deterministic loop + JSON parse/stringify, ~200 ms at 1×) three times → `calibration_ms` (median). Store it.
- Abort/retry the session if `calibration_ms` deviates > 10% from the machine's reference.
- Also record Lighthouse-style **benchmarkIndex** once per machine per day for comparability with Lighthouse docs.

### 3.3 Profiles (presets)
Lighthouse's docs note that CPU throttling is expressed **relative to the host**, so a "4×" on a fast desktop and on a slow laptop are different phones. We therefore define profiles by **target calibration time**, not by raw multiplier:

| Profile | Target | Network model (for ΔNetwork) |
|---|---|---|
| desktop | 1× on the reference machine | 10 Mbps, 40 ms RTT |
| mid-tier-mobile *(default)* | slowdown chosen so the calibration benchmark takes ≈ 4× reference (Lighthouse's default desktop→mid-tier-mobile ratio) | "Slow 4G": 1.6 Mbps down, 150 ms RTT (Lighthouse mobile default) |
| low-end-mobile | ≈ 10× reference (subset only) | 0.4 Mbps, 400 ms RTT |

**Worked example (first dev machine, i7-11800H, Chromium 141, measured 2026-10-01).** The same machine,
measured twice — median of 3 sweeps each, `pnpm harness calibrate --repeats 3`:

| state | machine index | rate 1 | 2 | 3 | 4 | 6 | sweep spread | slowdown at rate 4 | `mid-tier-mobile` resolves to |
|---|---|---|---|---|---|---|---|---|---|
| loaded | 58,928 | 20.8 ms | 57.4 | 101.8 | 174.7 | 314.2 | 14–52% | 8.4× | rate 2.58 |
| **idle** | 105,320 | 11.3 ms | 23.9 | 37.6 | 48.4 | 83.6 | 4–11% | 4.28× | rate 3.70 |

Two lessons. (1) **Calibrate idle.** Under load the higher rates suffer disproportionately, so a
reference taken on a busy machine overstates the slowdown and mis-resolves every profile. (2) The rate
still has to be **interpolated from each machine's own curve** (`resolveCpuRate`), never hard-coded:
even idle, rate 4 is 4.28× here and ≈ 4.8× on the Phase 0 cloud container.

A machine qualifies for dataset cells only if its rate-1 calibration is **stable to within a few
percent across sweeps** (target ≤ 5%). Record the machine index with every session — it is the cheapest
way to notice a reference captured in the wrong state (research log 2026-10-01).

If you have **one real Android phone**, measure the calibration benchmark on it (Chrome via USB remote debugging) to anchor a "this phone" profile — a strong credibility boost in the paper (optional, doc 09).

### 3.4 Browser setup
- Playwright Chromium (pinned), headless (new headless mode). One browser process per session; **a fresh browser context per run** (cold HTTP cache ⇒ no V8 code cache reuse between runs).
- Viewport 412×915 (mobile-ish) for mobile profiles; device scale factor 2.
- CDP: `Emulation.setCPUThrottlingRate(rate)` for the profile; network **not throttled** during CPU measurement (files served from localhost). Network cost is modeled separately (§4.6) — this removes network jitter from CPU labels.
- Disable: extensions, background networking, component updates, default apps, sync; set `--disable-features=Translate,OptimizationHints` etc. Record the exact flag list.

### 3.5 Serving
- `dist/` served from a local static server (HTTP/1.1, no compression needed for CPU runs), same port, same headers for A and B. `Cache-Control: no-store`.
- Baseline and treatment are mounted under path prefixes (`/a`, `/b`) of that one origin, which is why
  host builds must use `base: './'` (§2.3). A fresh browser context per run keeps the HTTP cache cold,
  so sharing an origin does not leak a V8 code cache between arms.

## 4. Per-run measurement

### 4.1 Load window
Navigate; wait for `load`; then wait until the host sets `performance.mark('app-ready')` (after first render) **and** the main thread has been idle for 2 s (no task > 5 ms), capped at 15 s. Stop tracing.

### 4.2 Trace categories
`devtools.timeline`, `disabled-by-default-devtools.timeline`, `v8`, `v8.execute`, `disabled-by-default-v8.compile`, `blink.user_timing`, `loading`, `toplevel`.

### 4.3 Main-thread identification
The renderer main thread (`CrRendererMain`) of the page's renderer process; ignore other frames/processes.

### 4.4 Buckets (adapted from estimo's documented taxonomy)
| Bucket | Trace events |
|---|---|
| scriptCompile | `v8.compile`, `v8.compileModule`, `v8.parseOnBackground` (report background separately — it does not block the main thread) |
| scriptEval | `EvaluateScript`, `v8.evaluateModule`, `FunctionCall`, `TimerFire`, `FireAnimationFrame`, `RunMicrotasks`, `V8.Execute` (top-level only; avoid double counting nested events) |
| gc | `MinorGC`, `MajorGC`, `BlinkGC.AtomicPhase`, `V8.GC_*` |
| styleLayout | `UpdateLayoutTree`, `Layout`, `ScheduleStyleRecalculation`, `InvalidateLayout` |
| paint | `Paint`, `PaintImage`, `RasterTask`, `CompositeLayers`, `UpdateLayerTree` |
| parseHTML | `ParseHTML`, `ParseAuthorStyleSheet` |

Nested events: sum **self time** per bucket (duration minus children) to avoid double counting.

**ΔScript = Δ(scriptCompile_main + scriptEval + gc).** Primary label.

### 4.5 Other metrics
- **Tasks:** top-level main-thread tasks (`RunTask` and equivalents); long tasks > 50 ms.
- **TBT_load:** Σ max(0, task − 50 ms) for tasks between FCP and the end of the load window (Lighthouse uses FCP→TTI; we document our window explicitly).
- **FCP / LCP:** from trace markers (`firstContentfulPaint`, `largestContentfulPaint::Candidate`, last candidate before end), cross-checked with an injected `PerformanceObserver`.
- **JS heap:** `Performance.getMetrics` → `JSHeapUsedSize` at the end of the window.
- **Errors:** `pageerror` and console errors → run invalid.

### 4.6 Network cost (modeled, not measured)
For the default single initial chunk: **ΔNetwork ≈ Δbrotli_bytes × 8 / throughput** (bytes are already in the same request). If the treatment adds new requests (new chunks), add `RTT × (new sequential round trips)`. We report this separately from CPU cost because (i) it is deterministic given bytes, and (ii) mixing network jitter into CPU labels would inflate noise. *Optional validation:* on 30 cells, measure with applied network throttling and compare to the model.

### 4.7 Throttled wall time vs thread time — ✅ first answer from Phase 0 (see research log, 2026-09-28)
> **Result on the build container:** ΔScript slope ratio 4×/1× = **3.99 for thread time (`tdur`)**, 3.56 for wall time ⇒ thread time reflects throttling. Primary label = thread time. The 1×-measure-and-project option is promising (much lower noise at 1×) but must be validated on real packages in P1. Original question kept below for context.

**Original question:**
Chrome trace events carry `dur` (wall time) and often `tdur` (thread CPU time). CPU throttling stretches wall-clock execution. Whether `tdur` also reflects throttling depends on how Chrome implements it. **Experiment (Phase 0, 1 day):** load the calibration page and one heavy package at 1× and at 4×; compare Σdur and Σtdur ratios.
- If `tdur` scales ~4× → use `tdur` (less affected by descheduling) as the label at each profile.
- If `tdur` stays ~1× → measure **CPU work at 1× using `tdur`** (lowest noise) and obtain profile costs by projection (ΔScript_D ≈ s_D × ΔScript_1× with s_D from calibration), validated on a subset measured with applied throttling. This projection approach would also cut measurement time by ~3× per extra profile — a methodological contribution in itself if the validation holds.
Record the decision in the research log; the whole campaign depends on it.

## 5. Host apps

Target **10–15 hosts**; minimum 8 for a credible leave-one-host-out evaluation.

| Type | Examples | Why |
|---|---|---|
| Framework templates (Vite) | vanilla, React, Vue, Svelte, Preact, Solid | Framework diversity; tiny baselines (context ≈ empty page) |
| Realistic OSS apps | RealWorld "Conduit" front-ends (several frameworks), TodoMVC variants | Realistic dependency sets and render work; verify which still build |
| Synthetic heavy variants | a React host with a 300–600 KB baseline (router, state lib, UI kit, date lib) | Tests dedup/shared-dependency effects and task merging |
| (optional) Real product-like app | one open-source dashboard built with Vite | External validity check |

Each host must: build with Vite; have the `/* @deplens-inject */` marker in the entry; set `performance.mark('app-ready')` after first render; use mocked data (no external network); render deterministically (no `Math.random`/`Date.now` in rendering); commit SHA pinned.

**Compatibility matrix:** framework-agnostic packages run in all hosts; framework-specific packages (React component libs, Vue plugins) run only in matching hosts. The matrix is sparse by design — record it.

## 6. Package corpus

### 6.1 Selection
1. Seed from npm download counts (npm downloads API) across **categories**: dates/time, HTTP, utilities, validation/schemas, state management, charts/visualisation, animation, markdown/rich-text, i18n, IDs/crypto, DOM utilities, UI component libraries (per framework), icons, forms, routing, data structures/immutability, parsing (CSV/YAML), maps (optional).
2. Add **alternative groups** from e18e module-replacements and curated sets (e.g., `moment · dayjs · date-fns · luxon`; `axios · ky · ofetch · redaxios`; `lodash · lodash-es · remeda · radash`; `chart.js · echarts · recharts · apexcharts · uplot`; `zod · yup · valibot · joi · superstruct`; `marked · markdown-it · micromark`; `uuid · nanoid`; `redux-toolkit · zustand · jotai · mobx`).
3. **Stratify** by size decile and module format (ESM/CJS/dual) so the model sees the whole range, not only popular giants.

### 6.2 Exclusion rules (record the reason per package)
Node-only (uses `fs`, `child_process`, native addons); CLI tools; type-only packages; packages that fail to bundle for the browser; packages requiring secrets/network at import; packages whose import throws in a browser; deprecated packages (keep only if they are part of an alternative group, e.g., `moment`).

### 6.3 Size of the study
| Item | Target | Minimum |
|---|---|---|
| Package versions | 350 | 200 |
| Import scenarios | 2 per package (full, typical) → ~700 | 400 |
| Hosts | 12 | 8 |
| Cells at primary profile (sparse matrix) | ~5,000 | ~2,000 |
| Pairs per session (k) | 10 | 8 |
| Secondary profile subset | 100 specs × 3 hosts | 60 × 2 |
| Isolated sessions (empty page) | 1 per import spec | same |
| A/A sessions | 2 per host per campaign day | 1 |

**Time budget (estimate — measure in Phase 1 and re-plan):** ~3 s per page load at 4× on small hosts → one 10-pair session ≈ 60–75 s incl. overhead → 5,000 cells ≈ 90–105 machine-hours ≈ 4–5 days of continuous running on one machine. Two machines halve it but add a machine factor (record `machine_id`; include it in the analysis). Plan the campaign to run over nights/weekends while you build the product.

## 7. Noise, validity and quality control

- **A/A sessions** (baseline vs baseline) per host and day → distribution of HL estimates under the null → **MDE₉₅** (the 95th percentile of |A/A estimate|). Report per host/profile. Labels with |estimate| < MDE are "within noise" — keep them (they are real information: "negligible cost"), but report metrics separately for material vs negligible cells.
- **Order effects:** randomize order within each pair; test with a mixed model or a simple check (mean difference A-first vs B-first).
- **Warm-up:** discard the first pair of each session.
- **Failures:** retry a failed run once; if > 20% runs fail, mark the session failed.
- **Drift:** calibration before and after the session; flag if they differ > 5%.
- **Machine factor:** if multiple machines are used, measure a shared subset (≥ 50 cells) on all machines and report agreement (Spearman ρ, Bland–Altman).

## 8. Harness validation tests (run before any campaign; re-run after any change)

1. **Injected-cost test (most important).** Synthetic packages (generated by `research/fixtures/generate.mjs`): `@deplens/work-K` performs **K units of fixed CPU work** at module evaluation (1 unit = 100k loop iterations; K ∈ {0, 1, 2, 5, 10, 20, 50, 100}); `@deplens/bytes-K` adds K KB of never-called functions; `@deplens/eager-K` adds the same K KB but calls every function once. Expected: ΔScript linear in K with intercept ≈ 0, slope ratio ≈ s between slowdown s and 1×; bytes-K ≈ 0 (lazy pre-parse), eager-K increasing. Report slope, intercept and R². If the harness cannot resolve differences of a few ms, it cannot label small packages — know this before collecting 5,000 cells.
   ⚠️ Do **not** implement fixtures as `performance.now()` busy-waits: under CPU throttling the wall clock keeps running, so a "busy-wait N ms" does the *same* wall time at every slowdown and hides throttling.
2. **A/A null test:** 95% CIs of A/A sessions cover 0 in ≈ 95% of sessions.
3. **Golden traces:** 3 saved traces with hand-verified bucket sums — parser regression tests.
4. **Determinism of builds:** rebuild each host 3× → identical hashes. Implemented as
   `pnpm harness hosts --determinism` (each build in a separate process and work root).
   ✅ **All 8 hosts pass as of 2026-10-01.**
5. **Throttling behaviour:** §4.7.

## 9. Isolated measurement (for RQ1 and the hybrid model)

Same protocol with an **empty host** (an HTML page whose entry contains only the injection block). C_iso is per (import spec, profile) — cacheable ecosystem-wide in a real deployment, which is why the hybrid model is practical.

## 10. Reproducibility checklist (publish with the dataset; aligns with Demir et al. WWW 2022)
- [ ] Chromium build number and Playwright version; full flag list
- [ ] Machine spec, OS/kernel, governor/turbo settings, calibration reference
- [ ] Host app repos + commit SHAs + build toolchain versions
- [ ] Package name@version + tarball SHA + import spec text
- [ ] Session seeds, k, run order, invalid-run reasons
- [ ] Trace category list and bucket definitions (this document, versioned)
- [ ] Label estimator and CI method
- [ ] A/A results and MDE per host/profile
