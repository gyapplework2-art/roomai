"""Desired catalog coverage targets and deterministic coverage reports."""

from dataclasses import dataclass
from typing import Literal

from crawler.core.taxonomy import CANONICAL_TYPES

CoveragePriority = Literal["critical", "high", "normal", "low"]
_PRIORITY_ORDER = {"critical": 0, "high": 1, "normal": 2, "low": 3}


@dataclass(frozen=True)
class CoverageTarget:
    market_code: str
    furniture_type_code: str
    target_product_count: int
    priority: CoveragePriority

    def __post_init__(self) -> None:
        if not self.market_code.strip():
            raise ValueError("market_code cannot be blank.")
        if self.furniture_type_code not in CANONICAL_TYPES:
            raise ValueError("furniture_type_code must be canonical.")
        if isinstance(self.target_product_count, bool) or not isinstance(self.target_product_count, int) or self.target_product_count < 1:
            raise ValueError("target_product_count must be at least 1.")
        if self.priority not in _PRIORITY_ORDER:
            raise ValueError("priority must be critical, high, normal, or low.")


@dataclass(frozen=True)
class CatalogCoveragePlan:
    targets: tuple[CoverageTarget, ...]

    def __post_init__(self) -> None:
        keys = [coverage_target_key(target) for target in self.targets]
        if len(keys) != len(set(keys)):
            raise ValueError("Coverage targets must be unique by market and furniture type.")


@dataclass(frozen=True)
class CoverageReportRow:
    market_code: str
    furniture_type_code: str
    target_product_count: int
    actual_product_count: int
    deficit_count: int
    coverage_ratio: float
    priority: CoveragePriority
    status: Literal["empty", "under_target", "target_met"]


@dataclass(frozen=True)
class CoverageSummary:
    targets_total: int
    targets_met: int
    targets_under: int
    targets_empty: int
    desired_products_total: int
    actual_products_total: int
    remaining_deficit_total: int


@dataclass(frozen=True)
class CatalogCoverageReport:
    rows: tuple[CoverageReportRow, ...]
    summary: CoverageSummary


def coverage_target_key(target: CoverageTarget) -> tuple[str, str]:
    return target.market_code, target.furniture_type_code


def _ordered_targets(targets: tuple[CoverageTarget, ...]) -> tuple[CoverageTarget, ...]:
    return tuple(sorted(
        targets,
        key=lambda target: (
            _PRIORITY_ORDER[target.priority],
            target.furniture_type_code,
            target.market_code,
        ),
    ))


def build_coverage_plan(targets: tuple[CoverageTarget, ...] | list[CoverageTarget]) -> CatalogCoveragePlan:
    return CatalogCoveragePlan(_ordered_targets(tuple(targets)))


def _targets_for_priority(priority: CoveragePriority, count: int, types: tuple[str, ...]) -> tuple[CoverageTarget, ...]:
    return tuple(CoverageTarget("US", furniture_type, count, priority) for furniture_type in types)


US_INITIAL_COVERAGE_PLAN = build_coverage_plan(
    _targets_for_priority("critical", 30, (
        "sofa", "sectional_sofa", "sofa_with_chaise", "accent_chair", "coffee_table",
        "dining_table", "dining_chair", "bed_frame", "desk", "office_chair", "area_rug",
    ))
    + _targets_for_priority("high", 20, (
        "loveseat", "lounge_chair", "swivel_chair", "side_end_table", "nightstand",
        "dresser", "floor_lamp", "table_lamp", "media_console",
    ))
    + _targets_for_priority("normal", 15, (
        "recliner", "console_table", "bar_counter_stool", "bench", "bookcase_shelving",
        "cabinet", "pendant_chandelier", "mirror",
    )),
)


def build_coverage_report(
    plan: CatalogCoveragePlan,
    inventory_counts: dict[tuple[str, str], int],
) -> CatalogCoverageReport:
    rows: list[CoverageReportRow] = []
    for target in plan.targets:
        actual = max(0, inventory_counts.get(coverage_target_key(target), 0))
        deficit = max(0, target.target_product_count - actual)
        ratio = min(actual / target.target_product_count, 1.0)
        status: Literal["empty", "under_target", "target_met"]
        if actual == 0:
            status = "empty"
        elif actual < target.target_product_count:
            status = "under_target"
        else:
            status = "target_met"
        rows.append(CoverageReportRow(
            market_code=target.market_code,
            furniture_type_code=target.furniture_type_code,
            target_product_count=target.target_product_count,
            actual_product_count=actual,
            deficit_count=deficit,
            coverage_ratio=ratio,
            priority=target.priority,
            status=status,
        ))

    summary = CoverageSummary(
        targets_total=len(rows),
        targets_met=sum(row.status == "target_met" for row in rows),
        targets_under=sum(row.status == "under_target" for row in rows),
        targets_empty=sum(row.status == "empty" for row in rows),
        desired_products_total=sum(row.target_product_count for row in rows),
        actual_products_total=sum(row.actual_product_count for row in rows),
        remaining_deficit_total=sum(row.deficit_count for row in rows),
    )
    return CatalogCoverageReport(tuple(rows), summary)
