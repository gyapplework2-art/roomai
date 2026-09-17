import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from crawler.models.product import CatalogProduct, CatalogVariant, CurrentOffer, ProductDimensions


FIXTURES = Path(__file__).parent / "fixtures"


def load_fixture(name: str) -> dict[str, object]:
    return json.loads((FIXTURES / name).read_text())


def test_valid_simple_product():
    product = CatalogProduct.model_validate(load_fixture("sofa_simple.json"))
    assert product.vendor_market_code == "mock-us"
    assert product.variants[0].vendor_sku == "HL-SOFA-OAT"


def test_multi_variant_product():
    product = CatalogProduct.model_validate(load_fixture("sofa_multi_variant.json"))
    assert len(product.variants) == 2


def test_sale_price_offer():
    product = CatalogProduct.model_validate(load_fixture("sofa_sale_price.json"))
    assert product.variants[0].current_offer is not None
    assert product.variants[0].current_offer.vendor_sale_price == 1450.0


def test_product_allows_missing_optional_source_fields():
    product = CatalogProduct.model_validate(load_fixture("sofa_missing_optional.json"))
    assert product.vendor_product_id is None
    assert product.variants == []


def test_source_and_normalized_values_coexist():
    product = CatalogProduct.model_validate(load_fixture("sofa_simple.json"))
    variant = product.variants[0]
    assert variant.source_color == "Oatmeal"
    assert variant.normalized_color == "warm_beige"


def test_invalid_product_url_is_rejected():
    with pytest.raises(ValidationError):
        CatalogProduct(vendor_market_code="mock-us", source_product_name="Test", product_url="ftp://example.com")


def test_invalid_image_url_is_rejected():
    with pytest.raises(ValidationError):
        CatalogVariant(images=[{"source_url": "file:///image.jpg"}])


def test_negative_price_is_rejected():
    with pytest.raises(ValidationError):
        CurrentOffer(currency="USD", vendor_list_price=-1, checked_at="2026-09-17T12:00:00Z")


def test_negative_dimensions_are_rejected():
    with pytest.raises(ValidationError):
        ProductDimensions(width_cm=-1)


def test_negative_weight_is_rejected():
    with pytest.raises(ValidationError):
        ProductDimensions(weight_kg=-1)


def test_negative_seating_capacity_is_rejected():
    with pytest.raises(ValidationError):
        CatalogVariant(seating_capacity=-1)


def test_negative_image_sort_order_is_rejected():
    with pytest.raises(ValidationError):
        CatalogVariant(images=[{"source_url": "https://example.com/image.jpg", "sort_order": -1}])


def test_delivery_minimum_cannot_exceed_maximum():
    with pytest.raises(ValidationError):
        CurrentOffer(currency="USD", estimated_delivery_days_min=10, estimated_delivery_days_max=5, checked_at="2026-09-17T12:00:00Z")


def test_currency_must_be_three_uppercase_characters():
    with pytest.raises(ValidationError):
        CurrentOffer(currency="usd", checked_at="2026-09-17T12:00:00Z")


def test_blank_vendor_market_code_is_rejected():
    with pytest.raises(ValidationError):
        CatalogProduct(vendor_market_code="  ", source_product_name="Test", product_url="https://example.com")


def test_blank_product_name_is_rejected():
    with pytest.raises(ValidationError):
        CatalogProduct(vendor_market_code="mock-us", source_product_name="  ", product_url="https://example.com")


def test_json_serialization_is_compatible():
    product = CatalogProduct.model_validate(load_fixture("sofa_simple.json"))
    serialized = product.model_dump(mode="json")
    assert json.loads(json.dumps(serialized))["vendor_market_code"] == "mock-us"


def test_source_contract_has_no_roomai_customer_pricing_fields():
    fields = CurrentOffer.model_fields
    assert "roomai_markup" not in fields
    assert "customer_price" not in fields
    assert "selling_price" not in fields


def test_vendor_market_code_is_required_on_every_product():
    assert "vendor_market_code" in CatalogProduct.model_fields


def test_offer_shipping_fee_cannot_be_negative():
    with pytest.raises(ValidationError):
        CurrentOffer(currency="CAD", vendor_shipping_fee=-0.01, checked_at="2026-09-17T12:00:00Z")
