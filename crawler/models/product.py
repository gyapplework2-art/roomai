"""Pydantic contracts for vendor-source furniture catalog facts.

These models intentionally preserve vendor facts and optional normalized values.
They do not contain RoomAI customer pricing or aesthetic judgments.
"""

from datetime import datetime
from typing import Self

from pydantic import BaseModel, ConfigDict, Field, JsonValue, field_validator, model_validator


def _validate_http_url(value: str) -> str:
    if not value.startswith(("http://", "https://")):
        raise ValueError("URL must use HTTP or HTTPS.")
    return value


def _validate_non_blank(value: str) -> str:
    trimmed = value.strip()
    if not trimmed:
        raise ValueError("Value cannot be blank.")
    return trimmed


class ProductDimensions(BaseModel):
    """Original dimension text alongside optional normalized numeric facts."""

    model_config = ConfigDict(extra="forbid")

    source_dimension_text: str | None = None
    width_cm: float | None = Field(default=None, ge=0)
    depth_cm: float | None = Field(default=None, ge=0)
    height_cm: float | None = Field(default=None, ge=0)
    weight_kg: float | None = Field(default=None, ge=0)
    dimension_details: dict[str, JsonValue] = Field(default_factory=dict)


class ProductImage(BaseModel):
    """Remote vendor image metadata; images are never downloaded by this contract."""

    model_config = ConfigDict(extra="forbid")

    source_url: str
    image_role: str | None = None
    alt_text: str | None = None
    width_px: int | None = Field(default=None, ge=0)
    height_px: int | None = Field(default=None, ge=0)
    sort_order: int = Field(default=0, ge=0)

    _http_url = field_validator("source_url")(_validate_http_url)


class CurrentOffer(BaseModel):
    """Current vendor commercial facts, explicitly separate from RoomAI pricing."""

    model_config = ConfigDict(extra="forbid")

    currency: str
    vendor_list_price: float | None = Field(default=None, ge=0)
    vendor_sale_price: float | None = Field(default=None, ge=0)
    vendor_shipping_fee: float | None = Field(default=None, ge=0)
    source_availability: str | None = None
    normalized_availability: str | None = None
    delivery_text: str | None = None
    estimated_delivery_days_min: int | None = Field(default=None, ge=0)
    estimated_delivery_days_max: int | None = Field(default=None, ge=0)
    checked_at: datetime

    @field_validator("currency")
    @classmethod
    def validate_currency(cls, value: str) -> str:
        if len(value) != 3 or not value.isalpha() or value != value.upper():
            raise ValueError("Currency must be a three-character uppercase code.")
        return value

    @model_validator(mode="after")
    def validate_delivery_range(self) -> Self:
        if (
            self.estimated_delivery_days_min is not None
            and self.estimated_delivery_days_max is not None
            and self.estimated_delivery_days_min > self.estimated_delivery_days_max
        ):
            raise ValueError("Delivery minimum cannot exceed delivery maximum.")
        return self


class CatalogVariant(BaseModel):
    """A purchasable vendor variant retaining source and normalized terms together."""

    model_config = ConfigDict(extra="forbid")

    vendor_sku: str | None = None
    vendor_variant_id: str | None = None
    variant_name: str | None = None
    source_color: str | None = None
    normalized_color: str | None = None
    source_material: str | None = None
    normalized_material: str | None = None
    source_style: str | None = None
    normalized_style: str | None = None
    configuration: str | None = None
    seating_capacity: int | None = Field(default=None, ge=0)
    variant_attributes: dict[str, JsonValue] = Field(default_factory=dict)
    dimensions: ProductDimensions | None = None
    images: list[ProductImage] = Field(default_factory=list)
    current_offer: CurrentOffer | None = None


class CatalogProduct(BaseModel):
    """A single product in one country-specific vendor market."""

    model_config = ConfigDict(extra="forbid")

    vendor_market_code: str
    vendor_product_id: str | None = None
    source_product_name: str
    source_category: str | None = None
    source_subcategory: str | None = None
    source_product_type: str | None = None
    source_description: str | None = None
    source_features: list[str] = Field(default_factory=list)
    product_url: str
    source_payload: dict[str, JsonValue] = Field(default_factory=dict)
    source_hash: str | None = None
    canonical_furniture_type_code: str | None = None
    needs_taxonomy_review: bool = False
    variants: list[CatalogVariant] = Field(default_factory=list)

    _vendor_market_code = field_validator("vendor_market_code")(_validate_non_blank)
    _source_product_name = field_validator("source_product_name")(_validate_non_blank)
    _http_url = field_validator("product_url")(_validate_http_url)
