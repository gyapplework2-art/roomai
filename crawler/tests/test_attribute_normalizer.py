import pytest

from crawler.core.attribute_normalizer import normalize_color, normalize_material, normalize_style
from crawler.core.evidence_resolution import AttributeCandidate, resolve_attribute, variant_attribute_candidates
from crawler.core.normalizer import normalize_product
from crawler.models.product import CatalogProduct, CatalogVariant


@pytest.mark.parametrize(
    ("source", "normalized"),
    [
        ("gray", "gray"), ("grey", "gray"), ("Light Gray", "light_gray"),
        ("Charme Tan", "tan"), ("Rain Cloud Gray", "gray"), ("Unmapped Merchandising", None),
    ],
)
def test_conservative_color_vocabulary(source: str, normalized: str | None):
    assert normalize_color(source) == normalized


@pytest.mark.parametrize(
    ("source", "normalized"),
    [
        ("Ivory", "ivory"), ("Off White", "off_white"), ("off-white", "off_white"),
        ("Warm   Beige", "warm_beige"), ("Oatmeal", "warm_beige"), ("Taupe", "taupe"),
        ("Charcoal", "charcoal"), ("Charcoal Gray", "charcoal"), ("Sage Green", "sage_green"),
        ("Olive Green", "olive_green"), ("Dark Green", "dark_green"), ("Navy Blue", "navy"),
        ("Terracotta", "terracotta"), ("Terra Cotta", "terracotta"), ("Burgundy", "burgundy"),
        ("Natural", "natural"), ("Vendor Charme Tan Performance Fabric", "tan"),
        ("Unmapped Merchandising", None),
    ],
)
def test_extended_color_vocabulary(source: str, normalized: str | None):
    assert normalize_color(source) == normalized


@pytest.mark.parametrize(
    ("source", "normalized"),
    [
        ("Fabric", "fabric"), ("Leather", "leather"), ("polyester fabric", "polyester"),
        ("Solid wood", "wood"), ("Steel", "steel"), ("wood and steel", None),
    ],
)
def test_conservative_material_vocabulary(source: str, normalized: str | None):
    assert normalize_material(source) == normalized


@pytest.mark.parametrize(
    ("source", "normalized"),
    [
        ("Boucle", "boucle"), ("Bouclé", "boucle"), ("Chenille", "chenille"),
        ("Microfiber", "microfiber"), ("Faux Leather", "faux_leather"),
        ("Vegan Leather", "vegan_leather"), ("Rattan", "rattan"), ("Wicker", "wicker"),
        ("Bamboo", "bamboo"), ("Oak", "oak"), ("Walnut", "walnut"),
        ("Acacia", "acacia"), ("Teak", "teak"), ("MDF", "mdf"),
        ("Particleboard", "particleboard"), ("Particle Board", "particleboard"),
        ("Plywood", "plywood"), ("Brass", "brass"), ("Iron", "iron"),
        ("Stainless   Steel", "stainless_steel"), ("Ceramic", "ceramic"),
        ("Stone", "stone"), ("Concrete", "concrete"), ("Unmapped Merchandising", None),
    ],
)
def test_extended_material_vocabulary(source: str, normalized: str | None):
    assert normalize_material(source) == normalized


@pytest.mark.parametrize("source", ["wood and steel", "oak & brass", "marble/metal"])
def test_composite_materials_are_not_collapsed(source: str):
    assert normalize_material(source) is None


@pytest.mark.parametrize(
    ("source", "normalized"),
    [
        ("modern", "modern"),
        ("contemporary", "contemporary"),
        ("mid_century_modern", "mid_century_modern"),
        ("traditional", "traditional"),
        ("transitional", "transitional"),
        ("scandinavian", "scandinavian"),
        ("minimalist", "minimalist"),
        ("industrial", "industrial"),
        ("farmhouse", "farmhouse"),
        ("rustic", "rustic"),
        ("coastal", "coastal"),
        ("bohemian", "bohemian"),
        ("art_deco", "art_deco"),
        ("glam", "glam"),
        ("classic", "classic"),
    ],
)
def test_style_canonical_vocabulary(source: str, normalized: str):
    assert normalize_style(source) == normalized


@pytest.mark.parametrize(
    ("source", "normalized"),
    [
        ("Mid Century Modern", "mid_century_modern"),
        ("mid-century modern", "mid_century_modern"),
        ("midcentury modern", "mid_century_modern"),
        ("  MID   CENTURY   MODERN  ", "mid_century_modern"),
        ("Scandi", "scandinavian"),
        ("minimal", "minimalist"),
        ("Boho", "bohemian"),
        ("Art Deco", "art_deco"),
        ("art-deco", "art_deco"),
        ("Glamorous", "glam"),
    ],
)
def test_style_supported_aliases_and_formatting(source: str, normalized: str):
    assert normalize_style(source) == normalized


@pytest.mark.parametrize(
    "source",
    [
        None,
        "",
        "Unmapped Merchandising",
        "modern comfort sofa",
        "contemporary looking",
        "modern contemporary",
        "Scandinavian Minimalist",
        "traditional/classic",
        "modern farmhouse",
        "rustic & industrial",
    ],
)
def test_style_unknown_and_ambiguous_values_are_not_collapsed(source: str | None):
    assert normalize_style(source) is None


def test_structured_data_beats_labeled_html_and_url_evidence_with_conflict_review():
    candidates = variant_attribute_candidates(
        "gray", None, {"ikea_labeled_attributes": {"Color": "beige"}},
        {"color": [{"value": "tan", "source": "vendor_url_slug", "method": "deterministic"}]},
    )
    resolved = resolve_attribute(candidates["color"])

    assert resolved.selected is not None
    assert resolved.selected.value == "gray"
    assert "attribute_conflict:color" in resolved.review_reasons


def test_labeled_html_beats_url_evidence_when_structured_fact_is_absent():
    candidates = variant_attribute_candidates(
        None, None, {"ikea_labeled_attributes": {"Color": "Warm Beige"}},
        {"color": [{"value": "tan", "source": "vendor_url_slug", "method": "deterministic"}]},
    )
    assert resolve_attribute(candidates["color"]).selected.value == "Warm Beige"


def test_explicit_structured_style_normalizes_and_preserves_selected_source():
    product = CatalogProduct(
        vendor_market_code="US", source_product_name="Sofa", product_url="https://example.com/p",
        variants=[CatalogVariant(source_style="Mid-Century Modern")],
    )
    result = normalize_product(product)
    variant = result.product.variants[0]

    assert variant.source_style == "Mid-Century Modern"
    assert variant.normalized_style == "mid_century_modern"
    assert "unknown_style" not in result.review_reasons
    assert variant.variant_attributes["attribute_evidence"]["style"] == [
        {
            "concept": "style",
            "value": "Mid-Century Modern",
            "source": "structured_data",
            "priority": 2,
            "method": "deterministic",
            "selected": True,
        }
    ]


def test_labeled_style_is_selected_when_structured_style_is_absent():
    product = CatalogProduct(
        vendor_market_code="US", source_product_name="Sofa", product_url="https://example.com/p",
        variants=[CatalogVariant(variant_attributes={"ikea_labeled_attributes": {"Style": "Scandi"}})],
    )
    variant = normalize_product(product).product.variants[0]

    assert variant.source_style == "Scandi"
    assert variant.normalized_style == "scandinavian"
    assert variant.variant_attributes["attribute_evidence"]["style"][0]["source"] == "labeled_html"


def test_structured_style_beats_labeled_style_and_records_conflict():
    product = CatalogProduct(
        vendor_market_code="US", source_product_name="Sofa", product_url="https://example.com/p",
        variants=[CatalogVariant(
            source_style="Traditional",
            variant_attributes={"ikea_labeled_attributes": {"Design Style": "Contemporary"}},
        )],
    )
    result = normalize_product(product)
    variant = result.product.variants[0]
    style_evidence = variant.variant_attributes["attribute_evidence"]["style"]

    assert variant.source_style == "Traditional"
    assert variant.normalized_style == "traditional"
    assert "attribute_conflict:style" in result.review_reasons
    assert [candidate["source"] for candidate in style_evidence] == ["structured_data", "labeled_html"]
    assert [candidate["selected"] for candidate in style_evidence] == [True, False]


def test_unknown_explicit_style_is_preserved_and_reviewed():
    product = CatalogProduct(
        vendor_market_code="US", source_product_name="Sofa", product_url="https://example.com/p",
        variants=[CatalogVariant(source_style="Museum Archive")],
    )
    result = normalize_product(product)
    variant = result.product.variants[0]

    assert variant.source_style == "Museum Archive"
    assert variant.normalized_style is None
    assert "unknown_style" in result.review_reasons


def test_missing_style_evidence_does_not_add_unknown_style():
    product = CatalogProduct(
        vendor_market_code="US", source_product_name="Modern name is not style evidence", product_url="https://example.com/p",
        variants=[CatalogVariant()],
    )
    result = normalize_product(product)
    variant = result.product.variants[0]

    assert variant.source_style is None
    assert variant.normalized_style is None
    assert "unknown_style" not in result.review_reasons
    assert variant.variant_attributes["attribute_evidence"]["style"] == []


def test_normalization_initializes_empty_normalized_attributes_without_inference():
    product = CatalogProduct(
        vendor_market_code="US", source_product_name="Modern name is not attribute evidence", product_url="https://example.com/p",
        variants=[CatalogVariant(variant_attributes={
            "article_attributes": {"Frame Material": "Solid wood"},
            "ikea_labeled_attributes": {"Seat cushion": "Foam"},
        })],
    )
    variant = normalize_product(product).product.variants[0]

    assert variant.variant_attributes["normalized_attributes"] == {}
    assert variant.variant_attributes["article_attributes"] == {"Frame Material": "Solid wood"}
    assert variant.variant_attributes["ikea_labeled_attributes"] == {"Seat cushion": "Foam"}
    assert variant.source_color is None
    assert variant.normalized_color is None
    assert variant.source_material is None
    assert variant.normalized_material is None
    assert variant.source_style is None
    assert variant.normalized_style is None


def test_existing_normalized_attributes_dict_is_preserved_for_future_facts():
    product = CatalogProduct(
        vendor_market_code="US", source_product_name="Sofa", product_url="https://example.com/p",
        variants=[CatalogVariant(variant_attributes={"normalized_attributes": {"washable": True}})],
    )
    variant = normalize_product(product).product.variants[0]

    assert variant.variant_attributes["normalized_attributes"] == {"washable": True}


def test_normalization_preserves_selected_source_and_all_evidence():
    product = CatalogProduct(
        vendor_market_code="US", source_product_name="Product name is not evidence", product_url="https://example.com/p",
        variants=[CatalogVariant(source_color="gray", source_material="Fabric")],
    )
    variant = normalize_product(product).product.variants[0]

    assert (variant.source_color, variant.normalized_color) == ("gray", "gray")
    assert (variant.source_material, variant.normalized_material) == ("Fabric", "fabric")
    assert (variant.source_style, variant.normalized_style) == (None, None)
    assert variant.variant_attributes["normalized_attributes"] == {}
    assert variant.variant_attributes["attribute_evidence"]["color"][0]["source"] == "structured_data"
    assert variant.variant_attributes["attribute_evidence"]["material"][0]["source"] == "structured_data"
    assert variant.variant_attributes["attribute_evidence"]["style"] == []


def test_third_vendor_uses_generic_normalization_without_adapter_or_inference():
    product = CatalogProduct(
        vendor_market_code="XX", source_product_name="Vendor X Sofa", product_url="https://example.com/x",
        variants=[CatalogVariant(source_color="Light Grey", source_material="Velvet")],
    )
    variant = normalize_product(product).product.variants[0]

    assert variant.normalized_color == "light_gray"
    assert variant.normalized_material == "velvet"
