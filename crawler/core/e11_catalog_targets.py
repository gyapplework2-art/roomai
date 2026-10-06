"""Vendor-neutral, bounded crawler targets derived from the E.11.3 plan."""

from dataclasses import dataclass
from typing import Literal

from crawler.core.catalog_batch import MAX_BATCH_LIMIT
from crawler.core.catalog_coverage import E11_P0_MINIMUM_VIABLE_COVERAGE_PLAN
from crawler.core.e11_catalog_acquisition import (
    AcquisitionReason,
    E11P0AcquisitionPlan,
)


class E11CrawlerTargetError(ValueError):
    """Raised when an E.11.3 plan cannot be safely adapted to crawler targets."""


@dataclass(frozen=True)
class E11CrawlerAcquisitionTarget:
    market_code: str
    furniture_type_code: str
    missing_distinct_products: int
    missing_ready_variants: int
    acquisition_reason: AcquisitionReason
    discovery_candidate_limit: int
    planned_batch_count: int
    per_batch_candidate_limits: tuple[int, ...]


@dataclass(frozen=True)
class E11CrawlerAcquisitionTargets:
    targets: tuple[E11CrawlerAcquisitionTarget, ...]
    dry_run: Literal[True] = True

    def as_dict(self) -> dict[str, object]:
        return {"dry_run": self.dry_run, "targets": [target.__dict__ for target in self.targets]}


def _bounded_batch_limits(candidate_limit: int) -> tuple[int, ...]:
    if isinstance(candidate_limit, bool) or not isinstance(candidate_limit, int) or candidate_limit < 1:
        raise E11CrawlerTargetError("E11_CRAWLER_TARGET_INVALID_CANDIDATE_LIMIT")
    batch_limits: list[int] = []
    remaining = candidate_limit
    while remaining:
        batch_size = min(remaining, MAX_BATCH_LIMIT)
        batch_limits.append(batch_size)
        remaining -= batch_size
    return tuple(batch_limits)


def select_e11_p0_crawler_targets(
    acquisition_plan: E11P0AcquisitionPlan,
) -> E11CrawlerAcquisitionTargets:
    """Adapt E.11.3 gaps to bounded per-type candidate-search targets.

    Candidate search is not a readiness-yield estimate. Its requested count is
    the larger independent gap, capped at the existing batch maximum; actual
    readiness remains E.11.2's concern.
    """
    contract_codes = tuple(target.furniture_type_code for target in E11_P0_MINIMUM_VIABLE_COVERAGE_PLAN.targets)
    contract_code_set = set(contract_codes)
    rows_by_type = {}
    for row in acquisition_plan.rows:
        if row.furniture_type_code not in contract_code_set:
            continue
        if row.furniture_type_code in rows_by_type:
            raise E11CrawlerTargetError("E11_CRAWLER_TARGET_DUPLICATE_P0_ROW")
        rows_by_type[row.furniture_type_code] = row
    if set(rows_by_type) != contract_code_set:
        raise E11CrawlerTargetError("E11_CRAWLER_TARGET_INCOMPLETE_P0_PLAN")

    if len(acquisition_plan.acquisition_order) != len(set(acquisition_plan.acquisition_order)):
        raise E11CrawlerTargetError("E11_CRAWLER_TARGET_DUPLICATE_ORDER_ENTRY")
    if set(acquisition_plan.acquisition_order) != contract_code_set:
        raise E11CrawlerTargetError("E11_CRAWLER_TARGET_INVALID_ORDER")

    targets: list[E11CrawlerAcquisitionTarget] = []
    for furniture_type_code in acquisition_plan.acquisition_order:
        row = rows_by_type[furniture_type_code]
        if not row.acquisition_needed:
            continue
        gaps = (row.missing_distinct_products, row.missing_ready_variants)
        if any(isinstance(gap, bool) or not isinstance(gap, int) or gap < 0 for gap in gaps):
            raise E11CrawlerTargetError("E11_CRAWLER_TARGET_INVALID_GAP")
        requested_candidates = max(gaps)
        if requested_candidates < 1:
            raise E11CrawlerTargetError("E11_CRAWLER_TARGET_ACQUISITION_WITHOUT_GAP")
        discovery_candidate_limit = min(requested_candidates, MAX_BATCH_LIMIT)
        per_batch_candidate_limits = _bounded_batch_limits(discovery_candidate_limit)
        targets.append(E11CrawlerAcquisitionTarget(
            market_code=row.market_code,
            furniture_type_code=row.furniture_type_code,
            missing_distinct_products=row.missing_distinct_products,
            missing_ready_variants=row.missing_ready_variants,
            acquisition_reason=row.acquisition_reason,
            discovery_candidate_limit=discovery_candidate_limit,
            planned_batch_count=len(per_batch_candidate_limits),
            per_batch_candidate_limits=per_batch_candidate_limits,
        ))

    return E11CrawlerAcquisitionTargets(tuple(targets))
