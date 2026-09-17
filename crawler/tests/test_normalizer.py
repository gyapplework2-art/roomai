from decimal import Decimal

import pytest

from crawler.core.normalizer import normalize_availability, normalize_measurement, normalize_product
from crawler.models.product import CatalogProduct, CatalogVariant, CurrentOffer, ProductDimensions


def test_length_units_normalize_to_centimeters():
    assert normalize_measurement("90", "in", "length") == Decimal("228.60")
    assert normalize_measurement("3", "ft", "length") == Decimal("91.44")
    assert normalize_measurement("100", "mm", "length") == Decimal("10.0")
    assert normalize_measurement("20", "cm", "length") == Decimal("20")
    assert normalize_measurement("2", "m", "length") == Decimal("200")


def test_unknown_units_remain_none_and_source_text_is_preserved():
    product = CatalogProduct(vendor_market_code="mock-us", source_product_name="Rain Cloud Gray Sofa", product_url="https://example.com/p", variants=[CatalogVariant(dimensions=ProductDimensions(source_dimension_text="90 mystery", dimension_details={"width": {"value": "90", "unit": "mystery"}}))])
    result = normalize_product(product)
    assert result.product.variants[0].dimensions.width_cm is None
    assert result.product.variants[0].dimensions.source_dimension_text == "90 mystery"
    assert "unknown_width_unit" in result.review_reasons


def test_weight_normalization_and_attributes_only_use_explicit_fields():
    assert normalize_measurement("1000", "g", "weight") == Decimal("1.000")
    assert normalize_measurement("10", "lb", "weight") == Decimal("4.53592370")
    product = CatalogProduct(vendor_market_code="mock-us", source_product_name="Rain Cloud Gray Leather Sofa", product_url="https://example.com/p", variants=[CatalogVariant(source_color=None, source_material=None, dimensions=ProductDimensions(dimension_details={"weight": {"value": "2", "unit": "kg"}}))])
    variant = normalize_product(product).product.variants[0]
    assert variant.normalized_color is None
    assert variant.normalized_material is None
    assert variant.dimensions.weight_kg == 2


def test_unknown_explicit_attributes_are_preserved_without_normalization():
    product = CatalogProduct(vendor_market_code="mock-us", source_product_name="Sofa", product_url="https://example.com/p", variants=[CatalogVariant(source_color="Unmapped Mist", source_material="Unmapped Textile")])
    variant = normalize_product(product).product.variants[0]
    assert variant.source_color == "Unmapped Mist"
    assert variant.normalized_color is None
    assert variant.source_material == "Unmapped Textile"
    assert variant.normalized_material is None


def test_known_attributes_and_availability_normalize_without_replacing_source():
    product = CatalogProduct(vendor_market_code="mock-us", source_product_name="Sofa", product_url="https://example.com/p", variants=[CatalogVariant(source_color="Oatmeal", source_material="Performance Basketweave", current_offer=CurrentOffer(currency="USD", source_availability="https://schema.org/InStock", checked_at="2026-01-01T00:00:00Z"))])
    variant = normalize_product(product).product.variants[0]
    assert (variant.source_color, variant.normalized_color) == ("Oatmeal", "warm_beige")
    assert (variant.source_material, variant.normalized_material) == ("Performance Basketweave", "fabric")
    assert variant.current_offer.source_availability == "https://schema.org/InStock"
    assert variant.current_offer.normalized_availability == "in_stock"


@pytest.mark.parametrize(
    ("source", "normalized"),
    [
        ("https://schema.org/InStock", "in_stock"),
        ("https://schema.org/OutOfStock", "out_of_stock"),
        ("https://schema.org/PreOrder", "preorder"),
        ("https://schema.org/BackOrder", "backorder"),
        ("https://schema.org/Discontinued", "discontinued"),
        ("Unknown vendor status", None),
    ],
)
def test_availability_normalization(source: str, normalized: str | None):
    assert normalize_availability(source) == normalized
