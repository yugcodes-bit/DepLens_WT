# ml/ — Python ML pipeline & service (Phase 6)

**The pipeline is built and tested. There is no dataset yet** — it needs a measurement campaign on a
quiet machine (see `../STATUS.md` §6). So everything here runs against a clearly-stamped synthetic
generator, and `assert_real()` refuses to let synthetic data reach a reporting path.

```bash
uv sync                  # core deps: pandas, numpy, scikit-learn, lightgbm
uv sync --extra research # adds optuna, xgboost, shap, scipy, statsmodels, matplotlib (P6)
uv sync --extra service  # adds fastapi, uvicorn (P6/P7)

uv run pytest -q                                  # 60 tests
uv run ruff check .
uv run python scripts/evaluate.py --synthetic     # exercise the pipeline — NOT results
uv run python scripts/evaluate.py --dataset ../.work/dataset/cells.parquet   # the real thing
```

## What is here

| Module | Contents |
|---|---|
| `deplens_ml/schema.py` | reads `packages/feature-schema/feature-schema.json`; monotone constraints; the digest the TS side also computes |
| `deplens_ml/dataset.py` | loading + validation, the synthetic generator, and the `assert_real()` gate |
| `deplens_ml/splits.py` | S1–S4 with per-fold leakage assertions; `assert_headline_eligible` refuses S1 |
| `deplens_ml/baselines.py` | B0–B4, isotonic-fitted so each gets its strongest form |
| `deplens_ml/metrics.py` | asinh transform, point metrics, `within_noise_rate`, split-conformal intervals |
| `deplens_ml/model.py` | LightGBM with monotone constraints + the cross-validated comparison harness |
| `scripts/evaluate.py` | writes a timestamped results table to `reports/measured/` or `reports/synthetic/` |

## Rules this code enforces, not just documents

- **Hard rule 3** — split by package name. `iter_folds` groups, and `assert_no_group_leakage` runs
  on *every* fold, not only in tests.
- **Hard rule 4** — a random-row result is never a headline. S1 is evaluated as a leakage
  diagnostic and printed under `[DIAGNOSTIC ONLY, NOT A RESULT]`; `assert_headline_eligible(S1)`
  raises.
- **Hard rule 5** — baselines are fitted, and a baseline the dataset cannot support (B4 needs the
  measured `iso_script_ms`) is reported as unavailable with its reason rather than quietly dropped.
- Feature names come only from `feature-schema.json`; `tests/test_schema_contract.py` is the Python
  half of the TS ↔ Python contract and asserts the same SHA-256 digest as the TypeScript side.
- Every random choice takes a seed, and the seed is written into the results metadata.
- Paper numbers come from `scripts/`, never from a notebook.
