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


def test_explicit_article_leather_color_material_and_attributes_are_preserved():
    product = parse_fixture("rich_leather_sofa.html")
    variant = product.variants[0]

    assert variant.source_color == "Cognac"
    assert variant.source_material == "Full-aniline leather"
    assert variant.variant_attributes["article_attributes"] == {
        "Leather Color": "Cognac",
        "Upholstery Material": "Full-aniline leather",
        "Frame Material": "Solid wood",
        "Cushion Fill": "Foam and fiber",
        "Assembly Required": "No",
    }


def test_explicit_article_fabric_attributes_remain_separate_from_normalized_values():
    product = parse_fixture("rich_fabric_sofa.html")
    variant = product.variants[0]
    normalized_variant = normalize_product(product).product.variants[0]

    assert variant.source_color == "Cloud Gray"
    assert variant.source_material == "Performance Basketweave"
    assert normalized_variant.normalized_color == "gray"
    assert normalized_variant.normalized_material == "fabric"


def test_article_html_specifications_preserve_explicit_material_without_prose_inference():
    product = parse_fixture("html_specifications_rug.html")
    variant = product.variants[0]

    assert variant.source_material == "70% wool, 30% viscose"
    assert variant.variant_attributes["article_html_specifications"] == {
        "Materials": "70% wool, 30% viscose",
    }
    assert product.source_payload["article_html_specifications"] == {
        "Materials": "70% wool, 30% viscose",
    }
    assert "construction" not in normalize_product(product).product.variants[0].variant_attributes["normalized_attributes"]
    assert "Not a specification" not in str(variant.variant_attributes["article_html_specifications"])


def test_article_embedded_product_state_material_outranks_html_specification():
    html = '''
    <script type="application/ld+json">{"@type":"Product","name":"State Material Sofa","sku":"STATE-1","url":"https://example.com/article/state-1"}</script>
    <script id="article-product-state" type="application/json">{"product":{"attributes":[{"label":"Material","value":"Velvet"}]}}</script>
    <div class="flex-grid specs-rows"><div class="specs-title">Materials</div><div class="specs-value"><span>Wool</span></div></div>
    '''
    product = ArticleVendorAdapter().parse_product(html, "https://example.com/article/state-1")

    assert product.variants[0].source_material == "Velvet"
    assert product.variants[0].variant_attributes["article_html_specifications"] == {"Materials": "Wool"}


def test_article_json_ld_material_outranks_embedded_state_and_html_specification():
    html = '''
    <script type="application/ld+json">{"@type":"Product","name":"Structured Material Sofa","sku":"JSON-1","url":"https://example.com/article/json-1","material":"Leather"}</script>
    <script id="article-product-state" type="application/json">{"product":{"attributes":[{"label":"Material","value":"Velvet"}]}}</script>
    <div class="flex-grid specs-rows"><div class="specs-title">Materials</div><div class="specs-value"><span>Wool</span></div></div>
    '''
    product = ArticleVendorAdapter().parse_product(html, "https://example.com/article/json-1")

    assert product.variants[0].source_material == "Leather"
    assert product.variants[0].variant_attributes["article_html_specifications"] == {"Materials": "Wool"}


def test_article_specs_parser_does_not_collect_unrelated_div_pairs():
    product = parse_fixture("html_specifications_rug.html")

    assert product.source_payload["article_html_specifications"] == {
        "Materials": "70% wool, 30% viscose",
    }


def test_explicit_gallery_images_are_deduplicated_filtered_and_keep_source_order():
    product = parse_fixture("rich_leather_sofa.html")

    assert [image.source_url for image in product.variants[0].images] == [
        "https://example.com/article/hero.jpg",
        "https://example.com/article/detail.jpg",
        "https://example.com/article/json-ld-main.jpg",
    ]
    assert [image.sort_order for image in product.variants[0].images] == [0, 1, 2]


def test_names_and_related_products_do_not_infer_missing_rich_attributes():
    product = parse_fixture("rich_missing_attributes.html")
    variant = product.variants[0]

    assert variant.source_color is None
    assert variant.source_material is None
    assert variant.variant_attributes["article_attributes"] == {"Frame Material": "Wood"}


def test_article_url_semantics_are_preserved_as_lower_priority_evidence():
    product = ArticleVendorAdapter().parse_product(
        '<script type="application/ld+json">{"@type":"Product","name":"No Attribute Facts","sku":"SKU1","url":"https://example.com/product/30333/timber-90-leather-sofa-charme-tan"}</script>',
        "https://example.com/product/30333/timber-90-leather-sofa-charme-tan",
    )

    assert product.variants[0].source_color is None
    assert product.variants[0].source_material is None
    assert product.source_payload["attribute_evidence"] == {
        "material": [{"value": "leather", "source": "vendor_url_slug", "method": "deterministic"}],
        "color": [{"value": "charme tan", "source": "vendor_url_slug", "method": "deterministic"}],
    }


def test_explicit_structured_attributes_outrank_url_semantic_evidence():
    product = ArticleVendorAdapter().parse_product(
        '<script type="application/ld+json">{"@type":"Product","name":"No Inference","sku":"SKU2","url":"https://example.com/product/30333/timber-90-leather-sofa-charme-tan","color":"Forest Green","material":"Full-grain leather"}</script>',
        "https://example.com/product/30333/timber-90-leather-sofa-charme-tan",
    )

    assert product.variants[0].source_color == "Forest Green"
    assert product.variants[0].source_material == "Full-grain leather"
    assert product.source_payload["attribute_evidence"]["color"][0]["value"] == "charme tan"


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
