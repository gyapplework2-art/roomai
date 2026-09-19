import asyncio
from datetime import datetime, timezone
from pathlib import Path

from crawler.core.fetcher import FetchResult
from crawler.jobs.inspect_ikea_product import build_validation_report, inspect_product
from crawler.vendors.ikea import IkeaVendorAdapter


FIXTURE = Path(__file__).parent / "fixtures" / "ikea" / "hyltarp_sofa.html"


def run(coroutine):
    return asyncio.run(coroutine)


class FixtureFetcher:
    def __init__(self) -> None:
        self.calls: list[str] = []

    async def fetch(self, url: str) -> FetchResult:
        self.calls.append(url)
        return FetchResult(
            requested_url=url,
            final_url=url,
            status_code=200,
            response_text=FIXTURE.read_text(),
            content_type="text/html",
            fetched_at=datetime(2026, 9, 18, tzinfo=timezone.utc),
            attempts=1,
        )


def test_one_url_inspection_reuses_ikea_adapter_and_normalizer_without_persistence():
    fetcher = FixtureFetcher()
    report = run(inspect_product("https://example.com/us/en/p/hyltarp-sofa-s39489645", normalized=True, fetcher=fetcher))

    assert fetcher.calls == ["https://example.com/us/en/p/hyltarp-sofa-s39489645"]
    assert report["identity"]["vendor"] == "IKEA"
    assert report["variants"][0]["dimensions"]["source_dimension_details"]["width"] == {"value": 91.375, "unit": "in"}
    assert report["variants"][0]["dimensions"]["normalized"]["width_cm"] == 232.0925
    assert "repository" not in report


def test_report_preserves_source_and_normalized_facts_separately_with_image_metadata():
    product = IkeaVendorAdapter().parse_product(FIXTURE.read_text()).model_copy(update={"source_category": "Sofas"})
    report = build_validation_report(product, normalized=True)
    variant = report["variants"][0]

    assert variant["attributes"]["source_color"] == "white"
    assert variant["attributes"]["normalized_color"] == "white"
    assert report["identity"]["canonical_furniture_type_code"] == "sofa"
    assert variant["attributes"]["normalized_attributes"] == {"cushion_fill": "pocket_springs_and_foam"}
    assert variant["media"]["images"][0]["width_px"] == 2000
    assert variant["media"]["image_count"] == 2
    assert "customer_price" not in str(report)


def test_missing_optional_facts_are_safe_and_completeness_is_reported():
    product = IkeaVendorAdapter().parse_product(
        '<script type="application/ld+json">{"@type":"Product","name":"Basic Sofa","url":"https://example.com/p/basic"}</script>'
    )
    report = build_validation_report(product, normalized=True)

    assert report["completeness"]["color"] == "missing"
    assert report["completeness"]["material"] == "missing"
    assert report["completeness"]["dimensions"] == "missing"
    assert report["completeness"]["price"] == "missing"
    assert report["completeness"]["fields_missing"] == 6


def test_source_only_report_does_not_claim_normalized_furniture_type():
    product = IkeaVendorAdapter().parse_product(FIXTURE.read_text()).model_copy(update={"source_category": "Sofas"})
    report = build_validation_report(product, normalized=False)

    assert report["identity"]["canonical_furniture_type_code"] is None
    assert report["variants"][0]["attributes"]["normalized_attributes"] == {}
