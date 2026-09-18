from datetime import datetime, timezone
from pathlib import Path

from crawler.core.dry_run import build_catalog_dry_run
from crawler.core.persistence import build_persistence_plan
from crawler.vendors.article import ArticleVendorAdapter
from crawler.vendors.ikea import IkeaVendorAdapter


FIXTURES = Path(__file__).parent / "fixtures"


def article_plan():
    product = ArticleVendorAdapter().parse_product(
        (FIXTURES / "article" / "normal_sofa.html").read_text(),
        "https://example.com/article/product/100/sofa",
        datetime(2026, 9, 18, tzinfo=timezone.utc),
    )
    return build_persistence_plan(product)


def ikea_plan():
    product = IkeaVendorAdapter().parse_product(
        (FIXTURES / "ikea" / "hyltarp_sofa.html").read_text(),
        "https://example.com/us/en/p/hyltarp-sofa-hallarp-white-s39489645",
        datetime(2026, 9, 18, tzinfo=timezone.utc),
    )
    return build_persistence_plan(product)


def operation(document, table: str):
    return next(item for item in document.operations if item.target_table == table)


def test_article_and_ikea_generate_database_ready_staging_operations():
    article = build_catalog_dry_run(article_plan())
    ikea = build_catalog_dry_run(ikea_plan())

    assert article.write_allowed and ikea.write_allowed
    assert operation(article, "catalog_products").values["publication_status"] == "staging"
    assert operation(ikea, "catalog_products").values["needs_taxonomy_review"] is True
    assert [item.target_table for item in ikea.operations[:4]] == [
        "catalog_vendors", "catalog_countries", "catalog_vendor_markets", "catalog_products",
    ]


def test_vendor_markets_are_separate_and_resolve_us_by_natural_country_key():
    article = build_catalog_dry_run(article_plan())
    ikea = build_catalog_dry_run(ikea_plan())

    article_market = operation(article, "catalog_vendor_markets")
    ikea_market = operation(ikea, "catalog_vendor_markets")
    assert article_market.natural_key == {"market_code": "article-us"}
    assert ikea_market.natural_key == {"market_code": "ikea-us"}
    assert article_market.values["country_id"] == "country:US"
    assert "uuid" not in article_market.values["country_id"]
    assert article_market.values["default_locale"] == "en-US"


def test_dry_run_preserves_natural_keys_source_normalized_dimensions_media_and_vendor_offer():
    document = build_catalog_dry_run(ikea_plan())
    variant = operation(document, "catalog_product_variants")
    dimensions = operation(document, "catalog_product_dimensions")
    offer = operation(document, "catalog_current_offers")
    image_operations = [item for item in document.operations if item.target_table == "catalog_product_images"]

    assert variant.natural_key == {"product": "product:vendor_product_id:394.896.45", "natural_key": "sku:394.896.45"}
    assert dimensions.values["source_dimension_text"] == 'width: 91 3/8 "; depth: 36 5/8 "'
    assert dimensions.values["width_cm"] == 232.0925
    assert offer.values["currency"] == "USD"
    assert offer.values["vendor_sale_price"] == 1199.0
    assert offer.values["source_availability"] == "https://schema.org/InStock"
    assert [item.values["source_url"] for item in image_operations] == [
        "https://example.com/ikea/hyltarp-main.jpg", "https://example.com/ikea/hyltarp-detail.jpg",
    ]
    assert "roomai_selling_price" not in str(document.as_dict())


def test_repeat_dry_runs_are_deterministic_and_do_not_apply_a_repository():
    first = build_catalog_dry_run(article_plan()).as_dict()
    second = build_catalog_dry_run(article_plan()).as_dict()

    assert first["operations"] == second["operations"]
    assert "apply_plan" not in str(first)


def test_missing_critical_identity_blocks_writes_without_hiding_review_state():
    plan = article_plan()
    blocked_plan = plan.__class__(
        vendor=plan.vendor,
        vendor_market=plan.vendor_market,
        product_natural_key="",
        canonical_furniture_type_code=plan.canonical_furniture_type_code,
        product={**plan.product, "source_product_name": ""},
        variants=(),
        review_reasons=plan.review_reasons,
    )
    document = build_catalog_dry_run(blocked_plan)

    assert document.write_allowed is False
    assert set(document.blocking_reasons) == {"missing_product_identity", "missing_variant_identity"}
    assert "taxonomy_review"  not in document.review_reasons


def test_variant_name_or_source_index_fallback_is_not_a_database_safe_identity():
    plan = article_plan()
    variant = plan.variants[0]
    unsupported_variant = variant.__class__(
        natural_key="source_index:0",
        values={**variant.values, "vendor_sku": None, "vendor_variant_id": None},
        dimensions=variant.dimensions,
        offer=variant.offer,
        images=variant.images,
    )
    blocked_plan = plan.__class__(
        vendor=plan.vendor,
        vendor_market=plan.vendor_market,
        product_natural_key=plan.product_natural_key,
        canonical_furniture_type_code=plan.canonical_furniture_type_code,
        product=plan.product,
        variants=(unsupported_variant,),
        review_reasons=plan.review_reasons,
    )

    assert "missing_variant_identity" in build_catalog_dry_run(blocked_plan).blocking_reasons
