import asyncio
import json
from datetime import datetime, timezone
from pathlib import Path

import httpx
import pytest

from crawler.core.catalog_refresh import (
    CatalogRefreshError,
    HttpxCatalogRefreshTransport,
    build_refresh_candidates,
    load_refresh_candidates,
    refresh_catalog,
)
from crawler.core.config import CrawlerSettings
from crawler.core.fetcher import FetchError, FetchResult
from crawler.core.supabase_repository import RestResponse


FIXTURES = Path(__file__).parent / "fixtures"
NOW = datetime(2026, 9, 27, tzinfo=timezone.utc)


def _row(vendor="article"):
    return {
        "id": "product-existing",
        "source_product_name": "Existing Sofa",
        "source_category": "Sofas",
        "product_url": f"https://example.com/{vendor}/product",
        "persistence_key": (
            "vendor_product_id:ART-MOCK-100"
            if vendor == "article"
            else "vendor_product_id:IKEA-MOCK-100"
        ),
        "last_seen_at": "2026-09-20T00:00:00+00:00",
        "publication_status": "staging",
        "is_active": True,
        "catalog_vendor_markets": {
            "market_code": "article-us" if vendor == "article" else "ikea-us",
            "catalog_vendors": {
                "slug": vendor,
                "crawl_enabled": True,
            },
        },
    }


class FakeCandidateTransport:
    def __init__(self, response):
        self.response = response
        self.calls = []

    async def get_refresh_candidates(self, *, market_code, limit):
        self.calls.append((market_code, limit))
        return self.response


class FakeFetcher:
    def __init__(self, result):
        self.result = result
        self.urls = []

    async def fetch(self, url):
        self.urls.append(url)
        return self.result


def _fetch_result(vendor="article"):
    fixture = "normal_sofa.html" if vendor == "article" else "hyltarp_sofa.html"
    return FetchResult(
        requested_url=f"https://example.com/{vendor}/product",
        final_url=f"https://example.com/{vendor}/product",
        status_code=200,
        response_text=(FIXTURES / vendor / fixture).read_text(),
        content_type="text/html",
        fetched_at=NOW,
        attempts=1,
    )


def test_build_refresh_candidates_preserves_existing_identity():
    candidate = build_refresh_candidates([_row()])[0]

    assert candidate.product_id == "product-existing"
    assert candidate.vendor == "article"
    assert candidate.market_code == "article-us"
    assert candidate.persistence_key == "vendor_product_id:ART-MOCK-100"
    assert candidate.source_category == "Sofas"


def test_invalid_candidate_is_rejected():
    row = _row()
    row["product_url"] = None

    with pytest.raises(CatalogRefreshError, match="refresh_candidate_invalid"):
        build_refresh_candidates([row])


def test_load_refresh_candidates_is_bounded_to_fifty():
    transport = FakeCandidateTransport(RestResponse(200, [_row()]))

    candidates = asyncio.run(
        load_refresh_candidates(
            market_code="article-us",
            limit=500,
            transport=transport,
        )
    )

    assert len(candidates) == 1
    assert transport.calls == [("article-us", 50)]


def test_refresh_dry_run_fetches_and_makes_no_writes():
    candidate_transport = FakeCandidateTransport(RestResponse(200, [_row()]))
    fetcher = FakeFetcher(_fetch_result())

    report = asyncio.run(
        refresh_catalog(
            market_code="article-us",
            limit=1,
            execute=False,
            candidate_transport=candidate_transport,
            fetcher=fetcher,
            settings=CrawlerSettings(CATALOG_ALLOW_WRITES=False),
        )
    )

    assert report.execution_requested is False
    assert report.writes_enabled is False
    assert report.candidates_total == 1
    assert fetcher.urls == [_row()["product_url"]]
    assert report.items[0].write_attempted is False
    assert report.items[0].write_succeeded is False
    assert report.items[0].status in {"dry_run", "review_required"}


def test_identity_mismatch_requires_review_and_makes_no_writes():
    row = _row()
    row["persistence_key"] = "vendor_product_id:DIFFERENT"

    report = asyncio.run(
        refresh_catalog(
            market_code="article-us",
            limit=1,
            execute=False,
            candidate_transport=FakeCandidateTransport(
                RestResponse(200, [row])
            ),
            fetcher=FakeFetcher(_fetch_result()),
            settings=CrawlerSettings(CATALOG_ALLOW_WRITES=False),
        )
    )

    item = report.items[0]

    assert item.status == "review_required"
    assert item.reason == "product_identity_mismatch"
    assert item.review_reasons == ("product_identity_mismatch",)
    assert item.write_attempted is False
    assert item.write_succeeded is False


def test_execute_without_environment_guard_still_makes_no_writes():
    candidate_transport = FakeCandidateTransport(RestResponse(200, [_row()]))
    fetcher = FakeFetcher(_fetch_result())

    report = asyncio.run(
        refresh_catalog(
            market_code="article-us",
            limit=1,
            execute=True,
            candidate_transport=candidate_transport,
            fetcher=fetcher,
            settings=CrawlerSettings(CATALOG_ALLOW_WRITES=False),
        )
    )

    assert report.writes_enabled is False
    assert report.items[0].write_attempted is False
    assert report.items[0].write_succeeded is False


def test_fetch_failure_is_isolated():
    failed = FetchResult(
        requested_url=_row()["product_url"],
        final_url=_row()["product_url"],
        status_code=503,
        response_text=None,
        content_type=None,
        fetched_at=NOW,
        attempts=3,
        error=FetchError("HTTP 503", retryable=True),
    )

    report = asyncio.run(
        refresh_catalog(
            market_code="article-us",
            limit=1,
            candidate_transport=FakeCandidateTransport(
                RestResponse(200, [_row()])
            ),
            fetcher=FakeFetcher(failed),
            settings=CrawlerSettings(CATALOG_ALLOW_WRITES=False),
        )
    )

    assert report.items[0].status == "failed"
    assert report.items[0].reason == "fetch_failed:HTTP 503"


def test_unsupported_vendor_is_isolated_as_parse_failure():
    row = _row()
    row["catalog_vendor_markets"]["catalog_vendors"]["slug"] = "unknown"

    report = asyncio.run(
        refresh_catalog(
            market_code="article-us",
            limit=1,
            candidate_transport=FakeCandidateTransport(
                RestResponse(200, [row])
            ),
            fetcher=FakeFetcher(_fetch_result()),
            settings=CrawlerSettings(CATALOG_ALLOW_WRITES=False),
        )
    )

    assert report.items[0].status == "failed"
    assert report.items[0].reason == "parse_failed:CatalogRefreshError"


def test_failed_candidate_read_is_reported():
    transport = FakeCandidateTransport(
        RestResponse(500, [], message="read failed")
    )

    with pytest.raises(
        CatalogRefreshError,
        match="refresh_candidate_read_failed",
    ):
        asyncio.run(
            load_refresh_candidates(
                market_code="article-us",
                transport=transport,
            )
        )


def test_httpx_candidate_transport_is_read_only(monkeypatch):
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

    transport = HttpxCatalogRefreshTransport(settings=FakeSettings())
    response = asyncio.run(
        transport.get_refresh_candidates(
            market_code="article-us",
            limit=10,
        )
    )

    assert response.status_code == 200
    assert captured["method"] == "GET"
    assert captured["path"] == "/rest/v1/catalog_products"
    assert captured["params"]["is_active"] == "eq.true"
    assert captured["params"]["limit"] == "10"
    assert captured["params"]["order"] == "last_seen_at.asc,id.asc"
    assert "persistence_key" in captured["params"]["select"]
    assert "catalog_vendor_markets!inner" in captured["params"]["select"]


def test_limit_below_one_is_rejected():
    with pytest.raises(ValueError, match="at least 1"):
        asyncio.run(
            load_refresh_candidates(
                market_code="article-us",
                limit=0,
                transport=FakeCandidateTransport(RestResponse(200, [])),
            )
        )


def test_refresh_cli_forwards_market_limit_and_explicit_execute_only(monkeypatch, capsys):
    from crawler.jobs import refresh_products

    calls = []

    class FakeReport:
        def as_dict(self):
            return {"writes_enabled": False, "items": []}

    async def fake_refresh_catalog(*, market_code, limit, execute):
        calls.append((market_code, limit, execute))
        return FakeReport()

    monkeypatch.setattr(refresh_products, "refresh_catalog", fake_refresh_catalog)
    monkeypatch.setattr("sys.argv", ["refresh_products", "--market", "ikea-us", "--limit", "2"])
    refresh_products.main()
    assert calls == [("ikea-us", 2, False)]
    assert json.loads(capsys.readouterr().out) == {"items": [], "writes_enabled": False}

    monkeypatch.setattr("sys.argv", ["refresh_products", "--execute"])
    refresh_products.main()
    assert calls[-1] == ("article-us", refresh_products.DEFAULT_REFRESH_LIMIT, True)
