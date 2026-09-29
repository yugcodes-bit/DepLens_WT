# DepLens — Project Documents

Context-aware prediction of the browser runtime cost of npm dependencies. Web-technology course project with a research-paper goal.

## Reading order

| # | Document | Read it when |
|---|---|---|
| 01 | [Project definition](01-project-definition.md) — problem, formulation, inputs/outputs, RQs, scope, what's better | first |
| 10 | [Brutally honest assessment](10-honest-assessment.md) — scores, weaknesses, reviewer objections, fallbacks | second |
| 02 | [Market & tool landscape](02-market-landscape.md) — Bundlephobia, npmx, bundlejs, size-limit/estimo, Lighthouse, e18e… | before claiming novelty |
| 03 | [Literature review & research gaps](03-literature-review.md) — papers, gaps G1–G7, references | before writing related work |
| 04 | [Feature evaluation](04-feature-evaluation.md) — scored feature list, MoSCoW, user stories | before building UI |
| 05 | [SRS](05-srs.md) — functional/non-functional requirements, use cases, acceptance tests | during development |
| 06 | [Architecture, web stack & data flow](06-architecture-and-web-stack.md) — C4, DFDs, sequences, ERD, repo layout | during development |
| 07 | [Measurement methodology](07-measurement-methodology.md) — **the scientific core**: labels, harness, hosts, corpus, noise | before touching the harness |
| 08 | [ML methodology](08-ml-methodology.md) — features, baselines, models, splits, metrics, statistics, serving | before touching `ml/` |
| 09 | [Phases & roadmap](09-phases-and-roadmap.md) — weekly plan, exit criteria, venues & deadlines, risks | planning |
| 11 | [Paper plan](11-paper-plan.md) — outline, figures, threats to validity | writing |
| — | [Research log](research-log.md) — dated decisions & experiment results (append-only) | always |

## One-paragraph summary
Developers can check a package's *size* before installing it, but not what it will *cost their app at runtime*. DepLens builds the app with and without the exact import, computes exact byte deltas, extracts static features of the added code and the app context, and predicts extra main-thread time and blocking time for a chosen device profile — with an uncertainty interval, a plain-language explanation, and a ranking of alternatives. When the prediction is uncertain, one click runs a paired A/B measurement in headless Chromium. The research contribution is the incremental-cost formulation, a noise-quantified measurement protocol and open dataset, and an evaluation on unseen packages and apps against strong size-based and measurement-based baselines.
