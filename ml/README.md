# ml/ — Python ML pipeline & service (Phase 6)

- `deplens_ml/`: dataset export/loading, transforms (asinh), baselines B0–B4, LightGBM models (monotone constraints), conformal intervals, grouped CV, statistics (Wilcoxon + Holm, cluster bootstrap), SHAP.
- `service/`: FastAPI `/predict` (docs/08 §12).
- Feature names: read `packages/feature-schema/feature-schema.json`.
- Env: `uv sync`; paper numbers come from scripts (`make paper-tables`), never from notebooks.
