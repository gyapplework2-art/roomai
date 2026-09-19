from pathlib import Path

from crawler.jobs.inspect_article_product import build_validation_report
from crawler.models.product import CatalogProduct, CatalogVariant
from crawler.vendors.article import ArticleVendorAdapter


FIXTURES = Path(__file__).parent / "fixtures" / "article"


def article_fixture(name: str) -> CatalogProduct:
    return ArticleVendorAdapter().parse_product(
        (FIXTURES / name).read_text(),
        "https://example.com/article/requested-url",
    )


def test_normalized_article_report_exposes_identity_attributes_material_style_and_dimensions():
    product = article_fixture("rich_leather_sofa.html").model_copy(update={"source_category": "Sofas"})
    report = build_validation_report(product, normalized=True)

    assert report["source_product"]["source_category"] == "Sofas"
    assert report["source_product"]["variants"][0]["variant_attributes"]["article_attributes"]["Upholstery Material"] == "Full-aniline leather"
    assert report["normalized"]["canonical_furniture_type_code"] == "sofa"
    attributes = report["normalized"]["variants"][0]["attributes"]
    assert "normalized_color" in attributes
    assert attributes["normalized_material"] == "leather"
    assert attributes["normalized_style"] is None
    assert attributes["normalized_attributes"] == {
        "upholstery": "leather",
        "frame_material": "wood",
        "cushion_fill": "foam_and_fiber",
        "assembly_required": False,
    }
    assert report["normalized"]["variants"][0]["dimensions"]["source_dimension_details"] == {}


def test_normalized_article_report_exposes_source_and_normalized_dimensions():
    product = article_fixture("inch_dimensions_sofa.html").model_copy(update={"source_category": "Sofas"})
    report = build_validation_report(product, normalized=True)
    dimensions = report["normalized"]["variants"][0]["dimensions"]

    assert dimensions["source_dimension_text"] == "width: 90 in; depth: 35 in; height: 32 in"
    assert dimensions["normalized"]["width_cm"] == 228.6
    assert dimensions["normalized"]["depth_cm"] == 88.9
    assert dimensions["normalized"]["height_cm"] == 81.28


def test_normalized_article_rug_report_exposes_area_rug_taxonomy():
    product = CatalogProduct(
        vendor_market_code="US",
        source_product_name="Texa 8 x 10 Rug - Vanilla Ivory",
        source_category="Rugs",
        source_description="Hand-woven wool with a tightly looped surface.",
        product_url="https://example.com/article/product/1834/texa-8-x-10-rug",
        variants=[CatalogVariant()],
    )
    report = build_validation_report(product, normalized=True)

    assert report["normalized"]["canonical_furniture_type_code"] == "area_rug"
    assert report["normalized"]["variants"][0]["attributes"]["normalized_attributes"] == {}


def test_source_only_article_report_does_not_claim_normalized_results():
    product = article_fixture("rich_fabric_sofa.html")
    report = build_validation_report(product, normalized=False)

    assert report["normalized"] is None
    assert report["source_product"]["source_category"] is None
    assert report["source_product"]["variants"][0]["normalized_color"] is None
