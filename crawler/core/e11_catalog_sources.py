"""Deterministic, side-effect-free source planning for active E.11 targets."""

from dataclasses import asdict, dataclass
from typing import Literal
from urllib.parse import urlsplit

from crawler.core.catalog_expansion import is_catalog_expansion_source_supported
from crawler.core.e11_catalog_targets import (
    E11CrawlerAcquisitionTarget,
    E11CrawlerAcquisitionTargets,
    E11CrawlerTargetError,
)
from crawler.core.catalog_coverage import E11_P0_MINIMUM_VIABLE_COVERAGE_PLAN
from crawler.discovery.source_map import ApprovedDiscoverySource, approved_sources_for_target

SourceStatus = Literal["eligible_sources_available", "no_eligible_source"]


class E11SourcePlanningError(ValueError):
    """Raised when E.11 target data or approved-source scope is inconsistent."""


@dataclass(frozen=True)
class E11PlannedSource:
    market_code: str
    furniture_type_code: str
    vendor: str
    vendor_market_code: str
    source_category: str
    source_type: str
    source_url: str

    @classmethod
    def from_approved(cls, source: ApprovedDiscoverySource) -> "E11PlannedSource":
        return cls(
            market_code=source.market_code,
            furniture_type_code=source.furniture_type_code,
            vendor=source.vendor,
            vendor_market_code=source.vendor_market_code,
            source_category=source.source_category,
            source_type=source.source_type,
            source_url=source.source_url,
        )


@dataclass(frozen=True)
class E11SourcePlannedTarget:
    market_code: str
    furniture_type_code: str
    missing_distinct_products: int
    missing_ready_variants: int
    acquisition_reason: str
    discovery_candidate_limit: int
    planned_batch_count: int
    per_batch_candidate_limits: tuple[int, ...]
    source_status: SourceStatus
    eligible_sources: tuple[E11PlannedSource, ...]


@dataclass(frozen=True)
class E11SourceSelectionPlan:
    dry_run: Literal[True]
    targets: tuple[E11SourcePlannedTarget, ...]

    def as_dict(self) -> dict[str, object]:
        return {
            "dry_run": self.dry_run,
            "targets": [asdict(target) for target in self.targets],
        }


def _valid_configured_source_url(source: ApprovedDiscoverySource) -> bool:
    parsed = urlsplit(source.source_url)
    return parsed.scheme in {"http", "https"} and bool(parsed.netloc and parsed.path)


def _eligible_sources(target: E11CrawlerAcquisitionTarget) -> tuple[E11PlannedSource, ...]:
    eligible: list[E11PlannedSource] = []
    for source in approved_sources_for_target(target.market_code, target.furniture_type_code):
        if source.market_code != target.market_code or source.furniture_type_code != target.furniture_type_code:
            continue
        if source.vendor_market_code != target.market_code:
            continue
        if not is_catalog_expansion_source_supported(source) or not _valid_configured_source_url(source):
            continue
        eligible.append(E11PlannedSource.from_approved(source))
    return tuple(eligible)


def build_e11_source_selection_plan(
    acquisition_targets: E11CrawlerAcquisitionTargets,
) -> E11SourceSelectionPlan:
    """Attach existing approved and currently executable sources to E.11.4 targets."""
    p0_codes = {target.furniture_type_code for target in E11_P0_MINIMUM_VIABLE_COVERAGE_PLAN.targets}
    seen_types: set[str] = set()
    planned: list[E11SourcePlannedTarget] = []
    for target in acquisition_targets.targets:
        if target.furniture_type_code not in p0_codes:
            raise E11SourcePlanningError("E11_SOURCE_PLAN_NON_P0_TARGET")
        if target.furniture_type_code in seen_types:
            raise E11SourcePlanningError("E11_SOURCE_PLAN_DUPLICATE_TARGET")
        seen_types.add(target.furniture_type_code)
        if target.discovery_candidate_limit < 1 or target.planned_batch_count < 1:
            raise E11SourcePlanningError("E11_SOURCE_PLAN_INVALID_BATCH_PLAN")
        if len(target.per_batch_candidate_limits) != target.planned_batch_count:
            raise E11SourcePlanningError("E11_SOURCE_PLAN_BATCH_COUNT_MISMATCH")
        if sum(target.per_batch_candidate_limits) != target.discovery_candidate_limit:
            raise E11SourcePlanningError("E11_SOURCE_PLAN_BATCH_TOTAL_MISMATCH")

        sources = _eligible_sources(target)
        planned.append(E11SourcePlannedTarget(
            market_code=target.market_code,
            furniture_type_code=target.furniture_type_code,
            missing_distinct_products=target.missing_distinct_products,
            missing_ready_variants=target.missing_ready_variants,
            acquisition_reason=target.acquisition_reason,
            discovery_candidate_limit=target.discovery_candidate_limit,
            planned_batch_count=target.planned_batch_count,
            per_batch_candidate_limits=target.per_batch_candidate_limits,
            source_status="eligible_sources_available" if sources else "no_eligible_source",
            eligible_sources=sources,
        ))
    return E11SourceSelectionPlan(dry_run=True, targets=tuple(planned))