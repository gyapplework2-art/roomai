import asyncio

import pytest

from crawler.core.catalog_inventory import (
    CatalogInventoryError,
    build_inventory_counts,
)


def test_build_inventory_counts_aggregates_vendors_by_country_and_type():
    rows = [
        {
            "is_active": True,
            "catalog_vendor_markets": {
                "catalog_countries": {"country_code": "US"},
            },
            "catalog_furniture_types": {"code": "sofa"},
        },
        {
            "is_active": True,
            "catalog_vendor_markets": {
                "catalog_countries": {"country_code": "US"},
            },
            "catalog_furniture_types": {"code": "sofa"},
        },
        {
            "is_active": True,
            "catalog_vendor_markets": {
                "catalog_countries": {"country_code": "US"},
            },
            "catalog_furniture_types": {"code": "sectional_sofa"},
        },
    ]

    assert build_inventory_counts(rows) == {
        ("US", "sofa"): 2,
        ("US", "sectional_sofa"): 1,
    }


def test_build_inventory_counts_counts_staging_products():
    rows = [
        {
            "is_active": True,
            "publication_status": "staging",
            "catalog_vendor_markets": {
                "catalog_countries": {"country_code": "US"},
            },
            "catalog_furniture_types": {"code": "sofa"},
        },
    ]

    assert build_inventory_counts(rows) == {("US", "sofa"): 1}


def test_build_inventory_counts_ignores_inactive_products():
    rows = [
        {
            "is_active": False,
            "catalog_vendor_markets": {
                "catalog_countries": {"country_code": "US"},
            },
            "catalog_furniture_types": {"code": "sofa"},
        },
    ]

    assert build_inventory_counts(rows) == {}


@pytest.mark.parametrize(
    "row",
    [
        {
            "is_active": True,
            "catalog_vendor_markets": None,
            "catalog_furniture_types": {"code": "sofa"},
        },
        {
            "is_active": True,
            "catalog_vendor_markets": {
                "catalog_countries": None,
            },
            "catalog_furniture_types": {"code": "sofa"},
        },
        {
            "is_active": True,
            "catalog_vendor_markets": {
                "catalog_countries": {"country_code": "US"},
            },
            "catalog_furniture_types": None,
        },
    ],
)
def test_build_inventory_counts_rejects_missing_required_relationships(row):
    with pytest.raises(CatalogInventoryError):
        build_inventory_counts([row])


class FakeInventoryTransport:
    def __init__(self, response):
        self.response = response
        self.calls = 0

    async def get_inventory_products(self):
        self.calls += 1
        return self.response


def test_load_inventory_counts_reads_and_aggregates_products():
    from crawler.core.supabase_repository import RestResponse
    from crawler.core.catalog_inventory import load_inventory_counts

    transport = FakeInventoryTransport(
        RestResponse(
            200,
            [
                {
                    "is_active": True,
                    "publication_status": "staging",
                    "catalog_vendor_markets": {
                        "catalog_countries": {"country_code": "US"},
                    },
                    "catalog_furniture_types": {"code": "sofa"},
                },
                {
                    "is_active": True,
                    "publication_status": "published",
                    "catalog_vendor_markets": {
                        "catalog_countries": {"country_code": "US"},
                    },
                    "catalog_furniture_types": {"code": "sectional_sofa"},
                },
            ],
        )
    )

    counts = asyncio.run(load_inventory_counts(transport))

    assert transport.calls == 1
    assert counts == {
        ("US", "sofa"): 1,
        ("US", "sectional_sofa"): 1,
    }


def test_load_inventory_counts_rejects_failed_read():
    from crawler.core.supabase_repository import RestResponse
    from crawler.core.catalog_inventory import load_inventory_counts

    transport = FakeInventoryTransport(
        RestResponse(
            500,
            [],
            message="inventory read failed",
        )
    )

    with pytest.raises(CatalogInventoryError, match="inventory_read_failed"):
        asyncio.run(load_inventory_counts(transport))


def test_httpx_inventory_transport_reads_active_products(monkeypatch):
    import httpx

    from crawler.core.catalog_inventory import HttpxCatalogInventoryTransport

    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["method"] = request.method
        captured["path"] = request.url.path
        captured["params"] = dict(request.url.params)

        return httpx.Response(
            200,
            json=[
                {
                    "is_active": True,
                    "publication_status": "staging",
                    "catalog_vendor_markets": {
                        "catalog_countries": {"country_code": "US"},
                    },
                    "catalog_furniture_types": {"code": "sofa"},
                }
            ],
        )

    mock_transport = httpx.MockTransport(handler)

    original_async_client = httpx.AsyncClient

    def fake_async_client(*args, **kwargs):
        kwargs["transport"] = mock_transport
        return original_async_client(*args, **kwargs)

    monkeypatch.setattr(httpx, "AsyncClient", fake_async_client)

    class FakeSettings:
        def require_supabase_credentials(self):
            return "https://example.supabase.co", "test-service-key"

    transport = HttpxCatalogInventoryTransport(settings=FakeSettings())

    response = asyncio.run(transport.get_inventory_products())

    assert response.status_code == 200
    assert len(response.data) == 1

    assert captured["method"] == "GET"
    assert captured["path"] == "/rest/v1/catalog_products"
    assert captured["params"]["is_active"] == "eq.true"

    select = captured["params"]["select"]
    assert "is_active" in select
    assert "publication_status" in select
    assert "catalog_vendor_markets" in select
    assert "catalog_countries(country_code)" in select
    assert "catalog_furniture_types!inner(code)" in select
