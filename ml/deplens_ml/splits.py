"""Evaluation splits (doc 08 §7) — and the guard that stops the wrong one being used.

**Hard rule 3: split by package name.** A random row split leaks, badly: the same package appears
in many rows (several hosts, several profiles, several import specs), so a random split puts rows
about `lodash` in both train and test and the model scores well by recognising lodash rather than by
generalising. The headline number must come from a split where no *package* is in both sides
(hard rule 4 forbids reporting the random-row number as a headline at all).

Four splits, named as doc 08 §7 names them:

  S1  random row        — reported only as a leakage diagnostic, never as a headline
  S2  unseen package    — group by package name (the headline)
  S3  unseen host       — group by host app
  S4  unseen both       — package *and* host held out together, the hardest and most honest
"""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass

import numpy as np
import pandas as pd
from sklearn.model_selection import GroupKFold, KFold


class LeakySplitError(RuntimeError):
    """Raised when a random-row split is used where a grouped one is required."""


@dataclass(frozen=True)
class Split:
    name: str
    kind: str
    #: Column whose distinct values must not straddle the train/test boundary.
    group_column: str | None
    #: Whether a result from this split may be used as a headline number (hard rule 4).
    headline_eligible: bool
    description: str


S1_RANDOM = Split(
    name="S1",
    kind="random-row",
    group_column=None,
    headline_eligible=False,
    description="Random row split. Leaks package identity across the boundary; kept only to quantify how"
    " much that leakage inflates scores.",
)
S2_PACKAGE = Split(
    name="S2",
    kind="unseen-package",
    group_column="package_name",
    headline_eligible=True,
    description="No package appears in both train and test. The headline generalisation question:"
    " can it price a package it has never seen?",
)
S3_HOST = Split(
    name="S3",
    kind="unseen-host",
    group_column="host_name",
    headline_eligible=True,
    description="No host app appears in both sides. Asks whether the context effect was learnt or memorised.",
)
S4_BOTH = Split(
    name="S4",
    kind="unseen-package-and-host",
    group_column="package_and_host",
    headline_eligible=True,
    description="Package and host both unseen. The hardest split and the one closest to real use.",
)

ALL_SPLITS = (S1_RANDOM, S2_PACKAGE, S3_HOST, S4_BOTH)


def add_group_columns(df: pd.DataFrame) -> pd.DataFrame:
    """Adds the composite group key S4 needs, without mutating the caller's frame."""
    out = df.copy()
    if "package_name" in out.columns and "host_name" in out.columns:
        out["package_and_host"] = out["package_name"].astype(str) + "||" + out["host_name"].astype(str)
    return out


def iter_folds(
    df: pd.DataFrame,
    split: Split,
    n_splits: int = 5,
    seed: int = 11,
) -> Iterator[tuple[np.ndarray, np.ndarray]]:
    """Yields ``(train_idx, test_idx)`` positional index arrays for one split.

    The seed is an argument and is logged by the callers, because every random choice in this
    project has to be reproducible (CLAUDE.md).
    """
    if split.group_column is None:
        yield from KFold(n_splits=n_splits, shuffle=True, random_state=seed).split(df)
        return

    if split.group_column not in df.columns:
        raise KeyError(
            f"Split {split.name} groups by {split.group_column!r}, which the dataset does not have. "
            f"Columns: {sorted(df.columns)[:12]}…"
        )

    groups = df[split.group_column].astype(str).to_numpy()
    distinct = len(set(groups))
    if distinct < n_splits:
        raise ValueError(
            f"Split {split.name} needs at least {n_splits} distinct {split.group_column} values, "
            f"the dataset has {distinct}. Collect more before reporting a {split.name} number."
        )
    # GroupKFold is deterministic and needs no seed; it keeps whole groups on one side.
    yield from GroupKFold(n_splits=n_splits).split(df, groups=groups)


def assert_no_group_leakage(df: pd.DataFrame, split: Split, train_idx, test_idx) -> None:
    """Fails loudly if a group straddles the boundary. Called on every fold, not just in tests."""
    if split.group_column is None:
        return
    col = df[split.group_column].astype(str)
    shared = set(col.iloc[train_idx]) & set(col.iloc[test_idx])
    if shared:
        raise LeakySplitError(
            f"Split {split.name} leaked {len(shared)} {split.group_column} value(s) across the "
            f"train/test boundary, e.g. {sorted(shared)[:3]}"
        )


def assert_headline_eligible(split: Split) -> None:
    """Hard rule 4: a random-row result may never be presented as a headline number."""
    if not split.headline_eligible:
        raise LeakySplitError(
            f"Split {split.name} ({split.kind}) must not be reported as a headline number — it leaks "
            f"package identity. Use S2, S3 or S4. {split.description}"
        )
