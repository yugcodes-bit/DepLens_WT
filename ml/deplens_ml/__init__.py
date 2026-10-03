"""DepLens ML pipeline (doc 08). Nothing here invents a number: see dataset.assert_real."""

from .baselines import available_baselines, make_baselines, missing_baselines
from .dataset import (
    DatasetValidationError,
    NotRealDataError,
    assert_real,
    encode_categoricals,
    feature_matrix,
    load_dataset,
    synthetic_dataset,
    validate_dataset,
)
from .metrics import SplitConformal, asinh_inverse, asinh_transform, interval_metrics, regression_metrics
from .model import DepLensModel, evaluate, summarise
from .schema import Feature, Schema, Target, load_contract, load_schema, schema_digest
from .splits import ALL_SPLITS, S1_RANDOM, S2_PACKAGE, S3_HOST, S4_BOTH, LeakySplitError, Split

__all__ = [
    "load_schema", "load_contract", "schema_digest", "Schema", "Feature", "Target",
    "load_dataset", "synthetic_dataset", "validate_dataset", "assert_real", "feature_matrix",
    "encode_categoricals", "DatasetValidationError", "NotRealDataError",
    "ALL_SPLITS", "S1_RANDOM", "S2_PACKAGE", "S3_HOST", "S4_BOTH", "Split", "LeakySplitError",
    "make_baselines", "available_baselines", "missing_baselines",
    "regression_metrics", "interval_metrics", "SplitConformal", "asinh_transform", "asinh_inverse",
    "DepLensModel", "evaluate", "summarise",
]
