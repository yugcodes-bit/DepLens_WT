"""Loading the dataset, and refusing to invent one.

The dataset does not exist yet: it needs a measurement campaign on a quiet machine
(docs/research-log.md 2026-10-01 explains why the dev laptop cannot produce dataset cells). So this
module does two things:

1. ``load_dataset`` reads a real export and validates it against the feature schema, failing with a
   specific message when a column is missing or a label is absent.
2. ``synthetic_dataset`` generates a **clearly labelled** fake, for exercising the pipeline in tests
   and in CI. It is not a stand-in for data: ``is_synthetic`` is carried on the frame's attrs and
   ``assert_real`` refuses to let a synthetic frame reach a reporting script.

That separation is the point. Hard rule 4 and doc 10's honesty requirements mean a number in the
paper must be traceable to a measurement, and the easiest way to break that is to let a convenient
simulation leak into a results table.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd

from .schema import Schema, load_schema

#: Identifier columns a dataset carries alongside features and labels.
ID_COLUMNS = ("cell_id", "package_name", "package_version", "host_name", "profile_name", "import_spec")

#: Columns that must be present for any split or model to be meaningful.
REQUIRED_COLUMNS = ("package_name", "host_name", "profile_name")

SYNTHETIC_ATTR = "deplens_is_synthetic"


class NotRealDataError(RuntimeError):
    """Raised when synthetic data reaches something that must only see measurements."""


class DatasetValidationError(RuntimeError):
    pass


def load_dataset(path: str | Path, schema: Schema | None = None) -> pd.DataFrame:
    """Reads a Parquet or CSV export and validates it. Never fills a missing label."""
    p = Path(path)
    if not p.exists():
        raise FileNotFoundError(
            f"No dataset at {p}. The dataset is produced by a measurement campaign on the quiet "
            f"machine (docs/07 §8, docs/09 P4) and is not in the repository. For a pipeline smoke "
            f"test use `synthetic_dataset()`, which is explicitly marked as not real."
        )
    df = pd.read_parquet(p) if p.suffix in {".parquet", ".pq"} else pd.read_csv(p)
    validate_dataset(df, schema)
    df.attrs[SYNTHETIC_ATTR] = False
    return df


def validate_dataset(df: pd.DataFrame, schema: Schema | None = None) -> None:
    s = schema or load_schema()
    problems: list[str] = []

    for col in REQUIRED_COLUMNS:
        if col not in df.columns:
            problems.append(f"missing identifier column {col!r} — splits S2/S3/S4 need it")

    if s.primary_target not in df.columns:
        problems.append(f"missing the primary target {s.primary_target!r}")

    unknown = [c for c in df.columns if c not in set(s.names) | set(ID_COLUMNS) | {t.name for t in s.targets}]
    # Extra bookkeeping columns are allowed, but a column that *looks* like a feature and is not in
    # the schema is a bug: it means an extractor invented a name (CLAUDE.md).
    suspicious = [c for c in unknown if not c.startswith(("session_", "meta_", "run_", "measured_"))]
    if suspicious:
        problems.append(f"columns not declared in feature-schema.json: {sorted(suspicious)[:8]}")

    if s.primary_target in df.columns and df[s.primary_target].isna().all():
        problems.append(f"every {s.primary_target} value is null — there are no labels here")

    if problems:
        raise DatasetValidationError("Dataset is not usable:\n  " + "\n  ".join(problems))


def assert_real(df: pd.DataFrame) -> None:
    """Gate for anything that produces a reported number."""
    if df.attrs.get(SYNTHETIC_ATTR, False):
        raise NotRealDataError(
            "This frame is synthetic. It exists to exercise the pipeline, and its numbers must never "
            "appear in a results table, a model card or the paper (hard rule 4, doc 10)."
        )


def feature_matrix(df: pd.DataFrame, names: list[str]) -> pd.DataFrame:
    """Selects feature columns in a fixed order, adding missing ones as NaN.

    NaN rather than 0, so a model's imputer can tell "we did not measure this" from "this is zero" —
    and so a group that was never extracted cannot masquerade as a group of zeros.
    """
    out = pd.DataFrame(index=df.index)
    for n in names:
        out[n] = df[n] if n in df.columns else np.nan
    return out


def encode_categoricals(X: pd.DataFrame, schema: Schema | None = None) -> pd.DataFrame:
    """Maps category features onto their declared value lists as ordered integer codes.

    Encoding against the *schema's* list rather than the data's observed values means a category
    that never appears in training still has a stable code, so a model trained today can score a
    row containing it tomorrow without the columns shifting under it.
    """
    s = schema or load_schema()
    out = X.copy()
    for name in s.categorical_names:
        if name not in out.columns:
            continue
        values = s.by_name(name).values or ()
        lookup = {v: i for i, v in enumerate(values)}
        # An unseen value becomes -1 rather than NaN: it is a real, known-unknown category.
        # `lookup` is bound as a default argument, not captured: a closure over the loop variable
        # would make every column use the *last* category's mapping.
        out[name] = (
            out[name]
            .map(lambda v, _lookup=lookup: _lookup.get(v, -1) if isinstance(v, str) else -1)
            .astype("int64")
        )
    return out


def synthetic_dataset(
    n_packages: int = 40,
    n_hosts: int = 6,
    seed: int = 11,
    schema: Schema | None = None,
) -> pd.DataFrame:
    """A labelled fake for exercising the pipeline. **Not data.**

    The generator deliberately encodes the project's own hypothesis — that cost depends on how much
    code *runs at import*, not just on how many bytes arrive — so a pipeline that cannot recover it
    is broken. It is useful precisely because its answer is known in advance, and useless for
    anything else.
    """
    s = schema or load_schema()
    rng = np.random.default_rng(seed)

    frameworks = ["react", "vue", "svelte", "preact", "solid", "vanilla"]
    profiles = [("desktop", 1.0), ("mid-tier-mobile", 4.0), ("low-end-mobile", 10.0)]

    rows: list[dict[str, object]] = []
    for pi in range(n_packages):
        # Per-package traits, so rows about one package are correlated — which is exactly why a
        # random-row split leaks and S2 is the honest one.
        iso_bytes = float(rng.lognormal(mean=10.5, sigma=1.1))
        toplevel_share = float(rng.beta(1.5, 4.0))
        eager_calls = int(rng.poisson(3 * toplevel_share * 10))
        for hi in range(n_hosts):
            host = frameworks[hi % len(frameworks)]
            # Some hosts already ship this package: the context effect.
            shared = bool(rng.random() < 0.18)
            ctx_bytes = float(rng.uniform(100, 600)) if shared else iso_bytes * float(rng.uniform(0.85, 1.0))
            host_bytes = float(rng.uniform(1e4, 4.2e5))
            for profile_name, slowdown in profiles:
                # The generating truth: bytes contribute a little, code that runs contributes a lot.
                compile_ms = (ctx_bytes / 1024) * 0.045
                eval_ms = eager_calls * 0.9 * toplevel_share
                label = (compile_ms + eval_ms) * slowdown
                label += float(rng.normal(0, 0.4))  # harness noise

                row: dict[str, object] = {
                    "cell_id": f"synthetic-{pi}-{hi}-{profile_name}",
                    "package_name": f"synthpkg-{pi:03d}",
                    "package_version": "1.0.0",
                    "host_name": f"{host}-{hi}",
                    "profile_name": profile_name,
                    "import_spec": f"import x from 'synthpkg-{pi:03d}'",
                    s.primary_target: label,
                    "delta_tbt_ms": max(0.0, label - 50),
                }
                # Fill every schema feature so the frame is shaped like a real export.
                for f in s.features:
                    if f.name in row:
                        continue
                    row[f.name] = _synthetic_feature(
                        f,
                        rng,
                        iso_bytes,
                        ctx_bytes,
                        host_bytes,
                        host,
                        slowdown,
                        toplevel_share,
                        eager_calls,
                        shared,
                    )
                rows.append(row)

    df = pd.DataFrame(rows)
    df.attrs[SYNTHETIC_ATTR] = True
    return df


def _synthetic_feature(
    f, rng, iso_bytes, ctx_bytes, host_bytes, host, slowdown, toplevel_share, eager_calls, shared
):
    name = f.name
    if name == "iso_min_bytes":
        return iso_bytes
    if name == "iso_full_min_bytes":
        return iso_bytes / max(0.05, float(rng.uniform(0.1, 1.0)))
    if name == "iso_gz_bytes":
        return iso_bytes * 0.34
    if name == "iso_br_bytes":
        return iso_bytes * 0.3
    if name == "iso_treeshake_ratio":
        return float(rng.uniform(0.05, 1.0))
    if name == "ctx_delta_min_bytes":
        return ctx_bytes
    if name == "ctx_delta_gz_bytes":
        return ctx_bytes * 0.34
    if name == "ctx_delta_br_bytes":
        return ctx_bytes * 0.3
    if name == "ctx_shared_packages":
        return 1 if shared else 0
    if name == "ctx_shared_bytes_saved":
        return iso_bytes - ctx_bytes
    if name == "host_baseline_min_bytes":
        return host_bytes
    if name == "host_framework":
        return host
    if name == "profile_slowdown":
        return slowdown
    if name == "fn_bytes_share_toplevel":
        return toplevel_share
    if name == "toplevel_calls":
        return eager_calls
    if name == "toplevel_side_effect_score":
        return eager_calls
    if name == "iso_script_ms":
        # B4: the package measured on an empty host — right measurement, wrong context.
        return (iso_bytes / 1024) * 0.045 * slowdown + eager_calls * 0.9 * toplevel_share * slowdown

    if f.type == "boolean":
        return bool(rng.random() < 0.2)
    if f.type == "category":
        return str(rng.choice(list(f.values or ["other"])))
    if f.type == "integer":
        return int(rng.poisson(4))
    return float(rng.gamma(2.0, 2.0))
