# 10 — Brutally Honest Assessment

You asked for this to be "the most novel project" and to be scored brutally. Here it is.

## 1. Short verdict

- **The gap is real.** I found no tool and no paper that predicts the runtime cost of adding an npm dependency to a *specific* app *before* integration, and no public dataset of measured per-dependency browser cost across apps. That is a legitimate, publishable gap.
- **The original pitch, as written, is a 5/10 on novelty.** "Static features → LightGBM → execution time, compared against bundle size" is a straightforward application of known ML to a new target, and a reviewer can knock it down with one question: *"Why not just measure it? size-limit already runs headless Chrome."* It also compares against a strawman (Bundlephobia size) and lists metrics (INP, LCP) that a lab harness cannot label credibly.
- **The revised formulation in these docs is a solid 7/10** for a good mid-tier venue (ICWE, EASE, ICPE workshop tracks, IEEE conferences). It is **not** an ICSE/FSE/WWW main-track paper this semester, and that is fine.
- **It will not be "the most novel project" in any absolute sense.** Its strength is being *useful, rigorous and honest*: a clean formulation, a careful measurement protocol, an open dataset, strong baselines, uncertainty, and decision-level evaluation. Reviewers reward that more than a flashy model.

## 2. Scores

| Dimension | Original pitch | Revised plan | Why |
|---|---|---|---|
| Problem significance | 7 | 7 | Real pain for perf-conscious teams; many devs don't feel it until a regression |
| Novelty | **5** | **7** | Gap is real; novelty comes from the *incremental, context-dependent* formulation + dataset + uncertainty + decision evaluation, not from the ML algorithm |
| Technical soundness | 4 | 8 | Paired/interleaved labels, A/A noise floor, injected-cost validation, grouped CV, strong baselines, cluster bootstrap |
| Feasibility in one semester | 6 | 6.5 | The measurement campaign is the long pole; the plan front-loads de-risking |
| Usefulness of the tool | 5 | 7 | Compare-in-your-app + intervals + verify + import advice change real decisions |
| Web-tech course fit | 9 | 9 | Bundlers, ESM/tree-shaking, CDP, web perf APIs, REST/SSE, Next.js — very on-topic |
| Publishability (mid-tier) | 4 | 7 | With the revised evaluation, a solid empirical/tool paper |
| Publishability (A*) | 1 | 3 | Would need many more apps, real devices, a developer study, and a stronger model |

## 3. What was wrong or weak in the original pitch

1. **"Why not just measure?"** is unanswered. Fix: predict-then-verify, with a measured *savings curve* (how much measurement you avoid for a given decision accuracy), plus the pre-integration and many-alternatives use cases where measuring is impractical.
2. **Strawman baseline.** Bundlephobia's whole-package size is easy to beat. Fix: beat **exact in-context Δbytes** (computable cheaply from a build) and compare to an **isolated measured cost** (size-limit/estimo-style).
3. **"Static analysis of the package" undersells what you can compute.** A 2-second build gives exact tree-shaken, deduplicated bytes. Not using that makes the model look better against weak baselines and worse in reality.
4. **Target undefined.** "JavaScript execution time" of a library is mostly its *load-time* evaluation; *usage-time* cost depends on inputs and can't be statically predicted. Fix: define ΔScript precisely (compile + eval + GC in the load window) and scope out usage-time cost.
5. **INP/LCP as labels.** INP needs real interactions — a lab label would reflect your scripted click. LCP only changes meaningfully in client-rendered hosts. Fix: primary = ΔScript, secondary = ΔTBT (with an analytic task-merging model), LCP on a subset, INP dropped.
6. **"Unseen websites" with a handful of apps.** Leave-one-app-out with 4–5 apps is weak evidence. Fix: 10–15 hosts incl. real OSS apps; report S2/S3/S4 splits separately.
7. **Noise ignored.** size-limit's own README says its timing "might be unstable". Fix: paired sessions, A/A MDE, CIs on labels, noise-aware metrics.
8. **Leakage risk.** Random row splits would put versions of the same package in train and test. Fix: group by package name.

## 4. Reviewer objections you WILL get, and your answers

| Objection | Answer (backed by an experiment in the plan) |
|---|---|
| "Just measure it." | Measurement needs integration + a browser + repeated runs (minutes, noisy); prediction is ~1 s and works for 5 alternatives before writing code. Predict-then-verify curve: measure only the uncertain x% to get ~95% of full-measurement decision accuracy (RQ4). |
| "Size is enough." | RQ2 quantifies it. If in-context bytes *is* enough, that's a finding and the tool uses it; if not, we show where it fails (small-but-expensive packages). |
| "Synthetic apps aren't real sites." | Mix of templates, real OSS apps, heavy variants; leave-one-host-out; threats to validity. |
| "Emulated CPU ≠ real phone." | Calibration-based profiles; optional real-device subset with rank correlation; stated limitation. |
| "Your labels are noise." | A/A null tests, MDE per host, injected-cost test recovering known N ms, CIs per label. |
| "GBDT isn't novel." | Correct — the contribution is formulation, data, evaluation. GBDT is the right tool for a few thousand tabular rows; deep models are future work once the dataset grows. |
| "Only Chromium / only Vite." | Stated scope; V8/Blink dominates browser share; Vite/Rollup/esbuild are the dominant modern toolchain. |
| "Load-time only." | Stated scope; usage-time cost needs workload specs → future work with a curated subset. |

## 5. Things that could kill the project — and the fallback for each

| Killer | Probability | Fallback |
|---|---|---|
| Harness can't resolve < 5 ms on your hardware | Medium | Thread-time labels at 1× + calibrated projection; quieter machine; focus on material costs |
| In-context bytes explains nearly everything | Medium | Paper = empirical study "Is bundle size a good proxy for JS runtime cost?" + tool with intervals; still publishable |
| Context effect negligible | Low–medium (peer-dependency libraries almost guarantee *some* effect on bytes; TBT merging adds more) | Report honestly; retitle |
| Campaign too slow | Medium | Fewer hosts, 2 scenarios, 8 pairs; second machine |
| Team runs out of time | High | MUST-only; product runs on B3 placeholder until ML is ready |

## 6. What would make it genuinely stand out (pick 1–2, not all)

1. **Real-device validation** on even one cheap Android phone: rank correlation between lab-predicted and on-device costs. Rare in student papers; very convincing.
2. **The dataset as a first-class artifact** (Zenodo DOI, data dictionary, reproducibility checklist). Datasets get cited.
3. **The predict-then-verify savings curve** — a single figure that answers the #1 objection.
4. **The analytic ΔTBT task-merging model** — simple, explainable, and it shows why context matters for blocking time even when CPU cost is fixed.
5. **A small developer study** (8–12 people) showing better or faster dependency decisions with DepLens.

## 7. Things I recommend you NOT do

- Don't add a GNN/transformer "to be more novel". With ~5k rows it will overfit and reviewers will see it.
- Don't add an LLM chatbot to the UI.
- Don't report S1 (random-row split) as the headline.
- Don't claim "first" without re-running the literature search right before submission.
- Don't run measurements on a shared cloud VM, a CI runner, or a laptop on battery.
- Don't submit to look-alike predatory conferences (see doc 09 §5).

## 8. Bottom line

Build it. The idea is good enough, the gap is real, and the web-tech learning is excellent. Treat the measurement harness as the product's foundation and the paper's main credibility source, beat the *strong* baselines, report uncertainty, and be explicit about scope. That gets you a respectable, citable paper and a tool people could actually use — which is more than most "novel" student projects achieve.
