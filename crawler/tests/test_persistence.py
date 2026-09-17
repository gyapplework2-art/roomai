from datetime import datetime, timezone
from pathlib import Path

import pytest

from crawler.core.persistence import build_persistence_plan
from crawler.vendors.article import ArticleVendorAdapter


FIXTURES = Path(__file__).parent / "fixtures" / "article"


def article_product(name: str = "inch_dimensions_sofa.html", market: str = "US"):
    return ArticleVendorAdapter(market).parse_product(
        (FIXTURES / name).read_text(),
        "https://example.com/article/product/90090/inch-dimension-sofa",
        datetime(2026, 9, 17, tzinfo=timezone.utc),
    )


def test_plan_maps_article_source_and_normalized_dimensions_to_catalog_tables():
    plan = build_persistence_plan(article_product())
    variant = plan.variants[0]

    assert plan.vendor.slug == "article"
    assert plan.vendor_market.market_code == "article-us"
    assert plan.product_natural_key == "vendor_product_id:ART-INCH-90"
    assert variant.dimensions is not None
    assert variant.dimensions["source_dimension_text"] == "width: 90 in; depth: 35 in; height: 32 in"
    assert variant.dimensions["width_cm"] == 228.6
    assert variant.dimensions["depth_cm"] == 88.9
    assert variant.dimensions["height_cm"] == 81.28


def test_plan_preserves_source_payload_and_vendor_market_separation():
    us_plan = build_persistence_plan(article_product(market="US"))
    ca_plan = build_persistence_plan(article_product(market="CA"))

    assert us_plan.product["source_payload"]["vendor"] == "Article"
    assert us_plan.vendor_market.market_code == "article-us"
    assert ca_plan.vendor_market.market_code == "article-ca"


def test_plan_preserves_offer_images_and_excludes_roomai_pricing():
    plan = build_persistence_plan(article_product("normal_sofa.html"))
    variant = plan.variants[0]

    assert variant.offer is not None
    assert variant.offer["currency"] == "USD"
    assert variant.offer["vendor_sale_price"] == 1699.0
    assert variant.images[0]["sort_order"] == 0
    assert "roomai_selling_price" not in variant.offer
    assert "customer_price" not in variant.offer


def test_unknown_taxonomy_stages_for_review_without_identity_merge():
    plan = build_persistence_plan(article_product("identity_and_related_sofa.html"))

    assert plan.product["publication_status"] == "staging"
    assert plan.product["needs_taxonomy_review"] is True
    assert "taxonomy_review" in plan.review_reasons
    assert plan.product["source_payload"]["related_products"] is not None


def test_missing_vendor_identity_fails_clearly():
    product = article_product().model_copy(update={"source_payload": {}})

    with pytest.raises(ValueError, match="explicit source vendor"):
        build_persistence_plan(product)
