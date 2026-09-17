from datetime import datetime, timezone
from pathlib import Path

import pytest

from crawler.core.normalizer import normalize_product
from crawler.vendors.article import ARTICLE_US_MARKET, ARTICLE_VENDOR, ArticleExtractionError, ArticleVendorAdapter


FIXTURES = Path(__file__).parent / "fixtures" / "article"


def parse_fixture(name: str):
    return ArticleVendorAdapter().parse_product(
        (FIXTURES / name).read_text(),
        "https://example.com/article/requested-url",
        datetime(2026, 9, 17, tzinfo=timezone.utc),
    )


def test_normal_sofa_preserves_explicit_article_us_source_facts():
    product = parse_fixture("normal_sofa.html")

    assert product.vendor_market_code == ARTICLE_US_MARKET
    assert product.source_payload["vendor"] == ARTICLE_VENDOR
    assert product.vendor_product_id == "ART-MOCK-100"
    assert product.source_product_name == "Article-like Fictional Sven Sofa"
    assert product.source_description == "A complete fictional source description preserved exactly."


def test_dimensions_images_and_offer_are_extracted_when_explicitly_present():
    product = parse_fixture("normal_sofa.html")
    variant = product.variants[0]

    assert variant.dimensions is not None
    assert variant.dimensions.width_cm == 220
    assert variant.dimensions.depth_cm == 95
    assert variant.images[0].source_url == "https://example.com/article/sofa-main.jpg"
    assert variant.current_offer is not None
    assert variant.current_offer.currency == "USD"
    assert variant.current_offer.vendor_sale_price == 1699


def test_explicit_article_inch_dimensions_flow_to_normalizer_without_losing_source_evidence():
    product = parse_fixture("inch_dimensions_sofa.html")
    source_dimensions = product.variants[0].dimensions
    normalized_dimensions = normalize_product(product).product.variants[0].dimensions

    assert source_dimensions is not None
    assert source_dimensions.source_dimension_text == "width: 90 in; depth: 35 in; height: 32 in"
    assert source_dimensions.dimension_details == {
        "width": {"value": 90.0, "unit": "in"},
        "depth": {"value": 35.0, "unit": "in"},
        "height": {"value": 32.0, "unit": "in"},
    }
    assert normalized_dimensions is not None
    assert normalized_dimensions.width_cm == 228.6
    assert normalized_dimensions.depth_cm == 88.9
    assert normalized_dimensions.height_cm == 81.28
    assert normalized_dimensions.source_dimension_text == source_dimensions.source_dimension_text


def test_multiple_variants_preserve_source_colors_without_normalization():
    product = parse_fixture("multi_variant_sofa.html")

    assert len(product.variants) == 2
    assert product.variants[0].vendor_sku == "ART-OAT"
    assert product.variants[0].source_color == "Oatmeal"
    assert product.variants[0].normalized_color is None
    assert product.variants[1].source_color == "Charcoal"


def test_sale_offer_preserves_list_and_current_prices():
    product = parse_fixture("sale_sofa.html")
    offer = product.variants[0].current_offer

    assert offer is not None
    assert offer.vendor_list_price == 1999
    assert offer.vendor_sale_price == 1499


def test_article_page_id_is_preserved_separately_from_sku():
    product = parse_fixture("identity_and_related_sofa.html")

    assert product.source_payload["article_page_id"] == "24155"
    assert product.vendor_product_id == "SKU16852"
    assert product.source_payload["article_page_id"] != product.vendor_product_id


def test_article_related_products_are_preserved_as_source_evidence():
    product = parse_fixture("identity_and_related_sofa.html")
    related_products = product.source_payload["related_products"]

    assert related_products == [
        {
            "@type": "Product",
            "name": "Article-like Timber Sofa - Forest",
            "url": "https://example.com/article/product/24154/timber-sofa-forest",
        },
        {
            "@type": "Product",
            "name": "Article-like Timber Sofa - Rain",
            "url": "https://example.com/article/product/24155/timber-sofa-rain",
        },
        {
            "@type": "Product",
            "name": "Article-like Timber Sofa - Cloud",
            "url": "https://example.com/article/product/30332/timber-sofa-cloud",
        },
        {
            "@type": "Product",
            "name": "Article-like Timber Sofa - Stone",
            "url": "https://example.com/article/product/30333/timber-sofa-stone",
        },
    ]


def test_related_article_page_ids_are_extracted_when_present():
    product = parse_fixture("identity_and_related_sofa.html")

    assert product.source_payload["related_article_page_ids"] == [
        "24154",
        "24155",
        "30332",
        "30333",
    ]


def test_missing_related_products_does_not_invent_relationships():
    product = parse_fixture("identity_without_related_sofa.html")

    assert product.source_payload["related_products"] is None
    assert product.source_payload["related_article_page_ids"] == []


def test_missing_optional_fields_remain_none_or_empty():
    product = parse_fixture("missing_optional.html")

    assert product.source_description is None
    assert product.source_category is None
    assert product.variants[0].source_color is None
    assert product.variants[0].current_offer is None


def test_malformed_json_ld_uses_minimal_stable_html_fallback():
    product = parse_fixture("malformed.html")

    assert product.source_product_name == "Article-like Fallback Chair"
    assert product.source_description == "Fallback source description."
    assert product.variants[0].images[0].source_url == "https://example.com/article/chair.jpg"


def test_incomplete_structured_data_fails_gracefully_without_inventing_name():
    adapter = ArticleVendorAdapter()

    with pytest.raises(ArticleExtractionError, match="name and URL"):
        adapter.parse_product(
            '<script type="application/ld+json">{"@type":"Product","url":"https://example.com/article/unnamed"}</script>',
            "https://example.com/article/unnamed",
        )


def test_html_without_source_data_fails_gracefully():
    with pytest.raises(ArticleExtractionError, match="No product JSON-LD"):
        ArticleVendorAdapter().parse_product("<html><body>Unavailable</body></html>", "https://example.com/article/none")
