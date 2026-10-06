"""Pure source-coverage gate for active E.11.6 acquisition targets."""

from dataclasses import asdict, dataclass
from typing import Literal

from crawler.core.catalog_coverage import E11_P0_MINIMUM_VIABLE_COVERAGE_PLAN
from crawler.core.e11_catalog_sources import (
    E11PlannedSource,
    E11SourceSelectionPlan,
    SourceStatus,
)

SourceCoverageStatus = Literal["source_ready", "source_onboarding_required"]
OnboardingReason = Literal["no_eligible_approved_source"]


class E11SourceCoverageError(ValueError):
    """Raised when the supplied E.11.6 source plan is inconsistent."""


@dataclass(frozen=True)
class E11SourceCoverageTarget:
    market_code: str
    furniture_type_code: str
    missing_distinct_products: int
    missing_ready_variants: int
    acquisition_reason: str
    discovery_candidate_limit: int
    planned_batch_count: int
    per_batch_candidate_limits: tuple[int, ...]
    e11_source_status: SourceStatus
    eligible_sources: tuple[E11PlannedSource, ...]
    source_coverage_met: bool
    onboarding_required: bool
    source_coverage_status: SourceCoverageStatus
    onboarding_reason: OnboardingReason | None


@dataclass(frozen=True)
class E11SourceCoverageGateReport:
    targets: tuple[E11SourceCoverageTarget, ...]
    active_target_count: int
    source_ready_target_count: int
    source_blocked_target_count: int
    all_active_targets_source_ready: bool

    def as_dict(self) -> dict[str, object]:
        return {
            "targets": [asdict(target) for target in self.targets],
            "summary": {
                "active_target_count": self.active_target_count,
                "source_ready_target_count": self.source_ready_target_count,
                "source_blocked_target_count": self.source_blocked_target_count,
                "all_active_targets_source_ready": self.all_active_targets_source_ready,
            },
        }


def build_e11_source_coverage_gate(
    source_plan: E11SourceSelectionPlan,
) -> E11SourceCoverageGateReport:
    """Classify the E.11.6 source plan without recalculating source eligibility."""
    if source_plan.dry_run is not True:
        raise E11SourceCoverageError("E11_SOURCE_COVERAGE_REQUIRES_DRY_RUN_PLAN")

    p0_codes = {target.furniture_type_code for target in E11_P0_MINIMUM_VIABLE_COVERAGE_PLAN.targets}
    seen_types: set[str] = set()
    targets: list[E11SourceCoverageTarget] = []
    for source_target in source_plan.targets:
        if source_target.furniture_type_code not in p0_codes:
            raise E11SourceCoverageError("E11_SOURCE_COVERAGE_NON_P0_TARGET")
        if source_target.furniture_type_code in seen_types:
            raise E11SourceCoverageError("E11_SOURCE_COVERAGE_DUPLICATE_TARGET")
        seen_types.add(source_target.furniture_type_code)

        has_sources = len(source_target.eligible_sources) > 0
        expected_source_status: SourceStatus = "eligible_sources_available" if has_sources else "no_eligible_source"
        if source_target.source_status != expected_source_status:
            raise E11SourceCoverageError("E11_SOURCE_COVERAGE_STATUS_SOURCE_MISMATCH")
        if any(
            source.market_code != source_target.market_code
            or source.furniture_type_code != source_target.furniture_type_code
            for source in source_target.eligible_sources
        ):
            raise E11SourceCoverageError("E11_SOURCE_COVERAGE_SOURCE_SCOPE_MISMATCH")

        targets.append(E11SourceCoverageTarget(
            market_code=source_target.market_code,
            furniture_type_code=source_target.furniture_type_code,
            missing_distinct_products=source_target.missing_distinct_products,
            missing_ready_variants=source_target.missing_ready_variants,
            acquisition_reason=source_target.acquisition_reason,
            discovery_candidate_limit=source_target.discovery_candidate_limit,
            planned_batch_count=source_target.planned_batch_count,
            per_batch_candidate_limits=source_target.per_batch_candidate_limits,
            e11_source_status=source_target.source_status,
            eligible_sources=source_target.eligible_sources,
            source_coverage_met=has_sources,
            onboarding_required=not has_sources,
            source_coverage_status="source_ready" if has_sources else "source_onboarding_required",
            onboarding_reason=None if has_sources else "no_eligible_approved_source",
        ))

    ready_count = sum(target.source_coverage_met for target in targets)
    blocked_count = len(targets) - ready_count
    return E11SourceCoverageGateReport(
        targets=tuple(targets),
        active_target_count=len(targets),
        source_ready_target_count=ready_count,
        source_blocked_target_count=blocked_count,
        all_active_targets_source_ready=blocked_count == 0,
    )
