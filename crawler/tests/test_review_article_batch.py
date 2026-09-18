import asyncio
import json
from datetime import datetime, timezone
from pathlib import Path

from crawler.core.fetcher import FetchResult
from crawler.jobs.review_article_batch import _completed_status, load_candidates, review_candidates


FIXTURES = Path(__file__).parent / "fixtures" / "article"


def run(coroutine):
    return asyncio.run(coroutine)


class FixtureFetcher:
    def __init__(self):
        self.calls: list[str] = []
        self.responses = {
            "90090": (FIXTURES / "inch_dimensions_sofa.html").read_text(),
            "24155": (FIXTURES / "identity_and_related_sofa.html").read_text(),
            "40400": "<html><body>missing structured product</body></html>",
        }

    async def fetch(self, url: str) -> FetchResult:
        self.calls.append(url)
        page_id = url.split("/product/")[1].split("/", 1)[0]
        return FetchResult(
            requested_url=url,
            final_url=url,
            status_code=200,
            response_text=self.responses[page_id],
            content_type="text/html",
            fetched_at=datetime(2026, 9, 17, tzinfo=timezone.utc),
            attempts=1,
        )


def test_discovery_json_feeds_bounded_batch_review():
    candidates = load_candidates(FIXTURES / "batch_discovery.json")
    result = run(review_candidates(candidates, limit=2, fetcher=FixtureFetcher()))

    assert result["summary"]["candidates_received"] == 3
    assert result["summary"]["products_attempted"] == 2


def test_batch_reuses_adapter_normalizer_and_persistence_plan_without_repository_apply():
    candidates = load_candidates(FIXTURES / "batch_discovery.json")
    result = run(review_candidates(candidates[:1], fetcher=FixtureFetcher()))

    product = result["products"][0]
    variant = product["variants"][0]
    assert product["status"] == "success"
    assert product["normalization_review_reasons"] == []
    assert product["persistence_review_reasons"] == []
    assert product["review_reasons"] == []
    assert variant["source_dimension_text"] == "width: 90 in; depth: 35 in; height: 32 in"
    assert variant["normalized_dimensions"]["width_cm"] == 228.6
    assert product["persistence_plan"]["product_natural_key"] == "vendor_product_id:ART-INCH-90"
    assert "customer_price" not in json.dumps(product)


def test_bad_product_is_isolated_and_later_products_continue():
    candidates = load_candidates(FIXTURES / "batch_discovery.json")
    fetcher = FixtureFetcher()
    result = run(review_candidates(candidates, fetcher=fetcher))

    assert [product["status"] for product in result["products"]] == ["success", "extraction_failed", "success"]
    assert result["products"][1]["stage"] == "extraction"
    assert result["summary"]["products_failed"] == 1
    assert len(fetcher.calls) == 3


def test_related_products_remain_evidence_only_and_page_ids_remain_separate():
    candidates = load_candidates(FIXTURES / "batch_discovery.json")
    result = run(review_candidates([candidates[2]], fetcher=FixtureFetcher()))

    product = result["products"][0]
    assert product["article_page_id"] == "24155"
    assert product["related_products"] is not None
    assert product["resolution_proposals"] == []
    assert "family" not in json.dumps(product)


def test_review_document_is_json_serializable_and_does_not_apply_supabase_plans():
    candidates = load_candidates(FIXTURES / "batch_discovery.json")
    result = run(review_candidates(candidates[:1], fetcher=FixtureFetcher()))

    assert json.loads(json.dumps(result, default=str))["summary"]["vendor"] == "Article"
    assert "repository" not in result


def test_completed_status_distinguishes_no_review_reasons_from_review_required():
    assert _completed_status((), ()) == ("success", [])
    assert _completed_status(("unknown_width_unit",), ("taxonomy_review", "unknown_width_unit")) == (
        "normalization_review",
        ["unknown_width_unit", "taxonomy_review"],
    )
