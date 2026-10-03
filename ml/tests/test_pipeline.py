"""Splits, baselines, metrics, conformal intervals and the honesty guards.

These run on the synthetic generator, which exists to exercise the pipeline rather than to stand in
for data — ``test_synthetic_data_cannot_reach_a_report`` is the test that keeps that distinction
real.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from deplens_ml.baselines import available_baselines, make_baselines, missing_baselines
from deplens_ml.dataset import (
    DatasetValidationError,
    NotRealDataError,
    assert_real,
    encode_categoricals,
    feature_matrix,
    load_dataset,
    synthetic_dataset,
    validate_dataset,
)
from deplens_ml.metrics import (
    SplitConformal,
    asinh_inverse,
    asinh_transform,
    interval_metrics,
    regression_metrics,
)
from deplens_ml.model import evaluate, summarise
from deplens_ml.schema import load_schema
from deplens_ml.splits import (
    ALL_SPLITS,
    S1_RANDOM,
    S2_PACKAGE,
    S3_HOST,
    S4_BOTH,
    LeakySplitError,
    add_group_columns,
    assert_headline_eligible,
    assert_no_group_leakage,
    iter_folds,
)


@pytest.fixture(scope="module")
def df():
    return synthetic_dataset(n_packages=24, n_hosts=6, seed=11)


# --------------------------------------------------------------------------- dataset


def test_synthetic_dataset_is_shaped_like_a_real_export(df):
    s = load_schema()
    for name in s.names:
        assert name in df.columns, f"{name} missing from the synthetic frame"
    assert s.primary_target in df.columns
    assert len(df) == 24 * 6 * 3  # packages x hosts x profiles


def test_synthetic_dataset_passes_validation(df):
    validate_dataset(df)


def test_synthetic_data_cannot_reach_a_report(df):
    """The guard that stops a convenient simulation becoming a paper number (hard rule 4)."""
    with pytest.raises(NotRealDataError):
        assert_real(df)


def test_a_real_frame_passes_the_guard(df):
    real = df.copy()
    real.attrs["deplens_is_synthetic"] = False
    assert_real(real)  # does not raise


def test_missing_dataset_says_where_data_comes_from(tmp_path):
    with pytest.raises(FileNotFoundError, match="measurement campaign"):
        load_dataset(tmp_path / "nope.parquet")


def test_validation_rejects_a_frame_with_no_labels(df):
    broken = df.copy()
    broken["delta_script_ms"] = np.nan
    with pytest.raises(DatasetValidationError, match="no labels"):
        validate_dataset(broken)


def test_validation_rejects_an_undeclared_feature_column(df):
    broken = df.copy()
    broken["invented_feature"] = 1.0
    with pytest.raises(DatasetValidationError, match="not declared in feature-schema.json"):
        validate_dataset(broken)


def test_validation_rejects_a_frame_without_group_columns(df):
    broken = df.drop(columns=["package_name"])
    with pytest.raises(DatasetValidationError, match="package_name"):
        validate_dataset(broken)


def test_feature_matrix_uses_nan_not_zero_for_absent_features(df):
    X = feature_matrix(df, ["iso_min_bytes", "iso_script_ms", "definitely_absent"])
    assert list(X.columns) == ["iso_min_bytes", "iso_script_ms", "definitely_absent"]
    assert X["definitely_absent"].isna().all()


def test_categoricals_encode_against_the_schema_not_the_data(df):
    s = load_schema()
    X = encode_categoricals(feature_matrix(df, ["host_framework"]), s)
    values = s.by_name("host_framework").values
    assert X["host_framework"].between(0, len(values) - 1).all()
    # A value outside the declared list becomes -1, a known-unknown, rather than NaN.
    odd = pd.DataFrame({"host_framework": ["angular"]})
    assert encode_categoricals(odd, s)["host_framework"].iloc[0] == -1


# --------------------------------------------------------------------------- splits


def test_all_four_splits_are_declared():
    assert [s.name for s in ALL_SPLITS] == ["S1", "S2", "S3", "S4"]


def test_random_row_split_is_not_headline_eligible():
    """Hard rule 4: the leaky split exists as a diagnostic, not as a result."""
    with pytest.raises(LeakySplitError, match="must not be reported as a headline"):
        assert_headline_eligible(S1_RANDOM)


def test_grouped_splits_are_headline_eligible():
    for split in (S2_PACKAGE, S3_HOST, S4_BOTH):
        assert_headline_eligible(split)  # does not raise


@pytest.mark.parametrize("split", [S2_PACKAGE, S3_HOST, S4_BOTH])
def test_grouped_splits_do_not_leak(df, split):
    """Hard rule 3: no package (or host) may appear on both sides of the boundary."""
    frame = add_group_columns(df).reset_index(drop=True)
    folds = list(iter_folds(frame, split, n_splits=5, seed=11))
    assert len(folds) == 5
    for train_idx, test_idx in folds:
        assert_no_group_leakage(frame, split, train_idx, test_idx)


def test_random_split_does_leak_which_is_the_point(df):
    """Demonstrates why S1 is banned: the same package lands on both sides."""
    frame = add_group_columns(df).reset_index(drop=True)
    leaked = False
    for train_idx, test_idx in iter_folds(frame, S1_RANDOM, n_splits=5, seed=11):
        shared = set(frame["package_name"].iloc[train_idx]) & set(frame["package_name"].iloc[test_idx])
        leaked = leaked or bool(shared)
    assert leaked, "a random row split should leak package identity in this dataset"


def test_split_refuses_when_there_are_too_few_groups():
    tiny = synthetic_dataset(n_packages=3, n_hosts=2, seed=5)
    with pytest.raises(ValueError, match="at least 5 distinct"):
        list(iter_folds(add_group_columns(tiny), S2_PACKAGE, n_splits=5))


def test_split_refuses_when_the_group_column_is_absent(df):
    frame = df.drop(columns=["host_name"])
    with pytest.raises(KeyError, match="host_name"):
        list(iter_folds(frame, S3_HOST, n_splits=5))


def test_leakage_assertion_catches_a_hand_built_leak(df):
    frame = add_group_columns(df).reset_index(drop=True)
    with pytest.raises(LeakySplitError, match="leaked"):
        assert_no_group_leakage(frame, S2_PACKAGE, np.array([0, 1]), np.array([0, 2]))


# --------------------------------------------------------------------------- transform & metrics


def test_asinh_round_trips_including_negatives_and_zero():
    y = np.array([-12.5, -0.1, 0.0, 0.3, 42.0, 1500.0])
    assert np.allclose(asinh_inverse(asinh_transform(y)), y)


def test_asinh_compresses_the_tail_but_keeps_sign():
    assert asinh_transform(np.array([1000.0]))[0] < 10
    assert asinh_transform(np.array([-5.0]))[0] < 0


def test_regression_metrics_are_zero_for_a_perfect_prediction():
    y = np.array([1.0, 5.0, 20.0, 60.0])
    m = regression_metrics(y, y.copy())
    assert m.mae == 0 and m.rmse == 0 and m.medae == 0
    assert m.within_noise_rate == 1.0
    assert m.spearman == pytest.approx(1.0)


def test_within_noise_rate_uses_the_measured_noise_floor():
    y = np.array([10.0, 10.0, 10.0, 10.0])
    # Errors of 0.5 ms are below the 1.3 ms MDE95 the harness achieved, so they count as correct.
    near = regression_metrics(y, y + 0.5)
    assert near.within_noise_rate == 1.0
    far = regression_metrics(y, y + 5.0)
    assert far.within_noise_rate == 0.0


def test_spearman_is_nan_for_a_constant_prediction():
    """Not 0.0 — a rank correlation against a constant is undefined, not "no relationship"."""
    y = np.array([1.0, 2.0, 3.0, 4.0])
    assert np.isnan(regression_metrics(y, np.full_like(y, 7.0)).spearman)


def test_spearman_handles_ties():
    y = np.array([1.0, 1.0, 2.0, 3.0])
    assert regression_metrics(y, np.array([1.0, 1.0, 2.0, 3.0])).spearman == pytest.approx(1.0)


def test_metrics_reject_mismatched_shapes():
    with pytest.raises(ValueError, match="shape mismatch"):
        regression_metrics(np.array([1.0, 2.0]), np.array([1.0]))


def test_metrics_reject_an_empty_test_set():
    with pytest.raises(ValueError, match="no rows"):
        regression_metrics(np.array([]), np.array([]))


# --------------------------------------------------------------------------- conformal


def test_conformal_intervals_reach_their_nominal_coverage():
    rng = np.random.default_rng(3)
    truth = rng.normal(20, 6, 4000)
    pred = truth + rng.normal(0, 3, 4000)
    conformal = SplitConformal(nominal=0.9).fit(truth[:2000], pred[:2000])
    low, high = conformal.interval(pred[2000:])
    iv = interval_metrics(truth[2000:], low, high, 0.9)
    # Distribution-free guarantee: at this sample size coverage should be close to nominal.
    assert abs(iv.coverage_gap) < 0.03, f"coverage {iv.coverage:.3f}"


def test_conformal_widens_when_the_model_is_worse():
    rng = np.random.default_rng(4)
    truth = rng.normal(20, 6, 2000)
    tight = SplitConformal().fit(truth, truth + rng.normal(0, 1, 2000))
    loose = SplitConformal().fit(truth, truth + rng.normal(0, 8, 2000))
    assert loose.quantile_ > tight.quantile_ * 3


def test_conformal_applies_the_finite_sample_correction():
    """With few calibration rows the interval must be the max residual, not the 90th percentile."""
    conformal = SplitConformal(nominal=0.9).fit(np.zeros(5), np.array([0.0, 1.0, 2.0, 3.0, 10.0]))
    assert conformal.quantile_ == 10.0


def test_conformal_refuses_to_produce_an_interval_before_fitting():
    with pytest.raises(RuntimeError, match="fit must be called"):
        SplitConformal().interval(np.array([1.0]))


def test_conformal_refuses_an_empty_calibration_set():
    with pytest.raises(ValueError, match="at least one row"):
        SplitConformal().fit(np.array([]), np.array([]))


def test_interval_metrics_report_coverage_and_width():
    truth = np.array([1.0, 2.0, 3.0, 40.0])
    iv = interval_metrics(truth, truth - 1, truth + 1, 0.9)
    assert iv.coverage == 1.0
    assert iv.mean_width == pytest.approx(2.0)
    assert iv.coverage_gap == pytest.approx(0.1)


# --------------------------------------------------------------------------- baselines


def test_the_five_baselines_are_declared():
    assert [b.name for b in make_baselines()] == ["B0", "B1", "B2", "B3", "B4"]


def test_b4_is_unavailable_without_measured_features(df):
    static = df.drop(columns=["iso_script_ms"])
    names = [b.name for b in available_baselines(static.columns)]
    assert "B4" not in names
    # ...and its absence is reported with a reason rather than silently ignored (hard rule 5).
    missing = dict(missing_baselines(static.columns))
    assert "B4" in missing and "iso_script_ms" in missing["B4"]


def test_b4_is_available_when_measured_features_are_present(df):
    assert "B4" in [b.name for b in available_baselines(df.columns)]


def test_baselines_are_fitted_not_hand_tuned(df):
    """A baseline gets the best version of itself, or beating it proves nothing (hard rule 5)."""
    b3 = next(b for b in make_baselines() if b.name == "B3")
    y = df["delta_script_ms"].to_numpy(dtype=float)
    b3.fit(df, y)
    pred = b3.predict(df)
    # The byte baseline should correlate positively with the truth on data where bytes do matter.
    assert regression_metrics(y, pred).spearman > 0.3


def test_baseline_survives_nan_and_infinity(df):
    b = next(x for x in make_baselines() if x.name == "B3")
    y = df["delta_script_ms"].to_numpy(dtype=float)
    b.fit(df, y)
    odd = df.head(3).copy()
    odd["ctx_delta_min_bytes"] = [np.nan, np.inf, -np.inf]
    assert np.isfinite(b.predict(odd)).all()


def test_b0_predicts_the_training_median(df):
    b0 = next(b for b in make_baselines() if b.name == "B0")
    y = df["delta_script_ms"].to_numpy(dtype=float)
    b0.fit(df, y)
    assert b0.predict(df.head(5)) == pytest.approx(np.median(y))


def test_baseline_complains_about_a_missing_feature(df):
    b = next(x for x in make_baselines() if x.name == "B2")
    with pytest.raises(KeyError, match="iso_min_bytes"):
        b.fit(df.drop(columns=["iso_min_bytes"]), df["delta_script_ms"].to_numpy(dtype=float))


# --------------------------------------------------------------------------- end to end


def test_evaluate_produces_one_row_per_estimator_and_fold(df):
    res = evaluate(df, S2_PACKAGE, n_splits=5, seed=11, include_model=False)
    assert set(res["split"]) == {"S2"}
    assert sorted(res["fold"].unique()) == [0, 1, 2, 3, 4]
    # Five baselines are available because the synthetic frame includes iso_script_ms.
    assert res["estimator"].nunique() == 5
    assert len(res) == 25


def test_evaluate_refuses_a_target_that_is_not_there(df):
    with pytest.raises(KeyError, match="not in the dataset"):
        evaluate(df, S2_PACKAGE, target="no_such_target", include_model=False)


def test_summarise_ranks_estimators_by_error(df):
    res = evaluate(df, S2_PACKAGE, n_splits=5, seed=11, include_model=False)
    summary = summarise(res)
    assert list(summary.columns[:2]) == ["split", "estimator"]
    assert summary["mae_mean"].is_monotonic_increasing


def test_context_aware_bytes_beat_isolated_bytes_on_this_generator(df):
    """A sanity check on the pipeline, not a research finding.

    The synthetic generator makes some hosts already ship the package, so B3 (in-context Δbytes)
    has information B2 (isolated size) does not. If the harness cannot recover that, the evaluation
    code is wrong — on real data this comparison is an open question.
    """
    res = evaluate(df, S2_PACKAGE, n_splits=5, seed=11, include_model=False)
    by = res.groupby("estimator")["mae"].mean()
    b2 = by[[i for i in by.index if i.startswith("B2")][0]]
    b3 = by[[i for i in by.index if i.startswith("B3")][0]]
    assert b3 < b2
