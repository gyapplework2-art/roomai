from copy import deepcopy
from dataclasses import replace

import pytest

from crawler.core.catalog_batch import MAX_BATCH_LIMIT
from crawler.core.catalog_coverage import E11_P0_MINIMUM_VIABLE_COVERAGE_PLAN
from crawler.core.e11_catalog_acquisition import E11P0AcquisitionPlan, build_e11_p0_acquisition_plan
from crawler.core.e11_catalog_coverage import E11P0CoverageReport, E11P0CoverageRow, build_e11_p0_coverage_report
from crawler.core.e11_catalog_targets import E11CrawlerTargetError, select_e11_p0_crawler_targets


def _empty_acquisition_plan():
    return build_e11_p0_acquisition_plan(build_e11_p0_coverage_report([]))


def _replace_rows(plan, changes):
    rows = tuple(
        replace(row, **changes.get(row.furniture_type_code, {}))
        for row in plan.rows
    )
    canonical_order = [target.furniture_type_code for target in E11_P0_MINIMUM_VIABLE_COVERAGE_PLAN.targets]
    rows_by_type = {row.furniture_type_code: row for row in rows}
    acquisition_order = tuple(sorted(
        canonical_order,
        key=lambda furniture_type: (not rows_by_type[furniture_type].acquisition_needed, canonical_order.index(furniture_type)),
    ))
    return E11P0AcquisitionPlan(rows=rows, acquisition_order=acquisition_order)


def _target(targets, furniture_type_code):
    return next(target for target in targets.targets if target.furniture_type_code == furniture_type_code)


def test_empty_e11_catalog_emits_all_five_targets_in_e11_order():
    plan = _empty_acquisition_plan()
    snapshot = deepcopy(plan)
    targets = select_e11_p0_crawler_targets(plan)
    expected = tuple(target.furniture_type_code for target in E11_P0_MINIMUM_VIABLE_COVERAGE_PLAN.targets)

    assert tuple(target.furniture_type_code for target in targets.targets) == expected
    assert len(targets.targets) == 5
    assert targets.dry_run is True
    assert targets.as_dict()["dry_run"] is True
    assert plan == snapshot
    assert all(target.discovery_candidate_limit == 4 for target in targets.targets)
    assert all(target.planned_batch_count == 1 for target in targets.targets)
    assert all(target.per_batch_candidate_limits == (4,) for target in targets.targets)


def test_fully_covered_e11_plan_emits_no_active_targets():
    source = _empty_acquisition_plan()
    completed = _replace_rows(source, {
        row.furniture_type_code: {
            "missing_distinct_products": 0,
            "missing_ready_variants": 0,
            "product_target_met": True,
            "ready_variant_target_met": True,
            "acquisition_needed": False,
            "acquisition_reason": "target_met",
        }
        for row in source.rows
    })
    assert select_e11_p0_crawler_targets(completed).targets == ()


def test_mixed_coverage_emits_only_incomplete_types_in_acquisition_order():
    source = _empty_acquisition_plan()
    mixed = _replace_rows(source, {
        "sofa": {
            "missing_distinct_products": 0,
            "missing_ready_variants": 0,
            "product_target_met": True,
            "ready_variant_target_met": True,
            "acquisition_needed": False,
            "acquisition_reason": "target_met",
        },
        "sectional_sofa": {
            "missing_distinct_products": 1,
            "missing_ready_variants": 0,
            "acquisition_reason": "products_missing",
        },
        "coffee_table": {
            "missing_distinct_products": 0,
            "missing_ready_variants": 2,
            "acquisition_reason": "ready_variants_missing",
        },
    })
    targets = select_e11_p0_crawler_targets(mixed)

    assert [target.furniture_type_code for target in targets.targets] == ["accent_chair", "area_rug", "coffee_table", "sectional_sofa"]
    assert all(target.acquisition_reason != "target_met" for target in targets.targets)


def test_product_only_ready_variant_only_and_combined_gaps_are_preserved():
    source = _empty_acquisition_plan()
    mixed = _replace_rows(source, {
        "sofa": {
            "missing_distinct_products": 1,
            "missing_ready_variants": 0,
            "acquisition_reason": "products_missing",
        },
        "sectional_sofa": {
            "missing_distinct_products": 0,
            "missing_ready_variants": 2,
            "acquisition_reason": "ready_variants_missing",
        },
        "accent_chair": {
            "missing_distinct_products": 1,
            "missing_ready_variants": 3,
            "acquisition_reason": "products_and_variants_missing",
        },
    })
    targets = select_e11_p0_crawler_targets(mixed)

    sofa = _target(targets, "sofa")
    sectional = _target(targets, "sectional_sofa")
    chair = _target(targets, "accent_chair")
    assert (sofa.missing_distinct_products, sofa.missing_ready_variants) == (1, 0)
    assert sofa.discovery_candidate_limit == 1
    assert sofa.planned_batch_count == 1 and sofa.per_batch_candidate_limits == (1,)
    assert (sectional.missing_distinct_products, sectional.missing_ready_variants) == (0, 2)
    assert sectional.discovery_candidate_limit == 2
    assert sectional.planned_batch_count == 1 and sectional.per_batch_candidate_limits == (2,)
    assert (chair.missing_distinct_products, chair.missing_ready_variants) == (1, 3)
    assert chair.discovery_candidate_limit == 3
    assert chair.planned_batch_count == 1 and chair.per_batch_candidate_limits == (3,)
    assert all("vendor" not in target.__dict__ and "source_url" not in target.__dict__ for target in targets.targets)


def test_discovery_limit_is_larger_gap_capped_by_existing_batch_maximum():
    source = _empty_acquisition_plan()
    gaps = {
        row.furniture_type_code: {
            "missing_distinct_products": 70,
            "missing_ready_variants": 90,
            "acquisition_reason": "products_and_variants_missing",
        }
        for row in source.rows
    }
    targets = select_e11_p0_crawler_targets(_replace_rows(source, gaps))

    assert MAX_BATCH_LIMIT == 50
    assert all(target.discovery_candidate_limit == MAX_BATCH_LIMIT for target in targets.targets)
    assert all(target.planned_batch_count == 1 for target in targets.targets)
    assert all(target.per_batch_candidate_limits == (MAX_BATCH_LIMIT,) for target in targets.targets)
    assert all(target.missing_distinct_products == 70 for target in targets.targets)
    assert all(target.missing_ready_variants == 90 for target in targets.targets)
    assert all(sum(target.per_batch_candidate_limits) == target.discovery_candidate_limit for target in targets.targets)
    assert all(sum(target.per_batch_candidate_limits) <= target.discovery_candidate_limit for target in targets.targets)


def test_non_p0_rows_do_not_create_targets_and_source_plan_is_immutable():
    source = _empty_acquisition_plan()
    non_p0 = E11P0CoverageRow(
        market_code="US", furniture_type_code="mirror",
        minimum_distinct_products=3, minimum_ready_variants=4,
        actual_distinct_product_count=0, actual_ready_variant_count=0,
        product_target_met=False, ready_variant_target_met=False, coverage_status="empty",
    )
    with_extra = E11P0AcquisitionPlan((*source.rows, non_p0), source.acquisition_order)
    snapshot = deepcopy(with_extra)
    targets = select_e11_p0_crawler_targets(with_extra)

    assert all(target.furniture_type_code != "mirror" for target in targets.targets)
    assert len(targets.targets) == 5
    assert with_extra == snapshot


@pytest.mark.parametrize("changes", [
    {"missing_distinct_products": -1},
    {"missing_ready_variants": -1},
    {"acquisition_needed": True, "missing_distinct_products": 0, "missing_ready_variants": 0},
])
def test_invalid_e11_3_gap_input_fails_fast(changes):
    source = _empty_acquisition_plan()
    broken = _replace_rows(source, {"sofa": changes})
    with pytest.raises(E11CrawlerTargetError):
        select_e11_p0_crawler_targets(broken)


def test_empty_plan_conversion_does_not_mutate_e11_3_input():
    source = _empty_acquisition_plan()
    snapshot = deepcopy(source)
    select_e11_p0_crawler_targets(source)
    assert source == snapshot


def test_invalid_or_duplicate_contract_rows_fail_fast():
    source = _empty_acquisition_plan()
    duplicate = E11P0AcquisitionPlan((*source.rows, source.rows[0]), source.acquisition_order)
    with pytest.raises(E11CrawlerTargetError, match="E11_CRAWLER_TARGET_DUPLICATE_P0_ROW"):
        select_e11_p0_crawler_targets(duplicate)

    invalid_order = E11P0AcquisitionPlan(source.rows, (*source.acquisition_order, "mirror"))
    with pytest.raises(E11CrawlerTargetError, match="E11_CRAWLER_TARGET_INVALID_ORDER"):
        select_e11_p0_crawler_targets(invalid_order)


def test_existing_candidate_batch_bound_is_not_exceeded():
    plan = select_e11_p0_crawler_targets(_empty_acquisition_plan())
    assert all(1 <= target.discovery_candidate_limit <= MAX_BATCH_LIMIT for target in plan.targets)