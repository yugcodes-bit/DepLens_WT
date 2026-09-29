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
