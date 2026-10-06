from copy import deepcopy

import pytest

from crawler.core.catalog_coverage import E11_P0_MINIMUM_VIABLE_COVERAGE_PLAN
from crawler.core.e11_catalog_acquisition import build_e11_p0_acquisition_plan
from crawler.core.e11_catalog_coverage import (
    E11CatalogCoverageError,
    E11P0CoverageReport,
    E11P0CoverageRow,
    build_e11_p0_coverage_report,
)


def _variant(variant_id: str, *, ready: bool = True):
    return {
        "id": variant_id,
        "vendor_sku": f"sku-{variant_id}",
        "variant_name": variant_id,
        "source_color": "Ivory",
        "normalized_color": "ivory",
        "source_material": "Wool",
        "normalized_material": "wool",
        "publication_status": "published" if ready else "staging",
        "is_active": True,
        "catalog_product_dimensions": {"width_cm": 200, "depth_cm": 90, "height_cm": 80},
        "catalog_current_offers": {
            "currency": "USD",
            "vendor_list_price": 100,
            "normalized_availability": "in_stock",
        },
        "catalog_product_images": [{"source_url": f"https://example.com/{variant_id}.jpg"}],
        "catalog_customer_prices": [{"currency": "USD", "roomai_selling_price": 100}],
    }


def _products(furniture_type: str, product_count: int, ready_variant_count: int):
    rows = []
    next_variant = 0
    for product_index in range(product_count):
        variant_count = 1
        if product_index == 0:
            variant_count += max(ready_variant_count - product_count, 0)
        variants = []
        for _ in range(variant_count):
            ready = next_variant < ready_variant_count
            variants.append(_variant(f"{furniture_type}-v{next_variant}", ready=ready))
            next_variant += 1
        rows.append({
            "id": f"{furniture_type}-p{product_index}",
            "source_product_name": f"{furniture_type} product {product_index}",
            "publication_status": "published",
            "is_active": True,
            "needs_taxonomy_review": False,
            "catalog_furniture_types": {"code": furniture_type},
            "catalog_vendor_markets": {
                "is_active": True,
                "catalog_countries": {"country_code": "US", "default_currency": "USD", "is_supported": True},
            },
            "catalog_product_variants": variants,
        })
    return rows


def _coverage(type_counts: dict[str, tuple[int, int]] | None = None):
    type_counts = type_counts or {}
    rows = [
        row
        for target in E11_P0_MINIMUM_VIABLE_COVERAGE_PLAN.targets
        for row in _products(
            target.furniture_type_code,
            *type_counts.get(target.furniture_type_code, (3, 4)),
        )
    ]
    return build_e11_p0_coverage_report(rows)


def _gap(report, furniture_type: str):
    return next(row for row in report.rows if row.furniture_type_code == furniture_type)


def test_empty_catalog_produces_five_complete_contract_gaps():
    plan = build_e11_p0_acquisition_plan(build_e11_p0_coverage_report([]))
    expected_types = tuple(target.furniture_type_code for target in E11_P0_MINIMUM_VIABLE_COVERAGE_PLAN.targets)

    assert tuple(row.furniture_type_code for row in plan.rows) == expected_types
    assert len(plan.rows) == 5
    for row in plan.rows:
        assert row.target_distinct_products == 3
        assert row.actual_distinct_products == 0
        assert row.missing_distinct_products == 3
        assert row.target_ready_variants == 4
        assert row.actual_ready_variants == 0
        assert row.missing_ready_variants == 4
        assert row.acquisition_needed is True
        assert row.acquisition_reason == "products_and_variants_missing"
        assert row.coverage_status == "empty"


def test_exact_thresholds_meet_both_targets():
    plan = build_e11_p0_acquisition_plan(_coverage())
    for row in plan.rows:
        assert row.actual_distinct_products == 3
        assert row.actual_ready_variants == 4
        assert row.missing_distinct_products == 0
        assert row.missing_ready_variants == 0
        assert row.product_target_met is True
        assert row.ready_variant_target_met is True
        assert row.acquisition_needed is False
        assert row.acquisition_reason == "target_met"
        assert row.coverage_status == "target_met"


def test_above_threshold_gaps_are_clamped_to_zero():
    row = _gap(build_e11_p0_acquisition_plan(_coverage({"sofa": (5, 7)})), "sofa")
    assert row.missing_distinct_products == 0
    assert row.missing_ready_variants == 0
    assert row.acquisition_needed is False


def test_product_only_gap_keeps_ready_variant_gap_independent():
    row = _gap(build_e11_p0_acquisition_plan(_coverage({"sofa": (2, 5)})), "sofa")
    assert row.missing_distinct_products == 1
    assert row.missing_ready_variants == 0
    assert row.acquisition_needed is True
    assert row.acquisition_reason == "products_missing"


def test_ready_variant_only_gap_keeps_product_gap_independent():
    row = _gap(build_e11_p0_acquisition_plan(_coverage({"sofa": (4, 3)})), "sofa")
    assert row.missing_distinct_products == 0
    assert row.missing_ready_variants == 1
    assert row.acquisition_needed is True
    assert row.acquisition_reason == "ready_variants_missing"


def test_both_gaps_are_reported_without_combining_counts():
    row = _gap(build_e11_p0_acquisition_plan(_coverage({"sofa": (2, 2)})), "sofa")
    assert row.missing_distinct_products == 1
    assert row.missing_ready_variants == 2
    assert row.acquisition_needed is True
    assert row.acquisition_reason == "products_and_variants_missing"


def test_p0_types_are_isolated_from_each_others_counts():
    report = _coverage({"sofa": (3, 4), "area_rug": (0, 0)})
    sofa = _gap(build_e11_p0_acquisition_plan(report), "sofa")
    rug = _gap(build_e11_p0_acquisition_plan(report), "area_rug")
    assert sofa.missing_distinct_products == 0
    assert sofa.missing_ready_variants == 0
    assert rug.missing_distinct_products == 3
    assert rug.missing_ready_variants == 4


def test_non_p0_report_rows_do_not_enter_or_change_plan():
    baseline = build_e11_p0_acquisition_plan(_coverage())
    non_p0 = E11P0CoverageRow(
        market_code="US", furniture_type_code="mirror",
        minimum_distinct_products=3, minimum_ready_variants=4,
        actual_distinct_product_count=999, actual_ready_variant_count=999,
        product_target_met=True, ready_variant_target_met=True, coverage_status="target_met",
    )
    expanded_source = E11P0CoverageReport((*_coverage().rows, non_p0))
    expanded = build_e11_p0_acquisition_plan(expanded_source)
    assert expanded == baseline
    assert len(expanded.rows) == 5


def test_planner_does_not_mutate_e11_2_report():
    source = _coverage({"sofa": (2, 2)})
    snapshot = deepcopy(source)
    build_e11_p0_acquisition_plan(source)
    assert source == snapshot


def test_acquisition_order_places_gaps_first_and_preserves_contract_order():
    report = _coverage({"sectional_sofa": (2, 3), "sofa": (3, 3)})
    plan = build_e11_p0_acquisition_plan(report)
    contract_order = [target.furniture_type_code for target in E11_P0_MINIMUM_VIABLE_COVERAGE_PLAN.targets]
    expected = ["sectional_sofa", "sofa"] + [
        furniture_type for furniture_type in contract_order if furniture_type not in {"sectional_sofa", "sofa"}
    ]

    assert plan.acquisition_order == tuple(expected)
    assert tuple(row.furniture_type_code for row in plan.rows) == tuple(contract_order)


def test_acquisition_order_is_deterministic_for_identical_reports():
    source = _coverage({"sofa": (2, 3), "coffee_table": (3, 3)})
    first = build_e11_p0_acquisition_plan(source)
    second = build_e11_p0_acquisition_plan(source)
    assert first == second
    assert first.as_dict() == second.as_dict()


def test_non_p0_rows_are_ignored_but_missing_or_duplicate_p0_rows_fail_fast():
    report = _coverage()
    with_missing = E11P0CoverageReport(tuple(row for row in report.rows if row.furniture_type_code != "sofa"))
    with_duplicate = E11P0CoverageReport((*report.rows, _gap(report, "sofa")))
    with pytest.raises(E11CatalogCoverageError, match="E11_P0_COVERAGE_ROW_MISSING"):
        build_e11_p0_acquisition_plan(with_missing)
    with pytest.raises(E11CatalogCoverageError, match="E11_P0_COVERAGE_ROW_DUPLICATE"):
        build_e11_p0_acquisition_plan(with_duplicate)
