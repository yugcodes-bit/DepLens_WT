"""Baselines B0–B4 (doc 08 §4).

Hard rule 5 — *keep baselines honest* — is the reason this module exists before any model does.
The claim DepLens wants to make is "a context-aware model beats what you can already get for
free", and that claim is only worth anything if the free things are implemented properly and
reported alongside:

  B0  global median         — the zero-information floor
  B1  isolated bytes        — Bundlephobia-style: the whole package's size
  B2  tree-shaken bytes     — bundlejs-style: this exact import's size in isolation
  B3  in-context Δbytes     — the strongest size baseline, and the one a bundler can give you
  B4  isolated measured     — measure the package on an empty host and reuse that number

B1–B3 are fitted, not hand-tuned: each is a one-feature regression, so it gets the best possible
version of itself. Beating a deliberately weak baseline proves nothing.

B4 is the interesting one. It is not a size heuristic at all — it is a real measurement, just of
the wrong thing (the package alone rather than the package in *your* app). If the model cannot beat
B4, the context-aware framing adds nothing and the paper has to say so.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd
from sklearn.isotonic import IsotonicRegression


@dataclass
class Baseline:
    """A fitted baseline. Every one is a function of a single feature, or of nothing at all."""

    name: str
    label: str
    feature: str | None
    description: str
    #: Fitted state.
    _constant: float = field(default=0.0, repr=False)
    _model: IsotonicRegression | None = field(default=None, repr=False)

    def fit(self, X: pd.DataFrame, y: np.ndarray) -> Baseline:
        if self.feature is None:
            self._constant = float(np.median(y))
            return self
        if self.feature not in X.columns:
            raise KeyError(
                f"Baseline {self.name} needs feature {self.feature!r}, which is not in the dataset"
            )
        x = _clean(X[self.feature].to_numpy(dtype=float))
        # Isotonic rather than linear: the relationship between bytes and milliseconds is monotone
        # but certainly not straight, and forcing a line would understate the baseline's strength.
        # `clip` keeps predictions inside the range seen in training rather than extrapolating.
        self._model = IsotonicRegression(increasing=True, out_of_bounds="clip").fit(x, y)
        self._constant = float(np.median(y))
        return self

    def predict(self, X: pd.DataFrame) -> np.ndarray:
        if self.feature is None or self._model is None:
            return np.full(len(X), self._constant, dtype=float)
        x = _clean(X[self.feature].to_numpy(dtype=float))
        return np.asarray(self._model.predict(x), dtype=float)


def _clean(x: np.ndarray) -> np.ndarray:
    """NaN/inf → 0. A baseline must never crash on a row the model would simply impute."""
    return np.nan_to_num(x, nan=0.0, posinf=0.0, neginf=0.0)


def make_baselines() -> list[Baseline]:
    """The five baselines, in the order doc 08 §4 lists them."""
    return [
        Baseline(
            name="B0",
            label="global median",
            feature=None,
            description="Predict the training median for everything. The floor any model must clear.",
        ),
        Baseline(
            name="B1",
            label="isolated full size",
            feature="iso_full_min_bytes",
            description="Bundlephobia-style: the size of the whole package, ignoring which import you wrote.",
        ),
        Baseline(
            name="B2",
            label="tree-shaken size",
            feature="iso_min_bytes",
            description="bundlejs-style: the size of this exact import in isolation, ignoring your app.",
        ),
        Baseline(
            name="B3",
            label="in-context Δbytes",
            feature="ctx_delta_min_bytes",
            description="The exact bytes this import adds to *your* app. The strongest size baseline, and"
            " what a bundler can already tell you.",
        ),
        Baseline(
            name="B4",
            label="isolated measured cost",
            feature="iso_script_ms",
            description="A real measurement of the package on an empty host, reused for every app."
            " Not a size heuristic — the honest competitor to the whole context-aware idea.",
        ),
    ]


def available_baselines(columns) -> list[Baseline]:
    """Baselines whose single feature the dataset actually has.

    B4 needs ``iso_script_ms``, a measured (G6) feature, so it is unavailable for a static-only
    dataset. It is dropped with that stated, rather than silently replaced by something weaker.
    """
    have = set(columns)
    return [b for b in make_baselines() if b.feature is None or b.feature in have]


def missing_baselines(columns) -> list[tuple[str, str]]:
    """``(name, reason)`` for each baseline the dataset cannot support — reported, never hidden."""
    have = set(columns)
    return [
        (b.name, f"needs {b.feature}, which is not in the dataset")
        for b in make_baselines()
        if b.feature is not None and b.feature not in have
    ]
