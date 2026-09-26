import asyncio
from datetime import datetime, timezone
from pathlib import Path

from crawler.core.catalog_batch import intake_candidates, persist_batch, promote_batch
from crawler.core.fetcher import FetchResult
from crawler.core.persistence import build_persistence_plan
from crawler.core.supabase_repository import ExecutionReport
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


def test_promotion_batch_isolates_review_and_success():
    from crawler.core.catalog_promotion import PromotionReport

    async def fake_promote(variant_id, **kwargs):
        if variant_id == "review":
            return PromotionReport(True, True, variant_id, blocking_reasons=["taxonomy_review_required"])
        return PromotionReport(True, True, variant_id, write_attempted=True, write_succeeded=True)

    result = run(promote_batch(["review", "ok"], transport=object(), execute=True, promote=fake_promote))
    assert [item.outcome for item in result.items] == ["review_required", "promoted"]
