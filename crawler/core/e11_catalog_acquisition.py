"""Pure acquisition-gap planning derived from the E.11.2 P0 coverage report."""

from dataclasses import asdict, dataclass
from typing import Literal

from crawler.core.catalog_coverage import E11_P0_MINIMUM_VIABLE_COVERAGE_PLAN
from crawler.core.e11_catalog_coverage import (
    CoverageStatus,
    E11CatalogCoverageError,
    E11P0CoverageReport,
)

AcquisitionReason = Literal[
    "products_and_variants_missing",
    "products_missing",
    "ready_variants_missing",
    "target_met",
]


@dataclass(frozen=True)
class E11P0CoverageGap:
    market_code: str
    furniture_type_code: str
    target_distinct_products: int
    actual_distinct_products: int
    missing_distinct_products: int
    target_ready_variants: int
    actual_ready_variants: int
    missing_ready_variants: int
    product_target_met: bool
    ready_variant_target_met: bool
    coverage_status: CoverageStatus
    acquisition_needed: bool
    acquisition_reason: AcquisitionReason


@dataclass(frozen=True)
class E11P0AcquisitionPlan:
    """Canonical contract-ordered rows plus an acquisition-first type ordering."""

    rows: tuple[E11P0CoverageGap, ...]
    acquisition_order: tuple[str, ...]

    def as_dict(self) -> dict[str, object]:
        return {
            "rows": [asdict(row) for row in self.rows],
            "acquisition_order": list(self.acquisition_order),
        }


def build_e11_p0_acquisition_plan(
    coverage_report: E11P0CoverageReport,
) -> E11P0AcquisitionPlan:
    """Transform E.11.2 counts/flags into independent P0 acquisition gaps."""
    contract_targets = E11_P0_MINIMUM_VIABLE_COVERAGE_PLAN.targets
    p0_codes = {target.furniture_type_code for target in contract_targets}
    source_by_type = {}
    for source_row in coverage_report.rows:
        if source_row.furniture_type_code not in p0_codes:
            continue
        if source_row.furniture_type_code in source_by_type:
            raise E11CatalogCoverageError("E11_P0_COVERAGE_ROW_DUPLICATE")
        source_by_type[source_row.furniture_type_code] = source_row

    gaps: list[E11P0CoverageGap] = []
    for target in contract_targets:
        source = source_by_type.get(target.furniture_type_code)
        if source is None:
            raise E11CatalogCoverageError("E11_P0_COVERAGE_ROW_MISSING")
        if (
            source.minimum_distinct_products != target.minimum_distinct_products
            or source.minimum_ready_variants != target.minimum_ready_variants
        ):
            raise E11CatalogCoverageError("E11_P0_COVERAGE_TARGET_CONFLICT")

        missing_products = max(source.minimum_distinct_products - source.actual_distinct_product_count, 0)
        missing_variants = max(source.minimum_ready_variants - source.actual_ready_variant_count, 0)
        acquisition_needed = not (source.product_target_met and source.ready_variant_target_met)
        if missing_products and missing_variants:
            reason: AcquisitionReason = "products_and_variants_missing"
        elif missing_products:
            reason = "products_missing"
        elif missing_variants:
            reason = "ready_variants_missing"
        else:
            reason = "target_met"
        gaps.append(E11P0CoverageGap(
            market_code=source.market_code,
            furniture_type_code=source.furniture_type_code,
            target_distinct_products=source.minimum_distinct_products,
            actual_distinct_products=source.actual_distinct_product_count,
            missing_distinct_products=missing_products,
            target_ready_variants=source.minimum_ready_variants,
            actual_ready_variants=source.actual_ready_variant_count,
            missing_ready_variants=missing_variants,
            product_target_met=source.product_target_met,
            ready_variant_target_met=source.ready_variant_target_met,
            coverage_status=source.coverage_status,
            acquisition_needed=acquisition_needed,
            acquisition_reason=reason,
        ))

    ordered_for_acquisition = sorted(
        enumerate(gaps),
        key=lambda entry: (not entry[1].acquisition_needed, entry[0]),
    )
    return E11P0AcquisitionPlan(
        rows=tuple(gaps),
        acquisition_order=tuple(row.furniture_type_code for _, row in ordered_for_acquisition),
    )
