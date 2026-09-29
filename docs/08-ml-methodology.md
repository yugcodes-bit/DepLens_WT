# 08 — Machine-Learning Methodology, Stack & Architecture

## 1. Learning problem

- **Task:** supervised regression. One row = one **cell** (host H, import spec I of package P@v, profile D).
- **Primary target:** y = ΔScript (ms) — HL estimate from doc 07.
- **Secondary targets:** ΔTBT_load (ms); optional per-bucket heads ΔCompile, ΔEval, ΔGC.
- **Label noise:** each y comes with a 95% CI → we keep σ̂ ≈ (CI_high − CI_low) / 3.92 per row for noise-aware evaluation and optional sample weighting.
- **What "static" means:** features may use package metadata, the lockfile, and **builds** (esbuild/Vite output); they may **not** use any browser execution of the candidate — except in the explicitly labelled *hybrid* model, which may use the isolated measured cost C_iso (cacheable per package version).

### 1.1 Target transform
Costs are heavy-tailed (most packages cost a few ms, a few cost hundreds) and noise can make small deltas negative. Use the **inverse hyperbolic sine** z = asinh(y / s) with s = 1 ms (≈ log for large y, ≈ linear near 0, defined for negatives). Train on z; invert for reporting. Compare against (a) raw-scale Huber loss, (b) log1p(max(y, 0)) in an ablation.

## 2. Dataset construction

```
features (host, spec, schema_version)  ⨝  labels (session → host, spec, profile, metric)
   → rows with: ids | group keys (package_name, host_id, category, alt_group) | features | y, ci_low, ci_high | flags (within_noise, invalid)
```
- Drop invalid cells (runtime errors, failed builds). Keep "zero-cost" cells (Δbytes = 0) as y = 0 with a flag; report metrics with and without them.
- **Group keys:** `package_name` (NOT name@version — versions of the same package must never be split across train/test), `host_id`, `alt_group`.
- Export: Parquet + `data_dictionary.md` + SHA-256 of the file (dataset hash is stored with every model).

## 3. Features

Single source of truth: `packages/feature-schema/feature-schema.json` (name, group, type, unit, description, `monotone` hint). The TS extractor and the Python pipeline both read it.

### G1 — Package metadata (registry + tarball; context-free; ~12)
| Feature | Definition | Rationale |
|---|---|---|
| `pkg_unpacked_bytes` | tarball unpacked size | crude size signal |
| `pkg_js_files` | number of .js/.mjs/.cjs files | structure |
| `pkg_format_{esm,cjs,dual,umd}` | module format from `type`, `exports`, `module`, `main` | CJS hampers tree-shaking |
| `pkg_has_exports_map` | `exports` field present | sub-path imports, tree-shaking |
| `pkg_sideeffects` | `sideEffects` = false / array / absent (categorical) | bundlers keep side-effectful modules |
| `pkg_n_deps`, `pkg_n_peer_deps`, `pkg_n_transitive` | dependency counts | code pulled in |
| `pkg_has_wasm`, `pkg_has_worker` | .wasm files / worker entry points | off-main-thread or async instantiate |
| `pkg_ships_minified` | pre-bundled/minified dist heuristic | affects our AST features |

### G2 — Isolated bundle (esbuild, import spec, peers external; ~8)
| Feature | Definition |
|---|---|
| `iso_min_bytes`, `iso_gz_bytes`, `iso_br_bytes` | size of the import spec bundled alone (bundlejs-style) |
| `iso_full_min_bytes` | size of the **full** namespace import (Bundlephobia-style) |
| `iso_treeshake_ratio` | `iso_min_bytes / iso_full_min_bytes` |
| `iso_modules`, `iso_packages` | modules / distinct packages in the isolated bundle |
| `iso_cjs_byte_share` | fraction of bytes from CJS-wrapped modules |

### G3 — In-context delta (host build diff; ~10)
| Feature | Definition | Rationale |
|---|---|---|
| `ctx_delta_min_bytes`, `ctx_delta_gz_bytes`, `ctx_delta_br_bytes` | exact Δ of the initial load | strongest size signal (baseline B3) |
| `ctx_delta_modules` | modules added | per-module wrapper/eval overhead |
| `ctx_new_packages` | packages new to the app | code actually added |
| `ctx_shared_packages`, `ctx_shared_bytes_saved` | candidate's packages already shipped; `iso_min_bytes − ctx_delta_min_bytes` | **the context effect on bytes** |
| `ctx_dup_versions` | new duplicate versions of already-present packages | duplicated code |
| `ctx_in_initial_chunk` | import lands in initial chunk (1) or lazy (0) | placement |
| `ctx_delta_chunks` | new chunks | extra requests |

### G4 — Code structure of the **added** code only (AST on unminified delta; ~30)
Grounded in V8's documented behaviour: functions not called at load are only pre-parsed; possibly-invoked function expressions (parenthesized) are eagerly compiled; top-level work executes at import.

| Feature | Definition |
|---|---|
| `ast_nodes` | total AST nodes |
| `fn_count`, `fn_decl`, `fn_expr`, `fn_arrow` | functions by kind |
| `fn_bytes_share_toplevel` | share of bytes outside any function (executed at load) |
| `toplevel_stmts` | module-scope statements |
| `toplevel_calls`, `toplevel_new` | call / `new` expressions at module scope (eager work) |
| `iife_count`, `pife_count` | immediately-invoked / parenthesized function expressions (eager compile) |
| `class_count`, `class_members` | classes & members (class fields run at construction, static blocks at load) |
| `toplevel_loops`, `max_loop_depth` | loops at module scope; nesting |
| `cyclomatic_sum` | Σ decision points |
| `obj_literal_props`, `largest_literal_bytes` | big object/array literals (locale tables, data) |
| `string_literal_bytes`, `template_literals` | embedded strings/templates |
| `regex_literals`, `regex_ctor_calls` | regex compilation |
| `json_parse_calls` | `JSON.parse('…')` payloads |
| `eval_like` | `eval`, `new Function` |
| `try_catch`, `async_fns`, `generators`, `regenerator_runtime` | transpilation artefacts & control flow |
| `polyfill_signals` | assignments to built-in prototypes/globals, `core-js` modules |
| `dom_refs` | `document.`, `querySelector*`, `createElement`, `addEventListener` |
| `layout_refs` | `getBoundingClientRect`, `offset*`, `client*`, `scroll*`, `getComputedStyle` (forced layout risk) |
| `style_injection` | `<style>` insertion, `insertRule`, CSS-in-JS runtime signals |
| `timer_refs`, `raf_refs`, `idle_refs` | `setTimeout/Interval`, `requestAnimationFrame`, `requestIdleCallback` |
| `observer_refs` | Mutation/Resize/Intersection/Performance observers |
| `intl_refs` | `Intl.*` constructors (can be costly to construct) |
| `wasm_refs`, `worker_refs`, `dynamic_imports` | async/off-thread work, lazy chunks inside the package |
| `toplevel_side_effect_score` | Σ module-scope statements that are not pure declarations/exports |

(Features that are exact zeros for >99% of rows are dropped after EDA and noted.)

### G5 — Host context (~8)
`host_framework` (categorical), `host_baseline_min_bytes`, `host_modules`, `host_packages`, `host_build_target` (ES version), `host_entry_eval_share` (share of baseline bytes in the entry chunk), and — for the ΔTBT model — `host_entry_task_ms_est` (estimated from baseline bytes in static mode; measured in hybrid).

### G6 — Measured features (hybrid model only)
`iso_script_ms`, `iso_compile_ms`, `iso_eval_ms` (C_iso at the same profile), `host_baseline_script_ms`, `host_entry_task_ms` (measured once per host).

### G7 — Profile
`profile_slowdown` (calibrated factor) — or train one model per profile if the §4.7 experiment in doc 07 supports projection.

## 4. Baselines (what we must beat)

| ID | Baseline | Represents | Uses measurement? |
|---|---|---|---|
| B0 | Median of training y (per profile) | "No information" | no |
| B1 | Linear fit on `iso_full_gz_bytes` | **Bundlephobia-style** whole-package size | no |
| B2 | Linear fit on `iso_gz_bytes` (import-aware) | **bundlejs-style** | no |
| B3 | Linear fit on `ctx_delta_min_bytes` (+ intercept) | **Strongest static proxy**: exact in-context bytes | no |
| B4 | `iso_script_ms` (and a linear calibration of it) | **Measure-in-isolation** (size-limit/estimo-style), context-free | **yes** (isolated) |

Fit B1–B3 as simple linear regressions on the transformed target *and* on raw ms; report the better. A reviewer will ask about B3 and B4 — the paper stands or falls on beating B3 with static features and showing when context beats B4.

## 5. Models

| ID | Model | Features |
|---|---|---|
| M1 | **LightGBM** regressor | G1–G5 (+G7) — fully static |
| M2 | LightGBM **hybrid** | M1 + G6 |
| M3 | M1/M2 + **conformalized quantile regression** (LightGBM quantile objective α = 0.1 and 0.9, conformalized on a calibration fold) | intervals |
| Sanity | ElasticNet, RandomForest, XGBoost | same as M1 | 

Settings:
- **Monotone constraints** (LightGBM `monotone_constraints`) = +1 on byte features (`ctx_delta_*`, `iso_*_bytes`) and on `profile_slowdown`. Domain knowledge; improves extrapolation and trust; report an ablation without them.
- Early stopping on an inner validation fold; `min_data_in_leaf` ≥ 20 (small data).
- **Why not deep learning / GNNs on ASTs:** a few thousand rows of tabular data; GBDTs are the established choice for this regime, interpretable with exact TreeSHAP, and fast to serve. TEP-GNN-style models are a *future-work* comparison once the dataset grows.

### Ablations (answers "which information matters")
1. G1 only · G1+G2 · G1+G2+G3 · +G4 · +G5 (static full) · +G6 (hybrid)
2. Without monotone constraints
3. Target transform: asinh vs log1p vs raw-Huber
4. Label-noise weighting on/off (weight = 1 / (σ̂² + τ²))

## 6. Hyperparameter tuning
**Optuna** (TPE, 60–100 trials) inside **nested grouped CV** (outer: evaluation folds; inner: GroupKFold by package). Search space: `num_leaves` 7–63, `learning_rate` 0.01–0.2 (log), `n_estimators` via early stopping (≤ 3000), `min_data_in_leaf` 10–80, `feature_fraction` 0.5–1.0, `bagging_fraction` 0.6–1.0, `lambda_l1/l2` 1e-3–10 (log). Seeds fixed and logged.

## 7. ΔTBT: learned vs analytic
TBT is thresholded per task, so it is non-linear in ΔScript and depends on the host's task layout. Two estimators:
- **Analytic (task-merging) model:** assume the package's eval runs inside the entry-chunk evaluation task of duration T (host baseline). Then ΔTBT ≈ max(0, T + ΔScript·s − 50) − max(0, T − 50), where s is the profile slowdown and ΔScript is predicted by M1/M2. Needs T (measured once per host in hybrid, estimated from bytes in static mode).
- **Learned:** LightGBM on the same features + `host_entry_task_ms(_est)`.
Evaluate both; ship the better one. Showing that a two-line analytic model explains most ΔTBT variance would be a nice, explainable finding.

## 8. Evaluation protocol

### 8.1 Splits (all grouped; report each)
| Split | How | Question it answers |
|---|---|---|
| S1 random-cell (reference only) | KFold on rows | optimistic upper bound — **never the headline** |
| **S2 unseen packages** (primary) | GroupKFold(k=5) by `package_name` | new package, known apps |
| **S3 unseen hosts** | Leave-one-host-out | known packages, new app |
| **S4 unseen both** | block split: packages × hosts, test = unseen×unseen | the real user scenario |
| S5 temporal (optional) | train on versions published before date T | future package versions |

Repeat S2 with 5 different seeds (5×5 folds); report mean ± CI over folds, computed with a **cluster bootstrap over packages**.

### 8.2 Metrics
| Metric | Why |
|---|---|
| MAE (ms), median AE (ms) | interpretable error |
| RMSE on asinh scale | penalizes relative errors across scales |
| Spearman ρ | ranking quality overall |
| **Within-noise accuracy** = share of rows with \|ŷ − y\| ≤ max(CI half-width of y, 1 ms) | "as good as a measurement" |
| R² (raw and transformed) | conventional |
| Stratified MAE by cost bucket (<5, 5–20, 20–100, >100 ms) and by category | where the model fails |

### 8.3 Decision-level metrics (RQ4)
- **Pairwise ranking accuracy** within alternative groups, on pairs whose measured difference is significant (CIs don't overlap); plus Kendall τ-b per group; **top-1 accuracy** (picks the measured cheapest).
- **Budget violation** classification at budgets {10, 25, 50, 100} ms: precision, recall, F1, AUROC using the predicted p90 / p50.
- **Interval quality:** empirical coverage of 80%/90% intervals (target ± 5 pts) and mean width.
- **Predict-then-verify curve:** sort test rows by interval width (or by "straddles budget"), replace the prediction with the measured value for the top x% (x = 0…100), plot accuracy (and budget-decision F1) vs x. Report the x needed to reach, e.g., 95% of "measure everything" decision accuracy — this is the quantified **measurement savings** and the direct answer to "why not just measure?".

### 8.4 Statistical testing
- Compare models on the **same test rows**: Wilcoxon signed-rank on paired absolute errors (model vs each baseline), **Holm–Bonferroni** correction across comparisons, effect size **Vargha–Delaney Â12** (Arcuri & Briand) or Cliff's δ.
- Confidence intervals for every headline metric via **cluster bootstrap over packages** (rows are not independent within a package).
- Report non-significant results honestly.

### 8.5 RQ1/RQ2 analyses (no ML needed)
- RQ1: distribution of context effect ΔC − C_iso (and ratio ΔC/C_iso) with CIs; share of cells where |context effect| > MDE; breakdown by `ctx_shared_packages > 0`, by host baseline size, for ΔScript vs ΔTBT.
- RQ2: Spearman/Pearson and R² of each size proxy vs ΔScript; residual analysis (which packages are "small but expensive"/"large but cheap" — great qualitative examples for the paper).

## 9. Explainability
- **TreeSHAP** via LightGBM `predict(..., pred_contrib=True)` (exact, fast) → per-row contributions in transformed space; convert to approximate ms contributions for the UI by the local linearization of the inverse transform, and label as approximate.
- **Global:** mean |SHAP| per feature and per group; dependence plots for top features; compare with V8's documented mechanisms (RQ5).
- **UI text templates** map features to sentences (e.g., `ctx_shared_bytes_saved` → "Your app already ships {pkgs}, saving ~{KB} KB").

## 10. Leakage & validity checklist
- [ ] Split by `package_name`, never by version or by row.
- [ ] Alternative-group evaluation: whole groups in test folds for ranking metrics (or report both).
- [ ] No feature computed from the treatment *measurement* in static models (G6 only in hybrid).
- [ ] Hyperparameters tuned only on inner folds.
- [ ] Conformal calibration fold disjoint from training and test (grouped).
- [ ] Feature scaling/encoding fitted inside folds (pipelines).
- [ ] Popularity features (downloads, stars) excluded from the main model (they could proxy "well-known heavy packages"); test them only as an ablation.

## 11. ML stack

| Purpose | Tool |
|---|---|
| Env & deps | Python 3.11+, **uv** (`pyproject.toml`, lockfile) |
| Data | pandas or Polars, PyArrow (Parquet) |
| Models | LightGBM (main), XGBoost & scikit-learn (comparisons, pipelines, ElasticNet, RF) |
| Tuning | Optuna |
| Uncertainty | own split-conformal CQR (≈ 40 lines) or MAPIE |
| Explainability | LightGBM `pred_contrib` (TreeSHAP), `shap` for plots |
| Statistics | SciPy (`wilcoxon`), statsmodels (multipletests Holm), own cluster bootstrap |
| Plots | Matplotlib (paper figures, vector PDF) |
| Serving | FastAPI + Pydantic + Uvicorn |
| Tracking | versioned `ml/reports/<run-id>/` with config + metrics JSON (MLflow optional) |
| Tests | pytest (transforms, conformal coverage on synthetic data, schema contract) |

## 12. Model artifact & serving contract
```
models/<version>/
  model_point.txt          # LightGBM (asinh target)
  model_q10.txt, model_q90.txt
  conformal.json           # calibration scores / adjustment per interval level
  feature_schema.json      # exact copy used at training time (schemaVersion)
  transforms.json          # target transform params, category mappings
  metrics.json             # S2–S4 metrics, dataset hash, git sha, seeds
  card.md                  # model card (rendered in the UI)
```
`POST /predict` → validates `schemaVersion`, builds the frame in schema order, predicts point + quantiles, applies conformal adjustment, computes contributions, inverse-transforms, returns JSON. OOD flag if any byte feature exceeds the training max or the framework is unseen.

## 13. If results are negative (plan B, still publishable)
- **M1 does not beat B3:** headline becomes *"In-context bytes explain X% of dependency runtime cost; code structure adds little"* — a useful empirical result; the tool ships B3 + intervals + verify.
- **Context effect negligible:** report it; the tool still gives import-aware runtime estimates; drop "context-aware" from the title.
- **Noise too high for small packages:** focus claims on material costs (> MDE) and on ranking/budget decisions, where noise matters less.
