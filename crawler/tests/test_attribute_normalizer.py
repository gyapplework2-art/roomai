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


def test_normalization_preserves_selected_source_and_all_evidence():
    product = CatalogProduct(
        vendor_market_code="US", source_product_name="Product name is not evidence", product_url="https://example.com/p",
        variants=[CatalogVariant(source_color="gray", source_material="Fabric")],
    )
    variant = normalize_product(product).product.variants[0]

    assert (variant.source_color, variant.normalized_color) == ("gray", "gray")
    assert (variant.source_material, variant.normalized_material) == ("Fabric", "fabric")
    assert variant.variant_attributes["attribute_evidence"]["color"][0]["source"] == "structured_data"


def test_third_vendor_uses_generic_normalization_without_adapter_or_inference():
    product = CatalogProduct(
        vendor_market_code="XX", source_product_name="Vendor X Sofa", product_url="https://example.com/x",
        variants=[CatalogVariant(source_color="Light Grey", source_material="Velvet")],
    )
    variant = normalize_product(product).product.variants[0]

    assert variant.normalized_color == "light_gray"
    assert variant.normalized_material == "velvet"
