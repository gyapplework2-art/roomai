import asyncio
import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

from crawler.core.catalog_batch import intake_candidates, persist_batch, promote_batch
from crawler.core.fetcher import FetchResult
from crawler.core.persistence import build_persistence_plan
from crawler.core.supabase_repository import ExecutionReport
from crawler.core.config import CrawlerSettings
from crawler.jobs import expand_catalog
from crawler.vendors.article import ArticleVendorAdapter

FIXTURES = Path(__file__).parent / "fixtures" / "article"


def run(coroutine):
    return asyncio.run(coroutine)


class FixtureFetcher:
    def __init__(self):
        self.calls = []

    async def fetch(self, url):
        self.calls.append(url)
        page_id = url.split("/product/")[1].split("/", 1)[0]
        if page_id == "40400":
            return FetchResult(url, url, 200, "<html></html>", "text/html", datetime.now(timezone.utc), 1)
        name = "inch_dimensions_sofa.html" if page_id == "90090" else "normal_sofa.html"
        return FetchResult(url, url, 200, (FIXTURES / name).read_text(), "text/html", datetime.now(timezone.utc), 1)


def candidates():
    return [
        {"product_url": "https://example.com/product/90090/sofa", "source_category": "sofas"},
        {"product_url": "https://example.com/product/40400/missing", "source_category": "sofas"},
        {"product_url": "https://example.com/product/90090/sofa", "source_category": "sofas"},
    ]


def test_intake_is_bounded_sequential_and_isolates_failures():
    fetcher = FixtureFetcher()
    result = run(intake_candidates(candidates(), adapter=ArticleVendorAdapter("US"), fetcher=fetcher, limit=2))
    assert [item.status for item in result.items] == ["ready", "failed"]
    assert len(fetcher.calls) == 2
    assert result.items[0].plan is not None


def test_intake_marks_taxonomy_review_without_guessing():
    item = {"product_url": "https://example.com/product/90090/sofa", "source_category": "ambiguous"}
    result = run(intake_candidates([item], adapter=ArticleVendorAdapter("US"), fetcher=FixtureFetcher()))
    assert result.items[0].status in {"ready", "review_required"}
    if result.items[0].status == "review_required":
        assert result.items[0].review_reasons


def test_intake_requires_review_when_extracted_type_conflicts_with_approved_target():
    result = run(intake_candidates(
        [{
            "product_url": "https://example.com/product/90091/sofa",
            "source_category": "coffee_tables",
            "furniture_type_code": "coffee_table",
        }],
        adapter=ArticleVendorAdapter("US"), fetcher=FixtureFetcher(),
    ))

    assert result.items[0].status == "review_required"
    assert "furniture_type_mismatch" in result.items[0].review_reasons
    assert result.ready == ()


def test_intake_reports_explicit_same_product_evidence_without_merging_urls():
    fetcher = FixtureFetcher()
    result = run(intake_candidates([
        {"product_url": "https://example.com/product/90091/sofa", "source_category": "sofas"},
        {"product_url": "https://example.com/product/90092/sofa", "source_category": "sofas"},
    ], adapter=ArticleVendorAdapter("US"), fetcher=fetcher))

    assert len(result.items) == 2
    assert len(set(fetcher.calls)) == 2
    assert result.items[0].plan.product_natural_key == result.items[1].plan.product_natural_key
    assert result.items[0].product.product_url == result.items[1].product.product_url
    assert result.items[1].resolution_proposals[0]["relationship_type"] == "same_product_candidate"
    assert "same_vendor_product_id" in result.items[1].resolution_proposals[0]["evidence_codes"]
    assert "resolution_proposals" in result.as_dict()["products"][1]


def test_persistence_batch_defaults_to_dry_run_and_reports_each_plan():
    class FakeExecutor:
        def __init__(self):
            self.calls = []

        async def execute(self, plan, *, execution_requested):
            self.calls.append(execution_requested)
            return ExecutionReport(execution_requested, False)

    plans = [build_persistence_plan(ArticleVendorAdapter("US").parse_product(
        (FIXTURES / "normal_sofa.html").read_text(),
        "https://example.com/product/90090/sofa",
        datetime.now(timezone.utc),
    ))]
    executor = FakeExecutor()
    result = run(persist_batch(plans, executor=executor))
    assert result.dry_run is True
    assert result.items[0].outcome == "planned"
    assert executor.calls == [False]


def test_persistence_batch_isolates_partial_failure():
    class FakeExecutor:
        def __init__(self):
            self.index = 0

        async def execute(self, plan, *, execution_requested):
            self.index += 1
            if self.index == 1:
                return ExecutionReport(True, True, write_attempted=True, write_succeeded=True)
            return ExecutionReport(True, True, write_attempted=True, failed_operations=[{"table": "catalog_products", "reason": "failed"}])

    product = ArticleVendorAdapter("US").parse_product(
        (FIXTURES / "normal_sofa.html").read_text(),
        "https://example.com/product/90090/sofa",
        datetime.now(timezone.utc),
    )
    result = run(persist_batch([build_persistence_plan(product), build_persistence_plan(product.model_copy(update={"vendor_product_id": "other"}))], executor=FakeExecutor(), execute=True))
    assert [item.outcome for item in result.items] == ["persisted", "failed"]


def test_persistence_batch_skips_duplicate_natural_keys_without_second_execution():
    class FakeExecutor:
        def __init__(self):
            self.calls = 0

        async def execute(self, plan, *, execution_requested):
            self.calls += 1
            return ExecutionReport(execution_requested, False)

    product = ArticleVendorAdapter("US").parse_product(
        (FIXTURES / "normal_sofa.html").read_text(),
        "https://example.com/product/90090/sofa",
        datetime.now(timezone.utc),
    )
    executor = FakeExecutor()
    result = run(persist_batch([build_persistence_plan(product), build_persistence_plan(product)], executor=executor))
    assert [item.outcome for item in result.items] == ["planned", "skipped"]
    assert executor.calls == 1


def test_persistence_batch_keeps_same_vendor_product_id_separate_across_markets():
    class FakeExecutor:
        def __init__(self):
            self.calls = []

        async def execute(self, plan, *, execution_requested):
            self.calls.append(plan.vendor_market.market_code)
            return ExecutionReport(execution_requested, False)

    source = (FIXTURES / "normal_sofa.html").read_text()
    products = [
        ArticleVendorAdapter(market).parse_product(
            source, "https://example.com/product/90090/sofa", datetime.now(timezone.utc),
        ) for market in ("US", "CA")
    ]
    executor = FakeExecutor()
    result = run(persist_batch([build_persistence_plan(product) for product in products], executor=executor))

    assert result.items[0].product_natural_key == result.items[1].product_natural_key
    assert [item.outcome for item in result.items] == ["planned", "planned"]
    assert executor.calls == ["article-us", "article-ca"]


def test_promotion_batch_isolates_review_and_success():
    from crawler.core.catalog_promotion import PromotionReport

    async def fake_promote(variant_id, **kwargs):
        if variant_id == "review":
            return PromotionReport(True, True, variant_id, blocking_reasons=["taxonomy_review_required"])
        return PromotionReport(True, True, variant_id, write_attempted=True, write_succeeded=True)

    result = run(promote_batch(["review", "ok"], transport=object(), execute=True, promote=fake_promote))
    assert [item.outcome for item in result.items] == ["review_required", "promoted"]


def _discovered_candidate(product_url):
    return {
        "vendor": "Article",
        "vendor_market_code": "US",
        "source_category": "sofas",
        "source_page_url": "https://www.article.com/browse/1/sofas?collectionId=603",
        "product_url": product_url,
    }


def _batch_args(input_path, *, stage="persist", execute=False):
    return argparse.Namespace(
        stage=stage, input=input_path, vendor="article", market="US", limit=10,
        execute=execute, output=None,
    )


def test_expansion_ingestion_dry_run_deduplicates_urls_and_reports_intended_mutations(monkeypatch, tmp_path):
    candidates = [
        _discovered_candidate("https://www.article.com/product/90091/sofa?ref=listing"),
        _discovered_candidate("https://www.article.com/product/90091/sofa"),
    ]
    input_path = tmp_path / "approved.json"
    input_path.write_text(json.dumps({"candidates": candidates}))
    fetcher = FixtureFetcher()
    monkeypatch.setattr(expand_catalog, "HttpFetcher", lambda: fetcher)
    monkeypatch.setattr(expand_catalog, "get_settings", lambda: CrawlerSettings(CATALOG_ALLOW_WRITES=False))

    report = run(expand_catalog.run(_batch_args(input_path)))

    assert fetcher.calls == ["https://www.article.com/product/90091/sofa"]
    assert report["intake"]["summary"]["products_attempted"] == 1
    assert report["persistence"]["dry_run"] is True
    assert report["persistence"]["products"][0]["report"]["write_attempted"] is False
    assert report["preflight"][0]["product_natural_key"].startswith("vendor_product_id:")
    operations = report["preflight"][0]["operations"]
    assert {operation["target_table"] for operation in operations} >= {
        "catalog_vendors", "catalog_vendor_markets", "catalog_products",
        "catalog_product_variants", "catalog_current_offers",
    }
    assert all(operation["values"].get("publication_status") in {None, "staging"} for operation in operations)


def test_coverage_expansion_output_feeds_existing_dry_run_batch(monkeypatch, tmp_path):
    input_path = tmp_path / "expansion.json"
    input_path.write_text(json.dumps({
        "stage": "expand",
        "targets": [
            {"candidates": [_discovered_candidate("https://www.article.com/product/90091/sofa")]},
            {"candidates": [_discovered_candidate("https://www.article.com/product/90091/sofa?ref=repeat")]},
        ],
    }))
    fetcher = FixtureFetcher()
    monkeypatch.setattr(expand_catalog, "HttpFetcher", lambda: fetcher)
    monkeypatch.setattr(expand_catalog, "get_settings", lambda: CrawlerSettings(CATALOG_ALLOW_WRITES=False))

    report = run(expand_catalog.run(_batch_args(input_path)))

    assert len(fetcher.calls) == 1
    assert report["intake"]["summary"]["ready"] == 1
    assert report["persistence"]["summary"]["planned"] == 1
    assert report["persistence"]["products"][0]["report"]["write_attempted"] is False


def test_explicit_execute_remains_dry_run_without_catalog_write_guard(monkeypatch, tmp_path):
    input_path = tmp_path / "approved.json"
    input_path.write_text(json.dumps({
        "candidates": [_discovered_candidate("https://www.article.com/product/90091/sofa")],
    }))
    monkeypatch.setattr(expand_catalog, "HttpFetcher", FixtureFetcher)
    monkeypatch.setattr(expand_catalog, "get_settings", lambda: CrawlerSettings(CATALOG_ALLOW_WRITES=False))

    report = run(expand_catalog.run(_batch_args(input_path, execute=True)))

    assert report["persistence"]["dry_run"] is True
    assert report["persistence"]["products"][0]["report"]["execution_requested"] is True
    assert report["persistence"]["products"][0]["report"]["writes_enabled"] is False
    assert report["persistence"]["products"][0]["report"]["write_attempted"] is False


def test_expansion_ingestion_rejects_unapproved_sources_before_fetch(monkeypatch, tmp_path):
    import pytest

    fetcher = FixtureFetcher()
    monkeypatch.setattr(expand_catalog, "HttpFetcher", lambda: fetcher)
    for candidate in (
        _discovered_candidate("https://unapproved.example/product/90090/sofa"),
        {**_discovered_candidate("https://www.article.com/product/90090/sofa"), "source_page_url": "https://unapproved.example/sofas"},
    ):
        input_path = tmp_path / "unapproved.json"
        input_path.write_text(json.dumps({"candidates": [candidate]}))
        with pytest.raises(ValueError, match="approved"):
            run(expand_catalog.run(_batch_args(input_path, execute=True)))
    assert fetcher.calls == []


def test_batch_intake_rejects_cross_host_redirect_before_extraction():
    class RedirectFetcher:
        async def fetch(self, url):
            return FetchResult(url, "https://unapproved.example/product/90091/sofa", 200,
                               (FIXTURES / "normal_sofa.html").read_text(), "text/html", datetime.now(timezone.utc), 1)

    result = run(intake_candidates(
        [_discovered_candidate("https://www.article.com/product/90091/sofa")],
        adapter=ArticleVendorAdapter("US"), fetcher=RedirectFetcher(),
    ))

    assert len(result.failed) == 1
    assert result.failed[0].reason == "redirected_outside_source_host"
    assert result.failed[0].plan is None
