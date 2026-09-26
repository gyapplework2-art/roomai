from datetime import datetime, timezone

import pytest

from crawler.discovery.article import canonicalize_article_product_url
from crawler.discovery.catalog import discover_catalog_candidates


def test_catalog_discovery_is_bounded_deduplicated_and_deterministic():
    result = discover_catalog_candidates(
        [
            "https://example.com/p/1?utm_source=x",
            "https://example.com/p/1#details",
            "not-a-url",
            "https://example.com/p/2",
            "https://example.com/p/3",
        ],
        vendor="Example",
        vendor_market_code="US",
        source_category="sofas",
        source_page_url="https://example.com/sofas",
        discovered_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
        is_product_url=lambda url: "/p/" in url,
        limit=2,
    )
    assert [candidate.product_url for candidate in result.candidates] == [
        "https://example.com/p/1",
        "https://example.com/p/2",
    ]
    assert result.duplicates_skipped == 1
    assert result.invalid_urls_skipped == 1
    assert all(candidate.vendor_market_code == "US" for candidate in result.candidates)


def test_article_discovery_reuses_existing_canonicalizer_and_market_isolation():
    result = discover_catalog_candidates(
        [
            "https://www.article.com/product/123/sofa?ref=category",
            "https://www.article.com/product/123/sofa",
            "https://www.article.com/product/456/chair",
        ],
        vendor="Article",
        vendor_market_code="US",
        source_category="sofas",
        source_page_url="https://www.article.com/sofas",
        canonicalize=canonicalize_article_product_url,
        is_product_url=lambda url: "/product/" in url,
        limit=10,
    )
    assert [candidate.vendor_product_key for candidate in result.candidates] == ["123", "456"]
    assert [candidate.product_url for candidate in result.candidates] == [
        "https://www.article.com/product/123/sofa",
        "https://www.article.com/product/456/chair",
    ]
    assert all(candidate.vendor_market_code == "US" for candidate in result.candidates)


def test_discovery_requires_explicit_source_and_positive_limit():
    with pytest.raises(ValueError):
        discover_catalog_candidates([], vendor="", vendor_market_code="US", source_category="sofa", source_page_url="https://example.com")
    with pytest.raises(ValueError):
        discover_catalog_candidates([], vendor="Article", vendor_market_code="US", source_category="sofa", source_page_url="")
    with pytest.raises(ValueError):
        discover_catalog_candidates([], vendor="Article", vendor_market_code="US", source_category="sofa", source_page_url="https://example.com", limit=0)
