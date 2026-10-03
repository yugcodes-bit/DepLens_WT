"""Metrics, the asinh transform, and conformal intervals (doc 08 §5, §6, §8).

Three decisions worth stating:

**asinh, not log.** The target is a *paired difference* in milliseconds, so it can be negative or
zero — a package the app already ships costs ≈0 ms, and noise makes some labels slightly negative.
``log1p`` cannot represent that. ``asinh`` is log-like for large values, linear near zero, and
defined for negatives, so it compresses the heavy tail without throwing away the rows that matter
most to the project's argument.

**Interval coverage is a reported metric, not an afterthought.** A prediction interval that claims
90% and delivers 55% is worse than no interval, because the verdict rules (FR-24) are built on it.

**"Within noise" is a real category.** The harness knows its own noise floor (MDE₉₅); a prediction
that lands inside it is correct in the only sense that matters, and `within_noise_rate` says how
often that happens.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np


def asinh_transform(y: np.ndarray, scale: float = 1.0) -> np.ndarray:
    """asinh(y / scale). Keeps sign, compresses the tail, defined at and below zero."""
    return np.arcsinh(np.asarray(y, dtype=float) / scale)


def asinh_inverse(z: np.ndarray, scale: float = 1.0) -> np.ndarray:
    return np.sinh(np.asarray(z, dtype=float)) * scale


@dataclass(frozen=True)
class RegressionMetrics:
    mae: float
    rmse: float
    medae: float
    #: Spearman rank correlation — the right metric for "did it get the *order* right?".
    spearman: float
    #: Share of predictions within the harness noise floor of the truth.
    within_noise_rate: float
    n: int

    def as_row(self) -> dict[str, float]:
        return {
            "mae": self.mae,
            "rmse": self.rmse,
            "medae": self.medae,
            "spearman": self.spearman,
            "within_noise_rate": self.within_noise_rate,
            "n": float(self.n),
        }


def regression_metrics(
    y_true: np.ndarray, y_pred: np.ndarray, noise_floor_ms: float = 1.3
) -> RegressionMetrics:
    """Point-prediction quality.

    ``noise_floor_ms`` defaults to the MDE₉₅ the harness actually achieved on a quiet machine
    (1.26 ms, docs/research-log.md 2026-10-01), rounded up. Being wrong by less than the
    instrument can resolve is not a meaningful error.
    """
    y_true = np.asarray(y_true, dtype=float)
    y_pred = np.asarray(y_pred, dtype=float)
    if y_true.shape != y_pred.shape:
        raise ValueError(f"shape mismatch: {y_true.shape} vs {y_pred.shape}")
    if y_true.size == 0:
        raise ValueError("no rows to score")

    err = y_pred - y_true
    return RegressionMetrics(
        mae=float(np.mean(np.abs(err))),
        rmse=float(np.sqrt(np.mean(err**2))),
        medae=float(np.median(np.abs(err))),
        spearman=_spearman(y_true, y_pred),
        within_noise_rate=float(np.mean(np.abs(err) <= noise_floor_ms)),
        n=int(y_true.size),
    )


def _spearman(a: np.ndarray, b: np.ndarray) -> float:
    """Spearman without a SciPy import, so metrics stay dependency-light.

    Returns NaN when either side is constant: a rank correlation is undefined there, and returning
    0.0 would read as "no relationship" rather than "not applicable".
    """
    if a.size < 2:
        return float("nan")
    ra, rb = _rankdata(a), _rankdata(b)
    sa, sb = ra.std(), rb.std()
    if sa == 0 or sb == 0:
        return float("nan")
    return float(np.mean((ra - ra.mean()) * (rb - rb.mean())) / (sa * sb))


def _rankdata(x: np.ndarray) -> np.ndarray:
    """Average ranks for ties, matching scipy.stats.rankdata's default."""
    order = np.argsort(x, kind="mergesort")
    ranks = np.empty(x.size, dtype=float)
    ranks[order] = np.arange(1, x.size + 1, dtype=float)
    # Average the ranks within each tie group.
    sorted_x = x[order]
    start = 0
    for i in range(1, x.size + 1):
        if i == x.size or sorted_x[i] != sorted_x[start]:
            if i - start > 1:
                ranks[order[start:i]] = ranks[order[start:i]].mean()
            start = i
    return ranks


@dataclass(frozen=True)
class IntervalMetrics:
    #: Share of truths inside the interval. Should be close to the nominal level.
    coverage: float
    #: Nominal level the interval claimed.
    nominal: float
    #: Mean interval width, in the target's units. Narrower is better *at the same coverage*.
    mean_width: float
    median_width: float
    n: int

    @property
    def coverage_gap(self) -> float:
        """Signed miss. Doc 08 §8 asks for coverage within ±5 percentage points."""
        return self.coverage - self.nominal

    def as_row(self) -> dict[str, float]:
        return {
            "coverage": self.coverage,
            "nominal": self.nominal,
            "coverage_gap": self.coverage_gap,
            "mean_width": self.mean_width,
            "median_width": self.median_width,
            "n": float(self.n),
        }


def interval_metrics(
    y_true: np.ndarray, low: np.ndarray, high: np.ndarray, nominal: float = 0.9
) -> IntervalMetrics:
    y_true = np.asarray(y_true, dtype=float)
    low = np.asarray(low, dtype=float)
    high = np.asarray(high, dtype=float)
    inside = (y_true >= low) & (y_true <= high)
    width = high - low
    return IntervalMetrics(
        coverage=float(np.mean(inside)),
        nominal=float(nominal),
        mean_width=float(np.mean(width)),
        median_width=float(np.median(width)),
        n=int(y_true.size),
    )


@dataclass
class SplitConformal:
    """Split-conformal prediction intervals (doc 08 §6).

    Chosen over quantile regression because its coverage guarantee is distribution-free and holds
    for *any* underlying model — including the placeholder — provided the calibration rows are
    exchangeable with the test rows. That proviso is exactly why the calibration set must be carved
    out with the same grouped split as the test set: calibrating on rows about packages that are in
    the test set would make the guarantee vacuous.
    """

    nominal: float = 0.9
    #: The (1-alpha) quantile of absolute calibration residuals.
    quantile_: float = float("nan")
    n_calibration_: int = 0

    def fit(self, y_calibration: np.ndarray, pred_calibration: np.ndarray) -> SplitConformal:
        y = np.asarray(y_calibration, dtype=float)
        p = np.asarray(pred_calibration, dtype=float)
        if y.size == 0:
            raise ValueError("Conformal calibration needs at least one row")
        residuals = np.abs(y - p)
        n = residuals.size
        # The finite-sample correction: the ceil((n+1)(1-alpha))/n quantile is what gives the
        # guarantee at small n. Without it, coverage is biased low exactly when data is scarce —
        # which is the situation this project starts in.
        level = min(1.0, np.ceil((n + 1) * self.nominal) / n)
        self.quantile_ = float(np.quantile(residuals, level, method="higher"))
        self.n_calibration_ = int(n)
        return self

    def interval(self, pred: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        if not np.isfinite(self.quantile_):
            raise RuntimeError("SplitConformal.fit must be called before interval()")
        p = np.asarray(pred, dtype=float)
        return p - self.quantile_, p + self.quantile_
