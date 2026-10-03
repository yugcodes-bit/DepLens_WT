"""The DepLens model (doc 08 §5), and the evaluation harness that compares it to the baselines.

Design decisions that are not free choices:

* **LightGBM with monotone constraints.** The schema declares which features must not decrease the
  prediction (``monotone: 1``). Imposing that is not accuracy-chasing — it stops the model learning
  a locally-fitting absurdity like "more added bytes, less time", which would destroy the credibility
  of the explanation list even when the point estimate happened to be good.

* **asinh target.** See ``metrics``: the label is a paired difference, so it can be ≤ 0.

* **Conformal intervals carved out with the same grouped split.** The guarantee requires the
  calibration rows to be exchangeable with the test rows, so calibration is taken from *training*
  groups, never by shaving rows off the test set.

The model is only as good as the dataset, and the dataset does not exist yet. Everything here is
therefore written to be run and checked on the synthetic generator, with ``assert_real`` guarding
the path to any reported number.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from .baselines import Baseline, available_baselines, missing_baselines
from .dataset import encode_categoricals, feature_matrix
from .metrics import (
    IntervalMetrics,
    RegressionMetrics,
    SplitConformal,
    asinh_inverse,
    asinh_transform,
    interval_metrics,
    regression_metrics,
)
from .schema import Schema, load_schema
from .splits import Split, add_group_columns, assert_no_group_leakage, iter_folds


@dataclass
class DepLensModel:
    """Gradient-boosted trees on the static feature groups, with conformal intervals."""

    feature_names: list[str]
    #: asinh scale. 1 ms keeps the transform linear over the range most labels live in.
    target_scale: float = 1.0
    nominal_coverage: float = 0.9
    seed: int = 11
    schema: Schema = field(default_factory=load_schema)
    _booster: object | None = field(default=None, repr=False)
    _conformal: SplitConformal | None = field(default=None, repr=False)
    _fallback_median: float = field(default=0.0, repr=False)

    def fit(self, X: pd.DataFrame, y: np.ndarray, *, calibration_fraction: float = 0.2) -> DepLensModel:
        X = encode_categoricals(feature_matrix(X, self.feature_names), self.schema)
        y = np.asarray(y, dtype=float)
        self._fallback_median = float(np.median(y))

        rng = np.random.default_rng(self.seed)
        n = len(X)
        n_cal = max(1, int(round(n * calibration_fraction))) if n >= 10 else 0
        idx = rng.permutation(n)
        cal_idx, fit_idx = idx[:n_cal], idx[n_cal:]
        if len(fit_idx) == 0:
            fit_idx, cal_idx = idx, np.array([], dtype=int)

        try:
            import lightgbm as lgb
        except ImportError as e:  # pragma: no cover - exercised only without the optional dep
            raise ImportError(
                "LightGBM is required to fit the model. Run `uv sync` in ml/. The baselines in "
                "deplens_ml.baselines need no extra dependency and can be evaluated without it."
            ) from e

        constraints = self.schema.monotone_constraints(self.feature_names)
        booster = lgb.LGBMRegressor(
            # Huber, not L1: both are robust to the heavy right tail that survives the asinh
            # transform, but LightGBM refuses `monotone_constraints` with `regression_l1`
            # ("Cannot use monotone_constraints in regression_l1 objective"). Given the choice,
            # the constraints matter more — without them the model is free to learn that more
            # added bytes means less time, which would make the explanation list indefensible
            # even where the point estimate happened to be good.
            objective="huber",
            n_estimators=400,
            learning_rate=0.05,
            num_leaves=31,
            min_child_samples=10,
            monotone_constraints=constraints,
            random_state=self.seed,
            verbose=-1,
        )
        booster.fit(X.iloc[fit_idx], asinh_transform(y[fit_idx], self.target_scale))
        self._booster = booster

        if len(cal_idx) > 0:
            cal_pred = self.predict(X.iloc[cal_idx])
            self._conformal = SplitConformal(nominal=self.nominal_coverage).fit(y[cal_idx], cal_pred)
        return self

    def predict(self, X: pd.DataFrame) -> np.ndarray:
        if self._booster is None:
            return np.full(len(X), self._fallback_median, dtype=float)
        Xe = encode_categoricals(feature_matrix(X, self.feature_names), self.schema)
        z = self._booster.predict(Xe)  # type: ignore[attr-defined]
        # The label can be ≤ 0 (a shared package costs nothing), so the inverse is not clipped at 0.
        return asinh_inverse(np.asarray(z, dtype=float), self.target_scale)

    def predict_interval(self, X: pd.DataFrame) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        point = self.predict(X)
        if self._conformal is None:
            # No interval rather than a made-up one: a NaN interval is visibly absent, a guessed
            # one is not.
            nan = np.full_like(point, np.nan)
            return point, nan, nan
        low, high = self._conformal.interval(point)
        return point, low, high


@dataclass
class FoldResult:
    split: str
    fold: int
    estimator: str
    metrics: RegressionMetrics
    intervals: IntervalMetrics | None


def evaluate(
    df: pd.DataFrame,
    split: Split,
    *,
    target: str | None = None,
    feature_names: list[str] | None = None,
    n_splits: int = 5,
    seed: int = 11,
    include_model: bool = True,
    noise_floor_ms: float = 1.3,
    schema: Schema | None = None,
) -> pd.DataFrame:
    """Cross-validated comparison of the model against every available baseline.

    Returns one row per (split, fold, estimator), so the caller can aggregate and run the paired
    tests doc 08 §8 requires rather than being handed a single averaged number.
    """
    s = schema or load_schema()
    target = target or s.primary_target
    names = feature_names or s.static_names
    frame = add_group_columns(df).reset_index(drop=True)

    if target not in frame.columns:
        raise KeyError(f"target {target!r} is not in the dataset")
    labelled = frame[frame[target].notna()].reset_index(drop=True)
    if len(labelled) < n_splits:
        raise ValueError(f"only {len(labelled)} labelled rows; need at least {n_splits}")

    y_all = labelled[target].to_numpy(dtype=float)
    rows: list[FoldResult] = []

    for fold, (train_idx, test_idx) in enumerate(iter_folds(labelled, split, n_splits=n_splits, seed=seed)):
        # Checked on every fold, not just in a test: a leaking split invalidates the whole table.
        assert_no_group_leakage(labelled, split, train_idx, test_idx)

        X_train, X_test = labelled.iloc[train_idx], labelled.iloc[test_idx]
        y_train, y_test = y_all[train_idx], y_all[test_idx]

        for baseline in available_baselines(labelled.columns):
            fitted: Baseline = baseline.fit(X_train, y_train)
            pred = fitted.predict(X_test)
            rows.append(
                FoldResult(
                    split=split.name,
                    fold=fold,
                    estimator=f"{baseline.name} {baseline.label}",
                    metrics=regression_metrics(y_test, pred, noise_floor_ms),
                    intervals=None,
                )
            )

        if include_model:
            model = DepLensModel(feature_names=names, seed=seed, schema=s).fit(X_train, y_train)
            point, low, high = model.predict_interval(X_test)
            iv = None if np.isnan(low).all() else interval_metrics(y_test, low, high, model.nominal_coverage)
            rows.append(
                FoldResult(
                    split=split.name,
                    fold=fold,
                    estimator="M1 deplens-lgbm",
                    metrics=regression_metrics(y_test, point, noise_floor_ms),
                    intervals=iv,
                )
            )

    out = pd.DataFrame(
        [
            {
                "split": r.split,
                "fold": r.fold,
                "estimator": r.estimator,
                **r.metrics.as_row(),
                **({f"interval_{k}": v for k, v in r.intervals.as_row().items()} if r.intervals else {}),
            }
            for r in rows
        ]
    )
    out.attrs["missing_baselines"] = missing_baselines(labelled.columns)
    out.attrs["seed"] = seed
    out.attrs["split_description"] = split.description
    return out


def summarise(results: pd.DataFrame) -> pd.DataFrame:
    """Mean metric per estimator, with the fold-to-fold spread kept visible."""
    numeric = [c for c in results.columns if c not in {"split", "fold", "estimator"}]
    agg = results.groupby(["split", "estimator"])[numeric].agg(["mean", "std"])
    agg.columns = [f"{a}_{b}" for a, b in agg.columns]
    return agg.reset_index().sort_values(["split", "mae_mean"])
