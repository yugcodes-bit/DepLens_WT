"""Reading ``feature-schema.json`` — the Python half of the TS ↔ Python contract.

Doc 09's P3 exit criterion is that both language sides agree on the feature schema. Neither side
owns a copy of the feature list: both derive it from ``packages/feature-schema/feature-schema.json``
and compare against the committed ``contract.json`` snapshot. A schema edit applied on only one
side therefore fails a test rather than silently producing dataset columns that do not line up.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

#: Repository root, found by walking up from this file.
REPO_ROOT = Path(__file__).resolve().parents[2]
SCHEMA_PATH = REPO_ROOT / "packages" / "feature-schema" / "feature-schema.json"
CONTRACT_PATH = REPO_ROOT / "packages" / "feature-schema" / "contract.json"

#: Groups that come from a measurement session and so are absent from a static-only row.
MEASURED_GROUPS = ("G6",)

#: Feature groups in the order doc 08 §9's ablation adds them.
ABLATION_ORDER = ("G1", "G2", "G3", "G4", "G5", "G6")


@dataclass(frozen=True)
class Feature:
    name: str
    group: str
    type: str
    unit: str | None
    description: str
    values: tuple[str, ...] | None = None
    monotone: int | None = None


@dataclass(frozen=True)
class Target:
    name: str
    description: str
    primary: bool


@dataclass(frozen=True)
class Schema:
    version: int
    features: tuple[Feature, ...]
    targets: tuple[Target, ...]

    @property
    def names(self) -> list[str]:
        """Feature names, sorted — the dataset's canonical column order."""
        return sorted(f.name for f in self.features)

    def in_groups(self, groups: tuple[str, ...] | list[str]) -> list[str]:
        wanted = set(groups)
        return sorted(f.name for f in self.features if f.group in wanted)

    @property
    def static_names(self) -> list[str]:
        """Everything a static-only model may use: no measured (G6) features."""
        return sorted(f.name for f in self.features if f.group not in MEASURED_GROUPS)

    @property
    def categorical_names(self) -> list[str]:
        return sorted(f.name for f in self.features if f.type == "category")

    @property
    def primary_target(self) -> str:
        for t in self.targets:
            if t.primary:
                return t.name
        raise ValueError("feature-schema.json declares no primary target")

    def by_name(self, name: str) -> Feature:
        for f in self.features:
            if f.name == name:
                return f
        raise KeyError(f"{name} is not declared in feature-schema.json")

    def monotone_constraints(self, names: list[str]) -> list[int]:
        """LightGBM-style constraint vector for the given column order (doc 08 §5).

        Monotonicity is a prior we are willing to defend: more bytes cannot mean less time, and a
        slower device cannot make code faster. Features without a declared direction get 0.
        """
        lookup = {f.name: (f.monotone or 0) for f in self.features}
        return [lookup.get(n, 0) for n in names]


@lru_cache(maxsize=1)
def load_schema(path: Path | None = None) -> Schema:
    raw = json.loads((path or SCHEMA_PATH).read_text(encoding="utf-8"))
    features = tuple(
        Feature(
            name=f["name"],
            group=f["group"],
            type=f["type"],
            unit=f.get("unit"),
            description=f["description"],
            values=tuple(f["values"]) if f.get("values") else None,
            monotone=f.get("monotone"),
        )
        for f in raw["features"]
    )
    targets = tuple(
        Target(name=t["name"], description=t["description"], primary=bool(t.get("primary")))
        for t in raw["targets"]
    )
    return Schema(version=int(raw["schemaVersion"]), features=features, targets=targets)


def schema_digest(schema: Schema | None = None) -> str:
    """The digest the TypeScript side computes, reproduced here.

    Must match ``packages/feature-schema/contract.ts`` exactly, including JSON separators — the
    whole point is that two independent implementations agree.
    """
    s = schema or load_schema()
    triples = sorted(([f.name, f.group, f.type] for f in s.features), key=lambda t: t[0])
    # `separators` reproduces JSON.stringify's spacing, which uses no whitespace at all.
    payload = json.dumps(triples, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


@lru_cache(maxsize=1)
def load_contract(path: Path | None = None) -> dict:
    """The committed snapshot both sides assert against."""
    return json.loads((path or CONTRACT_PATH).read_text(encoding="utf-8"))
