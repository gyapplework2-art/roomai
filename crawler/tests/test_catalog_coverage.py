import pytest

from crawler.core.catalog_coverage import (
    US_INITIAL_COVERAGE_PLAN,
    CoverageTarget,
    build_coverage_plan,
    build_coverage_report,
    coverage_target_key,
)
from crawler.core.taxonomy import CANONICAL_TYPES


def test_valid_target_and_different_markets_are_allowed():
    us = CoverageTarget("US", "sofa", 3, "critical")
    ca = CoverageTarget("CA", "sofa", 3, "critical")
    plan = build_coverage_plan([us, ca])
    assert coverage_target_key(us) == ("US", "sofa")
    assert len(plan.targets) == 2


@pytest.mark.parametrize("target", [
    ("", "sofa", 1, "normal"),
    ("US", "unknown", 1, "normal"),
    ("US", "sofa", 0, "normal"),
    ("US", "sofa", 1, "urgent"),
])
def test_invalid_target_configuration_is_rejected(target):
    with pytest.raises(ValueError):
        CoverageTarget(*target)


def test_duplicate_market_type_is_rejected_and_order_is_deterministic():
    with pytest.raises(ValueError):
        build_coverage_plan([CoverageTarget("US", "sofa", 1, "normal"), CoverageTarget("US", "sofa", 2, "high")])
    plan = build_coverage_plan([
        CoverageTarget("US", "sofa", 1, "normal"),
        CoverageTarget("US", "accent_chair", 1, "critical"),
        CoverageTarget("US", "bed_frame", 1, "critical"),
    ])
    assert [target.furniture_type_code for target in plan.targets] == ["accent_chair", "bed_frame", "sofa"]


def test_initial_us_plan_covers_every_canonical_type_once():
    assert len(US_INITIAL_COVERAGE_PLAN.targets) == len(CANONICAL_TYPES)
    assert {target.furniture_type_code for target in US_INITIAL_COVERAGE_PLAN.targets} == set(CANONICAL_TYPES)
    assert {target.market_code for target in US_INITIAL_COVERAGE_PLAN.targets} == {"US"}
    assert {target.priority for target in US_INITIAL_COVERAGE_PLAN.targets} == {"critical", "high", "normal"}


def test_coverage_report_handles_empty_partial_exact_surplus_unknown_and_summary():
    plan = build_coverage_plan([
        CoverageTarget("US", "sofa", 3, "critical"),
        CoverageTarget("CA", "mirror", 2, "normal"),
        CoverageTarget("US", "desk", 1, "high"),
        CoverageTarget("US", "area_rug", 1, "critical"),
    ])
    report = build_coverage_report(plan, {
        ("US", "sofa"): 1,
        ("CA", "mirror"): 2,
        ("US", "desk"): 4,
        ("unknown", "sofa"): 99,
    })
    by_key = {(row.market_code, row.furniture_type_code): row for row in report.rows}
    assert by_key[("US", "sofa")].status == "under_target"
    assert by_key[("US", "sofa")].deficit_count == 2
    assert by_key[("CA", "mirror")].status == "target_met"
    assert by_key[("US", "desk")].coverage_ratio == 1.0
    assert by_key[("US", "area_rug")].status == "empty"
    assert report.summary.targets_total == 4
    assert report.summary.targets_met == 2
    assert report.summary.targets_under == 1
    assert report.summary.targets_empty == 1
    assert report.summary.desired_products_total == 7
    assert report.summary.actual_products_total == 7
    assert report.summary.remaining_deficit_total == 3
