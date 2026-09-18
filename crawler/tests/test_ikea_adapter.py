from pathlib import Path

from crawler.core.normalizer import normalize_product
from crawler.vendors.ikea import IKEA_US_MARKET, IKEA_VENDOR, IkeaVendorAdapter


FIXTURES = Path(__file__).parent / "fixtures" / "ikea"


def parse_fixture(name: str):
    return IkeaVendorAdapter().parse_product(
        (FIXTURES / name).read_text(),
        "https://example.com/us/en/p/hyltarp-sofa-hallarp-white-s39489645",
    )


def test_ikea_json_ld_maps_explicit_product_identity_and_source_facts():
    product = parse_fixture("hyltarp_sofa.html")
    variant = product.variants[0]

    assert product.vendor_market_code == IKEA_US_MARKET
    assert product.source_payload["vendor"] == IKEA_VENDOR
    assert product.vendor_product_id == "394.896.45"
    assert variant.vendor_sku == "394.896.45"
    assert variant.vendor_variant_id == "S39489645"
    assert product.source_category == "Three-seat sofas"
    assert variant.source_color == "white"
    assert variant.source_material == "Fabric"


def test_ikea_mixed_inch_dimensions_are_preserved_and_normalized_by_existing_normalizer():
    product = parse_fixture("hyltarp_sofa.html")
    source_dimensions = product.variants[0].dimensions
    normalized_dimensions = normalize_product(product).product.variants[0].dimensions

    assert source_dimensions is not None
    assert source_dimensions.source_dimension_text == 'width: 91 3/8 "; depth: 36 5/8 "'
    assert source_dimensions.dimension_details["width"] == {"value": 91.375, "unit": "in"}
    assert normalized_dimensions is not None
    assert normalized_dimensions.width_cm == 232.0925
    assert normalized_dimensions.depth_cm == 93.0275


def test_ikea_image_objects_are_deduplicated_in_source_order_with_metadata():
    images = parse_fixture("hyltarp_sofa.html").variants[0].images

    assert [image.source_url for image in images] == [
        "https://example.com/ikea/hyltarp-main.jpg",
        "https://example.com/ikea/hyltarp-detail.jpg",
    ]
    assert [(image.width_px, image.height_px, image.sort_order) for image in images] == [
        (2000, 2000, 0),
        (1800, 1200, 1),
    ]


def test_ikea_labeled_construction_attributes_are_preserved_without_review_bodies():
    variant = parse_fixture("hyltarp_sofa.html").variants[0]

    assert variant.variant_attributes["ikea_labeled_attributes"] == {
        "Frame": "Solid wood, particleboard, plywood",
        "Seat cushion": "Pocket springs and foam",
        "Fabric": "80 % cotton, 20 % polyester",
        "Leg": "Solid wood",
    }
    assert "review" not in variant.variant_attributes


def test_ikea_offer_and_url_evidence_preserve_priority_boundaries():
    product = parse_fixture("hyltarp_sofa.html")
    offer = product.variants[0].current_offer

    assert offer is not None
    assert (offer.vendor_sale_price, offer.currency, offer.source_availability, offer.delivery_text) == (1199, "USD", "https://schema.org/InStock", "US")
    assert product.variants[0].source_color == "white"
    assert product.source_payload["url_evidence"]["tokens"][-2:] == ["white", "s39489645"]


def test_ikea_missing_optional_facts_remain_missing_without_inference():
    product = IkeaVendorAdapter().parse_product(
        '<script type="application/ld+json">{"@type":"Product","name":"Leather Green Sofa","sku":"1","url":"https://example.com/p/item"}</script>'
    )

    assert product.variants[0].source_color is None
    assert product.variants[0].source_material is None
    assert product.variants[0].current_offer is None
