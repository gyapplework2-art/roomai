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


def test_observed_storage_bed_and_desk_category_aliases():
    assert ALIASES["dressers and chests of drawers"] == "dresser"
    assert ALIASES["bed frames with storage"] == "bed_frame"
    assert ALIASES["mittzon office desks"] == "desk"


def test_unknown_vendor_category_is_not_guessed():
    assert ALIASES.get("mystery relaxation furniture") is None
    assert ALIASES.get("lighting") is None

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


def test_observed_ikea_storage_bed_and_desk_categories_resolve_exactly():
    examples = (
        ("Dressers & chests of drawers", "dresser"),
        ("Bed frames with storage", "bed_frame"),
        ("MITTZON office desks", "desk"),
        ("Dining Tables", "dining_table"),
        ("Coffee Tables", "coffee_table"),
    )

    for category, expected_code in examples:
        result = normalize_product(_product(name="Observed category product", category=category))
        assert result.product.canonical_furniture_type_code == expected_code
        assert result.product.needs_taxonomy_review is False
        assert "taxonomy_review" not in result.review_reasons


def test_similar_unsupported_storage_category_remains_unresolved():
    result = normalize_product(_product(name="Observed category product", category="Dressers and storage combinations"))

    assert result.product.canonical_furniture_type_code is None
    assert result.product.needs_taxonomy_review is True
    assert "taxonomy_review" in result.review_reasons


def test_observed_rug_and_mirror_categories_resolve_exactly():
    examples = (
        ("Medium, large and extra-large rugs", "area_rug"),
        ("Large mirrors", "mirror"),
        ("Rugs", "area_rug"),
    )

    for category, expected_code in examples:
        result = normalize_product(_product(name="Observed category product", category=category))
        assert result.product.canonical_furniture_type_code == expected_code
        assert result.product.needs_taxonomy_review is False
        assert "taxonomy_review" not in result.review_reasons


def test_lighting_category_uses_explicit_product_name_identity_only():
    pendant = normalize_product(_product(name="Fila Pendant Lamp - Gray", category="Lighting"))
    floor = normalize_product(_product(name="Aria Floor Lamp", category="Lighting"))
    table = normalize_product(_product(name="Nara Table Lamp", category="Lighting"))
    broad = normalize_product(_product(name="Fila Gray Fixture", category="Lighting"))

    assert pendant.product.canonical_furniture_type_code == "pendant_chandelier"
    assert floor.product.canonical_furniture_type_code == "floor_lamp"
    assert table.product.canonical_furniture_type_code == "table_lamp"
    assert broad.product.canonical_furniture_type_code is None
    assert broad.product.needs_taxonomy_review is True


def test_sofa_with_chaise_refinement_still_overrides_broad_sofa_category():
    result = normalize_product(_product(name="Four seat sofa with chaise", category="Sofas"))

    assert result.product.canonical_furniture_type_code == "sofa_with_chaise"
    assert result.product.needs_taxonomy_review is False


def test_unknown_taxonomy_remains_unresolved_and_requires_review():
    product = _product(
        name="Mystery Relaxation Furniture",
        category="Unmapped Furniture Collection",
    )

    result = normalize_product(product)

    assert result.product.canonical_furniture_type_code is None
    assert result.product.needs_taxonomy_review is True
    assert "taxonomy_review" in result.review_reasons