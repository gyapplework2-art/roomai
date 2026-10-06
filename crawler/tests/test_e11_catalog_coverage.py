import asyncio
from copy import deepcopy

import pytest

from crawler.core.catalog_coverage import E11_P0_MINIMUM_VIABLE_COVERAGE_PLAN
from crawler.core.e11_catalog_coverage import (
    E11CatalogCoverageError,
    build_e11_p0_coverage_report,
    load_e11_p0_coverage_report,
)
from crawler.core.supabase_repository import RestResponse


def _variant(variant_id: str, **overrides):
    variant = {
        "id": variant_id,
        "vendor_sku": f"SKU-{variant_id}",
        "vendor_variant_id": None,
        "variant_name": "Ivory variant",
        "source_color": "Ivory",
        "normalized_color": "ivory",
        "source_material": "Wool",
        "normalized_material": "wool",
        "publication_status": "published",
        "is_active": True,
        "catalog_product_dimensions": {"width_cm": 200, "depth_cm": 90, "height_cm": 80},
        "catalog_current_offers": {
            "currency": "USD",
            "vendor_list_price": 100,
            "vendor_sale_price": None,
            "normalized_availability": "in_stock",
            "checked_at": "2026-10-01T00:00:00+00:00",
        },
        "catalog_product_images": [{"id": f"image-{variant_id}", "source_url": "https://example.com/item.jpg"}],
        "catalog_customer_prices": [{"currency": "USD", "roomai_selling_price": 100}],
    }
    variant.update(overrides)
    return variant


def _product(product_id: str, furniture_type: str = "sofa", variants=None, **overrides):
    row = {
        "id": product_id,
        "source_product_name": f"Product {product_id}",
        "publication_status": "published",
        "is_active": True,
        "needs_taxonomy_review": False,
        "catalog_furniture_types": {"code": furniture_type},
        "catalog_vendor_markets": {
            "is_active": True,
            "catalog_countries": {"country_code": "US", "default_currency": "USD", "is_supported": True},
        },
        "catalog_product_variants": variants if variants is not None else [_variant(f"{product_id}-v1")],
    }
    row.update(overrides)
    return row


def _row(report, furniture_type: str):
    return next(row for row in report.rows if row.furniture_type_code == furniture_type)


def test_report_contains_exact_p0_contract_order_and_empty_counts():
    report = build_e11_p0_coverage_report([])
    expected = tuple(target.furniture_type_code for target in E11_P0_MINIMUM_VIABLE_COVERAGE_PLAN.targets)

    assert tuple(row.furniture_type_code for row in report.rows) == expected
    assert len(report.rows) == 5
    for row in report.rows:
        assert row.market_code == "US"
        assert row.minimum_distinct_products == 3
        assert row.minimum_ready_variants == 4
        assert row.actual_distinct_product_count == 0
        assert row.actual_ready_variant_count == 0
        assert row.product_target_met is False
        assert row.ready_variant_target_met is False
        assert row.coverage_status == "empty"


def test_duplicate_product_and_variant_rows_do_not_inflate_counts():
    product = _product("product-1", variants=[_variant("variant-2"), _variant("variant-1"), _variant("variant-1")])
    duplicate = deepcopy(product)
    duplicate["catalog_product_variants"] = list(reversed(duplicate["catalog_product_variants"]))
    report = build_e11_p0_coverage_report([product, duplicate])
    sofa = _row(report, "sofa")

    assert sofa.actual_distinct_product_count == 1
    assert sofa.actual_ready_variant_count == 2


def test_conflicting_duplicate_variant_identity_fails_fast():
    with pytest.raises(E11CatalogCoverageError, match="E11_CATALOG_VARIANT_RECORD_CONFLICT"):
        build_e11_p0_coverage_report([
            _product("product-1", variants=[_variant("variant-1"), _variant("variant-1", normalized_color="blue")]),
        ])


def test_three_distinct_products_and_four_ready_variants_meet_both_thresholds():
    rows = [
        _product("product-1", variants=[_variant("variant-1a"), _variant("variant-1b")]),
        _product("product-2", variants=[_variant("variant-2a")]),
        _product("product-3", variants=[_variant("variant-3a")]),
    ]
    sofa = _row(build_e11_p0_coverage_report(rows), "sofa")

    assert sofa.actual_distinct_product_count == 3
    assert sofa.actual_ready_variant_count == 4
    assert sofa.product_target_met is True
    assert sofa.ready_variant_target_met is True
    assert sofa.coverage_status == "target_met"


def test_below_either_threshold_remains_under_target():
    product_short = build_e11_p0_coverage_report([
        _product("product-1", variants=[_variant("variant-1a"), _variant("variant-1b")]),
        _product("product-2", variants=[_variant("variant-2a"), _variant("variant-2b")]),
    ])
    sofa_short = _row(product_short, "sofa")
    assert sofa_short.product_target_met is False
    assert sofa_short.ready_variant_target_met is True
    assert sofa_short.coverage_status == "under_target"

    variants_short = build_e11_p0_coverage_report([
        _product("product-1", variants=[_variant("variant-1a")]),
        _product("product-2", variants=[_variant("variant-2a")]),
        _product("product-3", variants=[_variant("variant-3a")]),
    ])
    sofa_short = _row(variants_short, "sofa")
    assert sofa_short.product_target_met is True
    assert sofa_short.ready_variant_target_met is False
    assert sofa_short.coverage_status == "under_target"


def test_non_p0_types_and_other_markets_do_not_change_the_p0_report():
    baseline = build_e11_p0_coverage_report([_product("product-1")])
    expanded = build_e11_p0_coverage_report([
        _product("product-1"),
        _product("mirror-1", "mirror", [_variant("mirror-v1")]),
        _product("canadian-sofa", "sofa", [_variant("canada-v1")], catalog_vendor_markets={
            "is_active": True,
            "catalog_countries": {"country_code": "CA", "default_currency": "CAD", "is_supported": True},
        }),
    ])

    assert expanded == baseline


def test_active_staging_products_count_as_inventory_but_not_ready_variants():
    report = build_e11_p0_coverage_report([
        _product("product-1", publication_status="staging"),
        _product("product-2", publication_status="staging"),
        _product("product-3", publication_status="staging"),
    ])
    sofa = _row(report, "sofa")

    assert sofa.actual_distinct_product_count == 3
    assert sofa.actual_ready_variant_count == 0
    assert sofa.product_target_met is True
    assert sofa.ready_variant_target_met is False
    assert sofa.coverage_status == "under_target"


@pytest.mark.parametrize(
    "product_changes,variant_changes",
    [
        ({"publication_status": "staging"}, {}),
        ({"needs_taxonomy_review": True}, {}),
        ({"catalog_vendor_markets": {"is_active": False, "catalog_countries": {"country_code": "US", "is_supported": True}}}, {}),
        ({"catalog_vendor_markets": {"is_active": True, "catalog_countries": {"country_code": "US", "is_supported": False}}}, {}),
        ({}, {"publication_status": "staging"}),
        ({}, {"is_active": False}),
        ({}, {"catalog_customer_prices": []}),
        ({}, {"catalog_customer_prices": [{"currency": "CAD", "roomai_selling_price": 100}]}),
        ({}, {"catalog_current_offers": {"currency": "USD", "vendor_list_price": 100, "normalized_availability": "out_of_stock"}}),
        ({}, {"catalog_product_dimensions": {"width_cm": 200, "depth_cm": None, "height_cm": 80}}),
        ({}, {"catalog_product_images": []}),
    ],
)
def test_existing_quality_and_customer_publication_gates_are_required(product_changes, variant_changes):
    report = build_e11_p0_coverage_report([
        _product("product-1", variants=[_variant("variant-1", **variant_changes)], **product_changes),
    ])
    assert _row(report, "sofa").actual_ready_variant_count == 0


def test_conflicting_duplicate_product_identity_fails_fast():
    with pytest.raises(E11CatalogCoverageError, match="E11_CATALOG_PRODUCT_ID_CONFLICT"):
        build_e11_p0_coverage_report([
            _product("product-1", "sofa"),
            _product("product-1", "coffee_table"),
        ])


def test_report_order_and_output_are_deterministic():
    products = [
        _product("rug-1", "area_rug"),
        _product("coffee-1", "coffee_table"),
        _product("sectional-1", "sectional_sofa"),
        _product("chair-1", "accent_chair"),
        _product("sofa-1", "sofa"),
    ]
    first = build_e11_p0_coverage_report(products)
    second = build_e11_p0_coverage_report(list(reversed(products)))

    assert first == second
    assert first.as_dict() == second.as_dict()


class FakeTransport:
    def __init__(self, response):
        self.response = response
        self.calls = 0

    async def get_quality_rows(self):
        self.calls += 1
        return self.response


def test_loader_reads_once_and_fails_safely_on_failed_inventory_read():
    transport = FakeTransport(RestResponse(200, [_product("product-1")]))
    report = asyncio.run(load_e11_p0_coverage_report(transport))
    assert transport.calls == 1
    assert _row(report, "sofa").actual_distinct_product_count == 1

    failed_transport = FakeTransport(RestResponse(500, [], message="read failed"))
    with pytest.raises(E11CatalogCoverageError, match="e11_catalog_coverage_read_failed"):
        asyncio.run(load_e11_p0_coverage_report(failed_transport))
