from crawler.core.normalizer import normalize_product
from crawler.models.product import CatalogProduct
from crawler.core.taxonomy import (
    ALIASES,
    CANONICAL_TYPES,
    _normalize_text,
)


def test_normalize_text_handles_case_punctuation_and_spacing():
    assert _normalize_text("  Modular Sofas  ") == "modular sofas"
    assert _normalize_text("Side / End Tables") == "side end tables"
    assert _normalize_text("BAR & COUNTER STOOLS") == "bar and counter stools"


def test_every_alias_points_to_a_canonical_type():
    for alias, canonical_code in ALIASES.items():
        assert alias
        assert canonical_code in CANONICAL_TYPES


def test_basic_sofa_aliases():
    assert ALIASES["sofas"] == "sofa"
    assert ALIASES["modular sofas"] == "sectional_sofa"
    assert ALIASES["sofa with chaise"] == "sofa_with_chaise"


def test_common_table_aliases():
    assert ALIASES["coffee tables"] == "coffee_table"
    assert ALIASES["side tables"] == "side_end_table"
    assert ALIASES["console tables"] == "console_table"


def test_common_bedroom_aliases():
    assert ALIASES["beds"] == "bed_frame"
    assert ALIASES["bedside tables"] == "nightstand"
    assert ALIASES["dressers"] == "dresser"


def test_unknown_vendor_category_is_not_guessed():
    assert ALIASES.get("mystery relaxation furniture") is None

def _product(
    *,
    name: str,
    category: str | None = None,
    subcategory: str | None = None,
    product_type: str | None = None,
) -> CatalogProduct:
    return CatalogProduct(
        vendor_product_id="TEST-001",
        source_product_name=name,
        source_category=category,
        source_subcategory=subcategory,
        source_product_type=product_type,
        product_url="https://example.com/product/test-001",
        vendor_market_code="US",
        source_payload={"vendor": "Test Vendor"},
        variants=[],
    )


def test_article_sofas_normalize_to_sofa():
    product = _product(
        name='Timber 90" Leather Sofa - Charme Tan',
        category="Sofas",
    )

    result = normalize_product(product)

    assert result.product.canonical_furniture_type_code == "sofa"
    assert result.product.needs_taxonomy_review is False
    assert "taxonomy_review" not in result.review_reasons

    # Source evidence must remain untouched.
    assert result.product.source_category == "Sofas"


def test_ikea_chaise_name_refines_broad_modular_sofa_category():
    product = _product(
        name="JÄTTEBO 4-seat mod sofa w chaise right with headrest",
        category="Modular sofas",
    )

    result = normalize_product(product)

    assert result.product.canonical_furniture_type_code == "sofa_with_chaise"
    assert result.product.needs_taxonomy_review is False
    assert result.product.source_category == "Modular sofas"


def test_unknown_taxonomy_remains_unresolved_and_requires_review():
    product = _product(
        name="Mystery Relaxation Furniture",
        category="Unmapped Furniture Collection",
    )

    result = normalize_product(product)

    assert result.product.canonical_furniture_type_code is None
    assert result.product.needs_taxonomy_review is True
    assert "taxonomy_review" in result.review_reasons