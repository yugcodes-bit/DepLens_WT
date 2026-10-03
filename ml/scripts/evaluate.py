#!/usr/bin/env python
"""Produce the results table (doc 08 §7–§9, doc 11).

    uv run python scripts/evaluate.py --dataset ../.work/dataset/cells.parquet
    uv run python scripts/evaluate.py --synthetic        # pipeline smoke test, NOT results

Paper numbers come from this script, never from a notebook (CLAUDE.md). Two refusals are built in:

  * ``--synthetic`` output is written to ``reports/synthetic/`` and every row is stamped
    ``is_synthetic``, so it cannot be mistaken for a result.
  * S1 (random row) is evaluated but printed under a "diagnostic, not a result" heading, because
    hard rule 4 forbids reporting it as a headline.
"""

from __future__ import annotations

import argparse
import json
import platform
import sys
from datetime import UTC, datetime
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

# Baseline labels contain "Δ", and a Windows console defaults to cp1252, which cannot encode it.
# Reconfiguring is better than stripping the character: the table should read the same on every OS.
for stream in (sys.stdout, sys.stderr):
    if hasattr(stream, "reconfigure"):
        stream.reconfigure(encoding="utf-8")  # type: ignore[union-attr]

from deplens_ml.dataset import load_dataset, synthetic_dataset  # noqa: E402
from deplens_ml.model import evaluate, summarise  # noqa: E402
from deplens_ml.schema import load_schema  # noqa: E402
from deplens_ml.splits import ALL_SPLITS, S1_RANDOM  # noqa: E402

REPORTS = Path(__file__).resolve().parents[1] / "reports"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dataset", type=Path, help="Parquet or CSV export from a measurement campaign")
    ap.add_argument("--synthetic", action="store_true", help="use the synthetic generator (not data)")
    ap.add_argument("--folds", type=int, default=5)
    ap.add_argument("--seed", type=int, default=11, help="logged with the results (CLAUDE.md)")
    ap.add_argument("--no-model", action="store_true", help="baselines only; skips the LightGBM dependency")
    ap.add_argument(
        "--noise-floor-ms", type=float, default=1.3, help="harness MDE95; see docs/research-log.md"
    )
    args = ap.parse_args()

    if not args.dataset and not args.synthetic:
        ap.error("pass --dataset <path> or --synthetic")

    if args.synthetic:
        df = synthetic_dataset(seed=args.seed)
        out_dir = REPORTS / "synthetic"
        print("=" * 78)
        print("SYNTHETIC RUN — this exercises the pipeline. These numbers are NOT results and must")
        print("not appear in the paper, a model card or a slide (hard rule 4, doc 10).")
        print("=" * 78)
    else:
        df = load_dataset(args.dataset)
        out_dir = REPORTS / "measured"

    schema = load_schema()
    out_dir.mkdir(parents=True, exist_ok=True)

    print(f"\n{len(df)} rows · {df['package_name'].nunique()} packages · {df['host_name'].nunique()} hosts")
    print(f"target: {schema.primary_target} · feature schema v{schema.version} · seed {args.seed}\n")

    frames: list[pd.DataFrame] = []
    for split in ALL_SPLITS:
        try:
            res = evaluate(
                df,
                split,
                n_splits=args.folds,
                seed=args.seed,
                include_model=not args.no_model,
                noise_floor_ms=args.noise_floor_ms,
                schema=schema,
            )
        except (ValueError, KeyError) as e:
            print(f"{split.name} ({split.kind}): skipped — {e}\n")
            continue
        frames.append(res)

        heading = f"{split.name} — {split.kind}"
        if split is S1_RANDOM:
            heading += "   [DIAGNOSTIC ONLY, NOT A RESULT — hard rule 4]"
        print(heading)
        print(f"  {split.description}")
        summary = summarise(res)
        cols = ["estimator", "mae_mean", "mae_std", "medae_mean", "spearman_mean", "within_noise_rate_mean"]
        present = [c for c in cols if c in summary.columns]
        print(summary[present].to_string(index=False, float_format=lambda v: f"{v:.3f}"))
        for name, reason in res.attrs.get("missing_baselines", []):
            print(f"  baseline {name} unavailable: {reason}")
        if "interval_coverage" in res.columns:
            cov = res["interval_coverage"].dropna()
            if len(cov):
                nominal = res["interval_nominal"].dropna().mean()
                print(f"  interval coverage {cov.mean():.3f} (nominal {nominal:.2f})")
        print()

    if not frames:
        print("Nothing was evaluated. Collect more cells, or use --synthetic to exercise the pipeline.")
        return 1

    all_results = pd.concat(frames, ignore_index=True)
    all_results["is_synthetic"] = bool(args.synthetic)
    stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    csv_path = out_dir / f"results-{stamp}.csv"
    all_results.to_csv(csv_path, index=False)

    meta = {
        "generated_at": datetime.now(UTC).isoformat(),
        "is_synthetic": bool(args.synthetic),
        "dataset": str(args.dataset) if args.dataset else "synthetic generator",
        "rows": int(len(df)),
        "packages": int(df["package_name"].nunique()),
        "hosts": int(df["host_name"].nunique()),
        "schema_version": schema.version,
        "target": schema.primary_target,
        "seed": args.seed,
        "folds": args.folds,
        "noise_floor_ms": args.noise_floor_ms,
        "python": platform.python_version(),
        "platform": platform.platform(),
    }
    (out_dir / f"results-{stamp}.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")

    print(f"wrote {csv_path}")
    print(f"wrote {out_dir / f'results-{stamp}.json'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
