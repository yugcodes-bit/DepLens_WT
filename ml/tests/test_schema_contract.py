"""The Python half of the TS ↔ Python schema contract (doc 09 P3 exit criterion).

``packages/features/test/schema.test.ts`` asserts the same things on the TypeScript side. Both read
``feature-schema.json``, both derive the contract independently, and both compare to the committed
``contract.json``. If someone edits the schema and regenerates the snapshot on only one side, one of
these two suites fails.
"""

from __future__ import annotations

import pytest

from deplens_ml.schema import ABLATION_ORDER, MEASURED_GROUPS, load_contract, load_schema, schema_digest


@pytest.fixture(scope="module")
def schema():
    return load_schema()


@pytest.fixture(scope="module")
def contract():
    return load_contract()


def test_schema_version_matches_contract(schema, contract):
    assert schema.version == contract["schemaVersion"]


def test_feature_count_matches_contract(schema, contract):
    assert len(schema.features) == contract["featureCount"]


def test_feature_names_match_contract_exactly(schema, contract):
    assert schema.names == contract["names"]


def test_digest_matches_the_typescript_digest(schema, contract):
    """The strongest check: a rename, retype or regrouping changes this even at a constant count."""
    assert schema_digest(schema) == contract["digest"]


def test_group_counts_match_contract(schema, contract):
    counts: dict[str, int] = {}
    for f in schema.features:
        counts[f.group] = counts.get(f.group, 0) + 1
    assert counts == contract["countsByGroup"]


def test_targets_match_contract(schema, contract):
    assert [t.name for t in schema.targets] == contract["targets"]


def test_exactly_one_primary_target(schema):
    assert sum(1 for t in schema.targets if t.primary) == 1
    assert schema.primary_target == "delta_script_ms"


def test_no_duplicate_feature_names(schema):
    assert len(set(schema.names)) == len(schema.names)


def test_every_category_feature_declares_its_values(schema):
    for f in schema.features:
        if f.type == "category":
            assert f.values, f"{f.name} must declare its allowed values"
            assert len(f.values) > 1


def test_static_names_exclude_measured_groups(schema):
    measured = {f.name for f in schema.features if f.group in MEASURED_GROUPS}
    assert measured, "the schema should declare some measured features"
    assert measured.isdisjoint(set(schema.static_names))
    assert len(schema.static_names) + len(measured) == len(schema.features)


def test_ablation_groups_all_exist(schema):
    present = {f.group for f in schema.features}
    for group in ABLATION_ORDER:
        assert group in present, f"doc 08 §9's ablation adds {group}, which the schema does not have"


def test_monotone_constraints_follow_the_requested_column_order(schema):
    names = ["iso_min_bytes", "fn_count", "profile_slowdown"]
    assert schema.monotone_constraints(names) == [1, 0, 1]


def test_monotone_constraints_are_zero_for_unknown_columns(schema):
    assert schema.monotone_constraints(["not_a_feature"]) == [0]


def test_bytes_features_are_declared_monotone(schema):
    """A model must not be free to learn that more added bytes means less time."""
    for name in ("iso_min_bytes", "ctx_delta_min_bytes", "pkg_unpacked_bytes"):
        assert schema.by_name(name).monotone == 1, f"{name} should be monotone increasing"


def test_by_name_raises_for_an_invented_feature(schema):
    with pytest.raises(KeyError):
        schema.by_name("totally_made_up")
