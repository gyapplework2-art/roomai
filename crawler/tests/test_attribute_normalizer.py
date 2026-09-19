from datetime import datetime, timezone
from pathlib import Path

import pytest

from crawler.core.attribute_normalizer import normalize_boolean, normalize_color, normalize_cushion_fill, normalize_material, normalize_style
from crawler.core.evidence_resolution import AttributeCandidate, resolve_attribute, variant_attribute_candidates
from crawler.core.normalizer import normalize_product
from crawler.models.product import CatalogProduct, CatalogVariant
from crawler.vendors.article import ArticleVendorAdapter
from crawler.vendors.ikea import IkeaVendorAdapter


FIXTURES = Path(__file__).parent / "fixtures"


def _article_fixture(name: str) -> CatalogProduct:
    return ArticleVendorAdapter().parse_product(
        (FIXTURES / "article" / name).read_text(),
        "https://example.com/article/requested-url",
        datetime(2026, 9, 17, tzinfo=timezone.utc),
    )


def _ikea_fixture(name: str) -> CatalogProduct:
    return IkeaVendorAdapter().parse_product(
        (FIXTURES / "ikea" / name).read_text(),
        "https://example.com/us/en/p/hyltarp-sofa-hallarp-white-s39489645",
        datetime(2026, 9, 18, tzinfo=timezone.utc),
    )


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
        ("Solid wood", "wood"), ("Steel", "steel"), ("Full-aniline leather", "leather"),
        ("Performance Velvet", "velvet"), ("wood and steel", None),
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


@pytest.mark.parametrize("source", ["Solid wood, particleboard, plywood", "80 % cotton, 20 % polyester"])
def test_comma_separated_material_lists_are_not_collapsed(source: str):
    assert normalize_material(source) is None


@pytest.mark.parametrize(
    ("source", "normalized"),
    [("Foam", "foam"), ("Foam and fiber", "foam_and_fiber"), ("Pocket springs and foam", "pocket_springs_and_foam"), ("Unknown fill", None)],
)
def test_cushion_fill_normalization(source: str, normalized: str | None):
    assert normalize_cushion_fill(source) == normalized


@pytest.mark.parametrize(("source", "normalized"), [("Yes", True), ("No", False), ("true", True), ("false", False), ("Maybe", None), (None, None)])
def test_boolean_normalization_does_not_invent_missing_false(source: str | None, normalized: bool | None):
    assert normalize_boolean(source) is normalized


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


def test_article_leather_fixture_populates_supported_design_attributes_and_preserves_raw_values():
    product = _article_fixture("rich_leather_sofa.html").model_copy(update={"source_category": "Sofas"})
    raw_attributes = product.variants[0].variant_attributes["article_attributes"]
    variant = normalize_product(product).product.variants[0]

    assert variant.variant_attributes["normalized_attributes"] == {
        "upholstery": "leather",
        "frame_material": "wood",
        "cushion_fill": "foam_and_fiber",
        "assembly_required": False,
    }
    assert variant.variant_attributes["article_attributes"] == raw_attributes == {
        "Leather Color": "Cognac",
        "Upholstery Material": "Full-aniline leather",
        "Frame Material": "Solid wood",
        "Cushion Fill": "Foam and fiber",
        "Assembly Required": "No",
    }


def test_article_performance_basketweave_upholstery_uses_material_vocabulary_without_changing_first_class_material():
    product = _article_fixture("rich_fabric_sofa.html").model_copy(update={"source_category": "Sofas"})
    variant = normalize_product(product).product.variants[0]

    assert variant.variant_attributes["normalized_attributes"]["upholstery"] == "fabric"
    assert (variant.source_material, variant.normalized_material) == ("Performance Basketweave", "fabric")


def test_ikea_seat_cushion_populates_fill_but_composite_material_lists_are_omitted():
    product = _ikea_fixture("hyltarp_sofa.html").model_copy(update={"source_category": "Sofas"})
    raw_attributes = product.variants[0].variant_attributes["ikea_labeled_attributes"]
    variant = normalize_product(product).product.variants[0]

    assert variant.variant_attributes["normalized_attributes"] == {
        "cushion_fill": "pocket_springs_and_foam",
    }
    assert "frame_material" not in variant.variant_attributes["normalized_attributes"]
    assert "upholstery" not in variant.variant_attributes["normalized_attributes"]
    assert variant.variant_attributes["ikea_labeled_attributes"] == raw_attributes == {
        "Frame": "Solid wood, particleboard, plywood",
        "Seat cushion": "Pocket springs and foam",
        "Fabric": "80 % cotton, 20 % polyester",
        "Leg": "Solid wood",
    }


def test_unknown_and_missing_design_attributes_are_omitted_without_false_defaults():
    product = CatalogProduct(
        vendor_market_code="US", source_product_name="Sofa", source_category="Sofas", product_url="https://example.com/p",
        variants=[CatalogVariant(variant_attributes={"article_attributes": {
            "Upholstery Material": "Mystery textile",
            "Frame Material": "Unknown frame",
            "Cushion Fill": "Clouds",
            "Assembly Required": "Sometimes",
        }})],
    )
    variant = normalize_product(product).product.variants[0]

    assert variant.variant_attributes["normalized_attributes"] == {}


def test_existing_normalized_attributes_entries_are_preserved_when_design_facts_are_added():
    product = CatalogProduct(
        vendor_market_code="US", source_product_name="Sofa", source_category="Sofas", product_url="https://example.com/p",
        variants=[CatalogVariant(variant_attributes={
            "normalized_attributes": {"washable": True},
            "article_attributes": {"Frame Material": "Solid wood"},
        })],
    )
    variant = normalize_product(product).product.variants[0]

    assert variant.variant_attributes["normalized_attributes"] == {"washable": True, "frame_material": "wood"}


def test_design_attributes_require_applicability_to_resolved_furniture_type():
    product = CatalogProduct(
        vendor_market_code="US", source_product_name="Area rug", source_category="Area rugs", product_url="https://example.com/p",
        variants=[CatalogVariant(variant_attributes={"article_attributes": {"Upholstery Material": "Leather", "Assembly Required": "No"}})],
    )
    variant = normalize_product(product).product.variants[0]

    assert variant.variant_attributes["normalized_attributes"] == {}


def test_design_attributes_are_not_inferred_from_name_description_features_url_or_absence():
    product = CatalogProduct(
        vendor_market_code="US",
        source_product_name="Leather sofa with foam fill and no assembly required",
        source_category="Sofas",
        source_description="Solid wood frame with removable upholstery.",
        source_features=["Foam and fiber cushions", "Assembly required: no"],
        product_url="https://example.com/products/leather-solid-wood-foam-sofa",
        variants=[CatalogVariant()],
    )
    variant = normalize_product(product).product.variants[0]

    assert variant.variant_attributes["normalized_attributes"] == {}


@pytest.mark.parametrize(
    ("category", "attributes", "expected"),
    [
        ("Dining tables", {"Table top": "Oak"}, {"tabletop_material": "oak"}),
        ("Coffee tables", {"Top": "Walnut"}, {"tabletop_material": "walnut"}),
        ("Dining tables", {"Leg": "Solid wood"}, {"base_material": "wood"}),
        ("Dining tables", {"Tabletop Material": "Oak", "Base Material": "Steel"}, {"tabletop_material": "oak", "base_material": "steel"}),
    ],
)
def test_table_component_materials_normalize_from_explicit_applicable_labels(category: str, attributes: dict[str, str], expected: dict[str, str]):
    product = CatalogProduct(
        vendor_market_code="US", source_product_name="Table", source_category=category, product_url="https://example.com/p",
        variants=[CatalogVariant(variant_attributes={"article_attributes": attributes})],
    )
    variant = normalize_product(product).product.variants[0]

    assert variant.variant_attributes["normalized_attributes"] == expected
    assert variant.variant_attributes["article_attributes"] == attributes


@pytest.mark.parametrize(
    "attributes",
    [
        {
            "Top": "Fiberboard, Walnut veneer, Clear acrylic lacquer, Paper foil, Stain",
            "Leg": "Solid walnut, Clear acrylic lacquer",
        },
        {
            "Table top": "Solid acacia wood, Clear acrylic lacquer, Clear lacquer",
            "Leg/ Rail": "Solid acacia wood, Acrylic paint",
            "Bracket": "Steel, Galvanized",
        },
    ],
)
def test_table_component_composites_and_ambiguous_labels_are_not_collapsed(attributes: dict[str, str]):
    product = CatalogProduct(
        vendor_market_code="US", source_product_name="Dining table", source_category="Dining tables", product_url="https://example.com/p",
        variants=[CatalogVariant(variant_attributes={"ikea_labeled_attributes": attributes})],
    )
    variant = normalize_product(product).product.variants[0]

    assert "tabletop_material" not in variant.variant_attributes["normalized_attributes"]
    assert "base_material" not in variant.variant_attributes["normalized_attributes"]
    assert variant.variant_attributes["ikea_labeled_attributes"] == attributes


def test_table_component_materials_require_applicable_furniture_type():
    attributes = {"Table top": "Oak", "Leg": "Steel"}
    product = CatalogProduct(
        vendor_market_code="US", source_product_name="Sofa", source_category="Sofas", product_url="https://example.com/p",
        variants=[CatalogVariant(variant_attributes={"ikea_labeled_attributes": attributes})],
    )
    variant = normalize_product(product).product.variants[0]

    assert variant.variant_attributes["normalized_attributes"] == {}
    assert variant.variant_attributes["ikea_labeled_attributes"] == attributes


@pytest.mark.parametrize("name", ["STORKLINTA 6-Drawer Dresser", "STORKLINTA 6 Drawer Dresser"])
def test_dresser_identity_drawer_count_requires_explicit_drawer_wording(name: str):
    product = CatalogProduct(
        vendor_market_code="US", source_product_name=name, source_category="Dressers", product_url="https://example.com/p",
        variants=[CatalogVariant()],
    )
    variant = normalize_product(product).product.variants[0]

    assert variant.variant_attributes["normalized_attributes"] == {"drawer_count": 6}
    assert normalize_product(product).product.source_product_name == name


def test_dresser_identity_does_not_extract_unrelated_numbers_or_inapplicable_types():
    unrelated_number = CatalogProduct(
        vendor_market_code="US", source_product_name="STORKLINTA 6 wide dresser", source_category="Dressers", product_url="https://example.com/p",
        variants=[CatalogVariant()],
    )
    inapplicable = CatalogProduct(
        vendor_market_code="US", source_product_name="STORKLINTA 6-Drawer Dresser", source_category="Sofas", product_url="https://example.com/p",
        variants=[CatalogVariant()],
    )

    assert normalize_product(unrelated_number).product.variants[0].variant_attributes["normalized_attributes"] == {}
    assert normalize_product(inapplicable).product.variants[0].variant_attributes["normalized_attributes"] == {}


@pytest.mark.parametrize(
    ("name", "expected"),
    [
        ("BRIMNES Queen bed frame", {"bed_size": "queen"}),
        ("BRIMNES Twin XL bed frame", {"bed_size": "twin_xl"}),
        ("BRIMNES California King bed frame", {"bed_size": "california_king"}),
        ("BRIMNES Queen bed frame with storage", {"bed_size": "queen", "storage_type": "integrated_storage"}),
        ("BRIMNES Queen bed frame with headboard", {"bed_size": "queen", "headboard": True}),
        ("BRIMNES Queen bed frame with storage and headboard", {"bed_size": "queen", "storage_type": "integrated_storage", "headboard": True}),
    ],
)
def test_bed_frame_identity_attributes_from_explicit_product_name(name: str, expected: dict[str, object]):
    product = CatalogProduct(
        vendor_market_code="US", source_product_name=name, source_category="Beds", product_url="https://example.com/p",
        variants=[CatalogVariant()],
    )
    variant = normalize_product(product).product.variants[0]

    assert variant.variant_attributes["normalized_attributes"] == expected
    assert "headboard" not in normalize_product(CatalogProduct(
        vendor_market_code="US", source_product_name="BRIMNES Queen bed frame", source_category="Beds", product_url="https://example.com/p",
        variants=[CatalogVariant()],
    )).product.variants[0].variant_attributes["normalized_attributes"]


@pytest.mark.parametrize("name", ["MITTZON Desk sit/stand", "MITTZON Sit-stand desk", "MITTZON Sit stand desk"])
def test_desk_identity_sit_stand_from_explicit_product_name(name: str):
    product = CatalogProduct(
        vendor_market_code="US", source_product_name=name, source_category="Desks", product_url="https://example.com/p",
        variants=[CatalogVariant()],
    )
    variant = normalize_product(product).product.variants[0]

    assert variant.variant_attributes["normalized_attributes"] == {"sit_stand": True}


def test_ordinary_desk_and_cable_management_label_do_not_create_sit_stand_or_cable_management():
    product = CatalogProduct(
        vendor_market_code="US", source_product_name="MITTZON Desk", source_category="Desks", product_url="https://example.com/p",
        variants=[CatalogVariant(variant_attributes={"ikea_labeled_attributes": {"Cable management": "Felt"}})],
    )
    variant = normalize_product(product).product.variants[0]

    assert variant.variant_attributes["normalized_attributes"] == {}
    assert variant.variant_attributes["ikea_labeled_attributes"] == {"Cable management": "Felt"}


def test_identity_attributes_ignore_descriptions_features_and_urls():
    products = (
        CatalogProduct(
            vendor_market_code="US", source_product_name="STORKLINTA Dresser", source_category="Dressers",
            source_description="6 drawers", product_url="https://example.com/p", variants=[CatalogVariant()],
        ),
        CatalogProduct(
            vendor_market_code="US", source_product_name="BRIMNES Bed frame", source_category="Beds",
            source_description="Queen with storage and headboard", product_url="https://example.com/p", variants=[CatalogVariant()],
        ),
        CatalogProduct(
            vendor_market_code="US", source_product_name="MITTZON Desk", source_category="Desks",
            source_description="sit stand", product_url="https://example.com/p", variants=[CatalogVariant()],
        ),
        CatalogProduct(
            vendor_market_code="US", source_product_name="BRIMNES Bed frame", source_category="Beds",
            source_features=["Queen", "with storage", "with headboard"], product_url="https://example.com/p", variants=[CatalogVariant()],
        ),
        CatalogProduct(
            vendor_market_code="US", source_product_name="BRIMNES Bed frame", source_category="Beds",
            product_url="https://example.com/queen-bed-frame-with-storage-headboard", variants=[CatalogVariant()],
        ),
    )

    assert all(normalize_product(product).product.variants[0].variant_attributes["normalized_attributes"] == {} for product in products)


def test_identity_attributes_preserve_existing_entries_and_labeled_normalization_still_works():
    with_existing = CatalogProduct(
        vendor_market_code="US", source_product_name="STORKLINTA 6 Drawer Dresser", source_category="Dressers", product_url="https://example.com/p",
        variants=[CatalogVariant(variant_attributes={"normalized_attributes": {"washable": True}})],
    )
    with_labeled = CatalogProduct(
        vendor_market_code="US", source_product_name="Sofa", source_category="Sofas", product_url="https://example.com/p",
        variants=[CatalogVariant(variant_attributes={"article_attributes": {"Frame Material": "Solid wood"}})],
    )

    assert normalize_product(with_existing).product.variants[0].variant_attributes["normalized_attributes"] == {"washable": True, "drawer_count": 6}
    assert normalize_product(with_labeled).product.variants[0].variant_attributes["normalized_attributes"] == {"frame_material": "wood"}


def test_observed_ikea_storklinta_identity_drawer_count_ignores_component_materials():
    attributes = {
        "Drawer side/ Drawer back": "Particleboard, Plastic foil, Paper foil",
        "Back panel": "Fiberboard",
    }
    product = CatalogProduct(
        vendor_market_code="US",
        source_product_name='STORKLINTA 6-drawer dresser - white/anchor/unlock function 55 1/8x18 7/8x29 1/2 "',
        source_category="Dressers & chests of drawers",
        product_url="https://example.com/products/storklinta-6-drawer-dresser",
        variants=[CatalogVariant(variant_attributes={"ikea_labeled_attributes": attributes})],
    )
    variant = normalize_product(product).product.variants[0]

    assert variant.variant_attributes["normalized_attributes"] == {"drawer_count": 6}
    assert variant.variant_attributes["ikea_labeled_attributes"] == attributes


def test_observed_ikea_brimnes_identity_storage_headboard_ignores_material_labels_and_description_drawers():
    attributes = {
        "Frame/ Fixed shelf/ Adjustable shelf/ Partition/ Back/ Top panel/ Side panel": "Particleboard, Paper foil",
    }
    product = CatalogProduct(
        vendor_market_code="US",
        source_product_name="BRIMNES Bed frame with storage & headboard - white Queen",
        source_category="Bed frames with storage",
        source_description="Four large drawers give you extra storage under the bed.",
        source_features=["Adjustable shelves", "Large drawers"],
        product_url="https://example.com/products/brimnes-storage-bed-headboard",
        variants=[CatalogVariant(variant_attributes={"ikea_labeled_attributes": attributes})],
    )
    variant = normalize_product(product).product.variants[0]

    assert variant.variant_attributes["normalized_attributes"] == {
        "bed_size": "queen",
        "storage_type": "integrated_storage",
        "headboard": True,
    }
    assert "adjustable_shelves" not in variant.variant_attributes["normalized_attributes"]
    assert "shelf_count" not in variant.variant_attributes["normalized_attributes"]
    assert "drawer_count" not in variant.variant_attributes["normalized_attributes"]
    assert variant.variant_attributes["ikea_labeled_attributes"] == attributes


def test_observed_ikea_mittzon_identity_sit_stand_ignores_cable_management_label_and_description():
    attributes = {"Cable management/ Cable management:": "Felt"}
    product = CatalogProduct(
        vendor_market_code="US",
        source_product_name='MITTZON Desk sit/stand - electric white 47 1/4x23 5/8 "',
        source_category="MITTZON office desks",
        source_description="Transition smoothly between sitting and standing during the work day.",
        source_features=["Cable management"],
        product_url="https://example.com/products/mittzon-electric-desk",
        variants=[CatalogVariant(variant_attributes={"ikea_labeled_attributes": attributes})],
    )
    variant = normalize_product(product).product.variants[0]

    assert variant.variant_attributes["normalized_attributes"] == {"sit_stand": True}
    assert "cable_management" not in variant.variant_attributes["normalized_attributes"]
    assert "adjustable_height" not in variant.variant_attributes["normalized_attributes"]
    assert variant.variant_attributes["ikea_labeled_attributes"] == attributes


def test_observed_article_nera_identity_drawer_count_handles_trailing_category_space():
    product = CatalogProduct(
        vendor_market_code="US",
        source_product_name="Nera 6-Drawer Double Dresser - Oak",
        source_category="Dressers ",
        source_description="A storage-forward bedroom piece.",
        product_url="https://example.com/products/nera-6-drawer-double-dresser",
        variants=[CatalogVariant()],
    )
    normalized = normalize_product(product).product

    assert normalized.source_product_name == "Nera 6-Drawer Double Dresser - Oak"
    assert normalized.variants[0].variant_attributes["normalized_attributes"] == {"drawer_count": 6}


def test_observed_article_lenia_bed_size_does_not_use_description_headboard():
    product = CatalogProduct(
        vendor_market_code="US",
        source_product_name="Lenia Queen Panel Bed - White Oak",
        source_category="Beds",
        source_description="A panel headboard creates a quiet bedroom focal point.",
        product_url="https://example.com/products/lenia-queen-panel-bed",
        variants=[CatalogVariant()],
    )
    variant = normalize_product(product).product.variants[0]

    assert variant.variant_attributes["normalized_attributes"] == {"bed_size": "queen"}
    assert "headboard" not in variant.variant_attributes["normalized_attributes"]


def test_observed_article_madera_ordinary_desk_does_not_gain_missing_feature_booleans_or_counts():
    product = CatalogProduct(
        vendor_market_code="US",
        source_product_name='Madera 54" Desk - Oak',
        source_category="Desks",
        source_description="A writing desk with generous workspace.",
        source_features=["Cable pass-through", "Oak veneer"],
        product_url="https://example.com/products/madera-54-desk-oak",
        variants=[CatalogVariant()],
    )
    variant = normalize_product(product).product.variants[0]

    assert variant.variant_attributes["normalized_attributes"] == {}
    assert "sit_stand" not in variant.variant_attributes["normalized_attributes"]
    assert "cable_management" not in variant.variant_attributes["normalized_attributes"]
    assert "adjustable_height" not in variant.variant_attributes["normalized_attributes"]
    assert "drawer_count" not in variant.variant_attributes["normalized_attributes"]
    assert "shelf_count" not in variant.variant_attributes["normalized_attributes"]


def test_observed_table_lamp_shade_glass_and_dimmable_identity_are_normalized():
    attributes = {"Base:": "Steel, Powder coating", "Shade:": "Glass"}
    product = CatalogProduct(
        vendor_market_code="US",
        source_product_name='TÄRNABY Table lamp - dimmable beige 10 "',
        source_category="Table lamps",
        product_url="https://example.com/products/tarnaby-table-lamp",
        variants=[CatalogVariant(variant_attributes={"ikea_labeled_attributes": attributes})],
    )
    variant = normalize_product(product).product.variants[0]

    assert variant.variant_attributes["normalized_attributes"] == {"dimmable": True, "shade_material": "glass"}
    assert "base_material" not in variant.variant_attributes["normalized_attributes"]
    assert variant.variant_attributes["ikea_labeled_attributes"] == attributes


def test_observed_pendant_lamp_bulb_count_and_shade_material_ignore_description_only_facts():
    attributes = {"Shade:": "Glass", "Lamp house:": "Steel"}
    product = CatalogProduct(
        vendor_market_code="US",
        source_product_name='KRANSALG Pendant lamp with 5 lights - black 44 "',
        source_category="Pendant lights",
        source_description="Uses GU10 bulbs with adjustable height and directed light.",
        source_features=["GU10", "adjustable height", "directed light"],
        product_url="https://example.com/products/kransalg-pendant-lamp-5-lights",
        variants=[CatalogVariant(variant_attributes={"ikea_labeled_attributes": attributes})],
    )
    variant = normalize_product(product).product.variants[0]

    assert variant.variant_attributes["normalized_attributes"] == {"bulb_count": 5, "shade_material": "glass"}
    assert "bulb_base" not in variant.variant_attributes["normalized_attributes"]
    assert "bulb_type" not in variant.variant_attributes["normalized_attributes"]
    assert "adjustable_drop" not in variant.variant_attributes["normalized_attributes"]
    assert "light_direction" not in variant.variant_attributes["normalized_attributes"]
    assert variant.variant_attributes["ikea_labeled_attributes"] == attributes


def test_observed_floor_lamp_polyester_shade_is_preserved_but_unresolved_conservatively():
    attributes = {
        "Shade:": "100% polyester (min. 90% recycled)",
        "Upper tube/ Lower tube/ Base:": "Solid ash, Acrylic stain",
    }
    product = CatalogProduct(
        vendor_market_code="US",
        source_product_name="KINNAHULT Floor lamp",
        source_category="Floor lamps",
        product_url="https://example.com/products/kinnahult-floor-lamp",
        variants=[CatalogVariant(variant_attributes={"ikea_labeled_attributes": attributes})],
    )
    variant = normalize_product(product).product.variants[0]

    assert variant.variant_attributes["normalized_attributes"] == {}
    assert "shade_material" not in variant.variant_attributes["normalized_attributes"]
    assert "base_material" not in variant.variant_attributes["normalized_attributes"]
    assert variant.variant_attributes["ikea_labeled_attributes"] == attributes


def test_ordinary_lamp_name_and_unrelated_numbers_do_not_create_lighting_defaults():
    product = CatalogProduct(
        vendor_market_code="US",
        source_product_name='KINNAHULT Floor lamp 47 1/4 "',
        source_category="Floor lamps",
        product_url="https://example.com/products/kinnahult-floor-lamp-47",
        variants=[CatalogVariant()],
    )
    variant = normalize_product(product).product.variants[0]

    assert variant.variant_attributes["normalized_attributes"] == {}
    assert "dimmable" not in variant.variant_attributes["normalized_attributes"]
    assert "bulb_count" not in variant.variant_attributes["normalized_attributes"]


def test_lighting_description_only_facts_do_not_create_normalized_attributes():
    product = CatalogProduct(
        vendor_market_code="US",
        source_product_name="KRANSALG Pendant lamp",
        source_category="Pendant lights",
        source_description="Dimmable with 5 lights, GU10 bulbs, adjustable height, and directed light.",
        source_features=["dimmable", "5 lights", "GU10", "adjustable height", "directed light"],
        product_url="https://example.com/products/kransalg-pendant-lamp-with-5-lights-dimmable-gu10",
        variants=[CatalogVariant()],
    )
    variant = normalize_product(product).product.variants[0]

    assert variant.variant_attributes["normalized_attributes"] == {}


def test_shade_label_requires_applicable_lighting_furniture_type():
    attributes = {"Shade:": "Glass"}
    product = CatalogProduct(
        vendor_market_code="US", source_product_name="Sofa", source_category="Sofas", product_url="https://example.com/p",
        variants=[CatalogVariant(variant_attributes={"ikea_labeled_attributes": attributes})],
    )
    variant = normalize_product(product).product.variants[0]

    assert variant.variant_attributes["normalized_attributes"] == {}
    assert variant.variant_attributes["ikea_labeled_attributes"] == attributes


def test_observed_tiphede_rug_flatwoven_identity_sets_construction_only():
    product = CatalogProduct(
        vendor_market_code="US",
        source_product_name='TIPHEDE Rug, flatwoven - natural/black 7 \' 3 "x9 \' 2 "',
        source_category="Medium, large and extra-large rugs",
        source_description="A flat-woven cotton rug that is machine washable.",
        source_features=["machine wash", "cotton"],
        product_url="https://example.com/products/tiphede-rug-flatwoven-washable",
        variants=[CatalogVariant()],
    )
    variant = normalize_product(product).product.variants[0]

    assert variant.variant_attributes["normalized_attributes"] == {"construction": "flatwoven"}
    assert "washable" not in variant.variant_attributes["normalized_attributes"]
    assert "indoor_outdoor" not in variant.variant_attributes["normalized_attributes"]
    assert "pile_type" not in variant.variant_attributes["normalized_attributes"]


def test_hyphenated_flat_woven_rug_identity_sets_construction():
    product = CatalogProduct(
        vendor_market_code="US", source_product_name="Flat-woven Rug", source_category="Rugs", product_url="https://example.com/p",
        variants=[CatalogVariant()],
    )
    variant = normalize_product(product).product.variants[0]

    assert variant.variant_attributes["normalized_attributes"] == {"construction": "flatwoven"}


def test_observed_texa_rug_description_only_construction_and_pile_are_ignored():
    product = CatalogProduct(
        vendor_market_code="US",
        source_product_name="Texa 8 x 10 Rug - Vanilla Ivory",
        source_category="Rugs",
        source_description="A hand-woven wool rug with a tightly looped surface.",
        product_url="https://example.com/products/texa-8-x-10-rug",
        variants=[CatalogVariant()],
    )
    variant = normalize_product(product).product.variants[0]

    assert variant.variant_attributes["normalized_attributes"] == {}
    assert "construction" not in variant.variant_attributes["normalized_attributes"]
    assert "pile_type" not in variant.variant_attributes["normalized_attributes"]


def test_rug_description_only_flat_woven_and_washable_are_ignored():
    product = CatalogProduct(
        vendor_market_code="US",
        source_product_name="TIPHEDE Rug",
        source_category="Rugs",
        source_description="This flat-woven rug is machine washable.",
        product_url="https://example.com/products/tiphede-rug-flatwoven-washable",
        variants=[CatalogVariant()],
    )
    variant = normalize_product(product).product.variants[0]

    assert variant.variant_attributes["normalized_attributes"] == {}


def test_flatwoven_identity_requires_area_rug_applicability():
    product = CatalogProduct(
        vendor_market_code="US", source_product_name="Flatwoven Sofa", source_category="Sofas", product_url="https://example.com/p",
        variants=[CatalogVariant()],
    )
    variant = normalize_product(product).product.variants[0]

    assert variant.variant_attributes["normalized_attributes"] == {}


def test_rug_identity_preserves_existing_normalized_attributes():
    product = CatalogProduct(
        vendor_market_code="US", source_product_name="Flatwoven Rug", source_category="Rugs", product_url="https://example.com/p",
        variants=[CatalogVariant(variant_attributes={"normalized_attributes": {"washable": True}})],
    )
    variant = normalize_product(product).product.variants[0]

    assert variant.variant_attributes["normalized_attributes"] == {"washable": True, "construction": "flatwoven"}


def test_article_rug_pile_specification_normalizes_height_and_type_without_mutating_raw_value():
    raw_value = '1/2" - Medium'
    product = CatalogProduct(
        vendor_market_code="US",
        source_product_name="Texa 8 x 10 Rug - Vanilla Ivory",
        source_category="Rugs",
        product_url="https://example.com/article/product/1834/texa-rug",
        variants=[CatalogVariant(variant_attributes={"article_html_specifications": {"Pile": raw_value}})],
    )
    normalized = normalize_product(product).product.variants[0]

    assert normalized.variant_attributes["normalized_attributes"] == {"pile_height": 1.27, "pile_type": "medium"}
    assert normalized.variant_attributes["article_html_specifications"]["Pile"] == raw_value


def test_article_rug_pile_specification_requires_rug_applicability():
    product = CatalogProduct(
        vendor_market_code="US",
        source_product_name="Sofa",
        source_category="Sofas",
        product_url="https://example.com/sofa",
        variants=[CatalogVariant(variant_attributes={"article_html_specifications": {"Pile": '1/2" - Medium'}})],
    )
    normalized = normalize_product(product).product.variants[0]

    assert "pile_height" not in normalized.variant_attributes["normalized_attributes"]
    assert "pile_type" not in normalized.variant_attributes["normalized_attributes"]


@pytest.mark.parametrize("value", ['Medium', '1/2" - High', '1/2" Medium', 'wool - Medium'])
def test_malformed_or_unsupported_pile_specifications_remain_unresolved(value: str):
    product = CatalogProduct(
        vendor_market_code="US", source_product_name="Rug", source_category="Rugs", product_url="https://example.com/rug",
        variants=[CatalogVariant(variant_attributes={"article_html_specifications": {"Pile": value}})],
    )
    normalized = normalize_product(product).product.variants[0]

    assert "pile_height" not in normalized.variant_attributes["normalized_attributes"]
    assert "pile_type" not in normalized.variant_attributes["normalized_attributes"]


def test_article_core_html_labels_do_not_become_pile_design_attributes():
    product = CatalogProduct(
        vendor_market_code="US", source_product_name="Rug", source_category="Rugs", product_url="https://example.com/rug",
        variants=[CatalogVariant(variant_attributes={
            "article_html_specifications": {"Color": "Vanilla Ivory", "Materials": "70% wool, 30% viscose", "Style": "Coastal"},
        })],
    )
    normalized = normalize_product(product).product.variants[0]

    assert "pile_height" not in normalized.variant_attributes["normalized_attributes"]
    assert "pile_type" not in normalized.variant_attributes["normalized_attributes"]


def test_mirror_simple_frame_label_uses_generic_frame_material_normalization():
    attributes = {"Frame:": "Aluminum"}
    product = CatalogProduct(
        vendor_market_code="US",
        source_product_name="Simple Mirror",
        source_category="Large mirrors",
        product_url="https://example.com/products/simple-mirror",
        variants=[CatalogVariant(variant_attributes={"ikea_labeled_attributes": attributes})],
    )
    variant = normalize_product(product).product.variants[0]

    assert variant.variant_attributes["normalized_attributes"] == {"frame_material": "aluminum"}
    assert variant.variant_attributes["ikea_labeled_attributes"] == attributes


def test_terminal_colons_are_removed_from_labels_without_changing_raw_evidence():
    attributes = {"Table top:::": "Oak", "Base material::": "Steel"}
    product = CatalogProduct(
        vendor_market_code="US",
        source_product_name="Simple Dining Table",
        source_category="Dining Tables",
        product_url="https://example.com/products/simple-dining-table",
        variants=[CatalogVariant(variant_attributes={"ikea_labeled_attributes": attributes})],
    )
    variant = normalize_product(product).product.variants[0]

    assert variant.variant_attributes["normalized_attributes"] == {
        "tabletop_material": "oak",
        "base_material": "steel",
    }
    assert variant.variant_attributes["ikea_labeled_attributes"] == attributes


def test_hovet_like_mirror_composite_frame_and_mirror_glass_remain_unresolved():
    attributes = {
        "Mirror glass:": "Glass, Plastic foil",
        "Frame:": "Aluminum, Anodized",
    }
    product = CatalogProduct(
        vendor_market_code="US",
        source_product_name='HOVET Mirror - gold 30 3/4x77 1/8 "',
        source_category="Large mirrors",
        source_description="Can be placed horizontally or vertically, on the wall or leaning on the floor.",
        product_url="https://example.com/products/hovet-mirror",
        variants=[CatalogVariant(variant_attributes={"ikea_labeled_attributes": attributes})],
    )
    variant = normalize_product(product).product.variants[0]

    assert variant.variant_attributes["normalized_attributes"] == {}
    assert "frame_material" not in variant.variant_attributes["normalized_attributes"]
    assert "frame_finish" not in variant.variant_attributes["normalized_attributes"]
    assert "orientation" not in variant.variant_attributes["normalized_attributes"]
    assert "wall_mountable" not in variant.variant_attributes["normalized_attributes"]
    assert "full_length" not in variant.variant_attributes["normalized_attributes"]
    assert "shape" not in variant.variant_attributes["normalized_attributes"]
    assert variant.variant_attributes["ikea_labeled_attributes"] == attributes


def test_mirror_frame_material_requires_applicable_furniture_type():
    attributes = {"Frame:": "Aluminum"}
    product = CatalogProduct(
        vendor_market_code="US",
        source_product_name="Simple Rug",
        source_category="Rugs",
        product_url="https://example.com/products/simple-rug",
        variants=[CatalogVariant(variant_attributes={"ikea_labeled_attributes": attributes})],
    )
    variant = normalize_product(product).product.variants[0]

    assert variant.variant_attributes["normalized_attributes"] == {}
    assert variant.variant_attributes["ikea_labeled_attributes"] == attributes


def test_mirror_frame_material_preserves_existing_normalized_attributes():
    attributes = {"Frame": "Aluminum"}
    product = CatalogProduct(
        vendor_market_code="US",
        source_product_name="Simple Mirror",
        source_category="Large mirrors",
        product_url="https://example.com/products/simple-mirror",
        variants=[CatalogVariant(variant_attributes={
            "normalized_attributes": {"wall_mountable": True},
            "ikea_labeled_attributes": attributes,
        })],
    )
    variant = normalize_product(product).product.variants[0]

    assert variant.variant_attributes["normalized_attributes"] == {"wall_mountable": True, "frame_material": "aluminum"}
    assert variant.variant_attributes["ikea_labeled_attributes"] == attributes


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
