from datetime import datetime, timezone
from pathlib import Path

from crawler.discovery.article import canonicalize_article_product_url, discover_article_sofas


FIXTURE = Path(__file__).parent / "fixtures" / "article" / "sofa_listing.html"
SOURCE_PAGE = "https://example.com/collections/sofas"


def discover(limit: int = 30):
	return discover_article_sofas(
		FIXTURE.read_text(),
		SOURCE_PAGE,
		limit=limit,
		discovered_at=datetime(2026, 9, 17, tzinfo=timezone.utc),
	)


def test_valid_article_product_url_is_canonicalized_with_its_numeric_page_id():
	assert canonicalize_article_product_url("https://example.com/product/24155/timber-sofa-black?utm_source=test#top") == (
		"https://example.com/product/24155/timber-sofa-black",
		"24155",
	)


def test_non_product_url_is_rejected():
	assert canonicalize_article_product_url("https://example.com/collections/sofas") is None


def test_discovery_removes_duplicates_and_preserves_different_page_ids():
	result = discover()

	assert [candidate.article_page_id for candidate in result.candidates] == ["24155", "30333", "22570"]
	assert result.duplicates_skipped == 1
	assert result.invalid_urls_skipped == 3


def test_discovery_preserves_us_market_sofa_category_and_source_page():
	candidate = discover().candidates[0]

	assert candidate.vendor == "Article"
	assert candidate.vendor_market_code == "US"
	assert candidate.source_category == "sofas"
	assert candidate.source_page_url == SOURCE_PAGE
	assert candidate.discovered_from == "category_page"


def test_pilot_limit_is_respected():
	result = discover(limit=2)

	assert len(result.candidates) == 2
	assert result.requested_limit == 2


def test_discovery_candidate_contains_no_customer_price_fields():
	candidate = discover().candidates[0]

	assert "customer_price" not in candidate.__dict__
	assert "roomai_selling_price" not in candidate.__dict__
