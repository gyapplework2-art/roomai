import asyncio

import httpx
import pytest

from crawler.core.catalog_quality_audit import (
    CatalogQualityAuditError,
    HttpxCatalogQualityAuditTransport,
    audit_quality_rows,
    load_catalog_quality_audit,
)
from crawler.core.supabase_repository import RestResponse


def _row():
    return {
        "id": "product-1",
        "source_product_name": "Audit Sofa",
        "publication_status": "staging",
        "is_active": True,
        "needs_taxonomy_review": False,
        "catalog_furniture_types": {"code": "sofa"},
        "catalog_product_variants": [
            {
                "id": "variant-1",
                "vendor_sku": "SKU-1",
                "vendor_variant_id": None,
                "variant_name": "Ivory",
                "source_color": "Ivory",
                "normalized_color": "ivory",
                "source_material": "Wool",
                "normalized_material": "wool",
                "publication_status": "staging",
                "is_active": True,
                "catalog_product_dimensions": {
                    "width_cm": 200,
                    "depth_cm": 90,
                    "height_cm": 80,
                },
                "catalog_current_offers": {
                    "currency": "USD",
                    "vendor_list_price": 1000,
                    "vendor_sale_price": None,
                    "normalized_availability": "in_stock",
                    "checked_at": "2026-09-27T12:00:00+00:00",
                },
                "catalog_product_images": [
                    {
                        "id": "image-1",
                        "source_url": "https://example.com/sofa.jpg",
                    }
                ],
            }
        ],
    }


def test_complete_persisted_product_is_design_ready():
    report = audit_quality_rows([_row()])

    assert report.as_dict()["summary"] == {
        "products_total": 1,
        "variants_total": 1,
        "products_blocking_pass": 1,
        "products_commercially_complete": 1,
        "products_design_ready": 1,
    }


def test_missing_taxonomy_blocks_product():
    row = _row()
    row["catalog_furniture_types"] = None
    row["needs_taxonomy_review"] = True

    product = audit_quality_rows([row]).products[0]

    assert product.passes_blocking_gate is False
    assert "unresolved_furniture_type" in product.blocking_reasons
    assert "taxonomy_review_required" in product.blocking_reasons


def test_missing_offer_and_image_are_incomplete():
    row = _row()
    variant = row["catalog_product_variants"][0]
    variant["catalog_current_offers"] = None
    variant["catalog_product_images"] = []

    product = audit_quality_rows([row]).products[0]
    variant_result = product.variants[0]

    assert product.passes_blocking_gate is True
    assert product.commercially_complete is False
    assert "current_offer_missing" in variant_result.incomplete_reasons
    assert "product_image_missing" in variant_result.incomplete_reasons


def test_incomplete_dimensions_and_normalization_are_design_gaps():
    row = _row()
    variant = row["catalog_product_variants"][0]
    variant["catalog_product_dimensions"]["depth_cm"] = None
    variant["normalized_color"] = None
    variant["normalized_material"] = None

    product = audit_quality_rows([row]).products[0]
    variant_result = product.variants[0]

    assert product.passes_blocking_gate is True
    assert product.commercially_complete is True
    assert product.design_ready is False
    assert "complete_dimensions_missing" in variant_result.design_gaps
    assert "normalized_color_missing" in variant_result.design_gaps
    assert "normalized_material_missing" in variant_result.design_gaps


def test_missing_active_variant_blocks_product():
    row = _row()
    row["catalog_product_variants"][0]["is_active"] = False

    product = audit_quality_rows([row]).products[0]

    assert product.passes_blocking_gate is False
    assert "active_variant_missing" in product.blocking_reasons


def test_quality_gap_counts_are_aggregated():
    row = _row()
    variant = row["catalog_product_variants"][0]
    variant["catalog_product_images"] = []
    variant["catalog_product_dimensions"] = None

    report = audit_quality_rows([row]).as_dict()

    assert report["quality_gap_counts"]["incomplete"] == {
        "product_image_missing": 1
    }
    assert report["quality_gap_counts"]["design"] == {
        "complete_dimensions_missing": 1
    }


class FakeTransport:
    def __init__(self, response):
        self.response = response
        self.calls = 0

    async def get_quality_rows(self):
        self.calls += 1
        return self.response


def test_load_catalog_quality_audit_reads_once():
    transport = FakeTransport(RestResponse(200, [_row()]))

    report = asyncio.run(load_catalog_quality_audit(transport))

    assert transport.calls == 1
    assert len(report.products) == 1


def test_load_catalog_quality_audit_rejects_failed_read():
    transport = FakeTransport(
        RestResponse(500, [], message="quality read failed")
    )

    with pytest.raises(
        CatalogQualityAuditError,
        match="catalog_quality_read_failed",
    ):
        asyncio.run(load_catalog_quality_audit(transport))


def test_httpx_quality_transport_is_get_only(monkeypatch):
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["method"] = request.method
        captured["path"] = request.url.path
        captured["params"] = dict(request.url.params)
        return httpx.Response(200, json=[])

    mock_transport = httpx.MockTransport(handler)
    original_async_client = httpx.AsyncClient

    def fake_async_client(*args, **kwargs):
        kwargs["transport"] = mock_transport
        return original_async_client(*args, **kwargs)

    monkeypatch.setattr(httpx, "AsyncClient", fake_async_client)

    class FakeSettings:
        def require_supabase_credentials(self):
            return "https://example.supabase.co", "test-service-key"

    transport = HttpxCatalogQualityAuditTransport(settings=FakeSettings())
    response = asyncio.run(transport.get_quality_rows())

    assert response.status_code == 200
    assert captured["method"] == "GET"
    assert captured["path"] == "/rest/v1/catalog_products"
    assert captured["params"]["is_active"] == "eq.true"

    select = captured["params"]["select"]
    assert "catalog_product_variants" in select
    assert "catalog_vendor_markets" in select
    assert "catalog_countries" in select
    assert "default_currency" in select
    assert "catalog_product_dimensions" in select
    assert "catalog_current_offers" in select
    assert "catalog_customer_prices" in select
    assert "catalog_product_images" in select
