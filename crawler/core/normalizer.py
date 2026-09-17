"""Deterministic normalization of explicit vendor facts without source mutation."""

from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from typing import Literal

from crawler.models.product import CatalogProduct, CatalogVariant, CurrentOffer, ProductDimensions

_COLOR_MAP = {"cloud gray": "gray", "oatmeal": "warm_beige", "charcoal": "gray", "black": "black"}
_MATERIAL_MAP = {"performance basketweave": "fabric", "woven fabric": "fabric", "leather": "leather"}
_AVAILABILITY_MAP = {
    "https://schema.org/instock": "in_stock", "instock": "in_stock",
    "https://schema.org/outofstock": "out_of_stock", "outofstock": "out_of_stock",
    "https://schema.org/preorder": "preorder", "preorder": "preorder",
    "https://schema.org/backorder": "backorder", "backorder": "backorder",
    "https://schema.org/discontinued": "discontinued", "discontinued": "discontinued",
}
_LENGTH_FACTORS = {"mm": Decimal("0.1"), "cm": Decimal("1"), "m": Decimal("100"), "in": Decimal("2.54"), "inch": Decimal("2.54"), "inches": Decimal("2.54"), "ft": Decimal("30.48"), "foot": Decimal("30.48"), "feet": Decimal("30.48")}
_WEIGHT_FACTORS = {"g": Decimal("0.001"), "kg": Decimal("1"), "lb": Decimal("0.45359237"), "lbs": Decimal("0.45359237"), "pound": Decimal("0.45359237"), "pounds": Decimal("0.45359237")}


@dataclass(frozen=True)
class NormalizationResult:
    product: CatalogProduct
    review_reasons: tuple[str, ...]


def normalize_measurement(value: object, unit: object, kind: Literal["length", "weight"]) -> Decimal | None:
    """Convert explicit source values only; unknown and malformed values remain unnormalized."""
    if not isinstance(unit, str):
        return None
    factor = (_LENGTH_FACTORS if kind == "length" else _WEIGHT_FACTORS).get(unit.strip().lower())
    if factor is None:
        return None
    try:
        numeric = Decimal(str(value))
    except (InvalidOperation, ValueError):
        return None
    return numeric * factor if numeric >= 0 else None


def normalize_availability(value: str | None) -> str | None:
    return _AVAILABILITY_MAP.get(value.strip().lower()) if value else None


def _detail_measurement(details: dict[str, object], name: str, kind: Literal["length", "weight"]) -> float | None:
    raw = details.get(name)
    if not isinstance(raw, dict):
        return None
    normalized = normalize_measurement(raw.get("value"), raw.get("unit"), kind)
    return float(normalized) if normalized is not None else None


def _normalize_dimensions(dimensions: ProductDimensions | None, reasons: list[str]) -> ProductDimensions | None:
    if dimensions is None:
        return None
    details = dimensions.dimension_details
    updates = {
        "width_cm": dimensions.width_cm if dimensions.width_cm is not None else _detail_measurement(details, "width", "length"),
        "depth_cm": dimensions.depth_cm if dimensions.depth_cm is not None else _detail_measurement(details, "depth", "length"),
        "height_cm": dimensions.height_cm if dimensions.height_cm is not None else _detail_measurement(details, "height", "length"),
        "weight_kg": dimensions.weight_kg if dimensions.weight_kg is not None else _detail_measurement(details, "weight", "weight"),
    }
    for name, kind in (("width", "length"), ("depth", "length"), ("height", "length"), ("weight", "weight")):
        raw = details.get(name)
        if isinstance(raw, dict) and _detail_measurement(details, name, kind) is None:
            reasons.append(f"unknown_{name}_unit")
    return dimensions.model_copy(update=updates)


def _normalize_offer(offer: CurrentOffer | None) -> CurrentOffer | None:
    if offer is None:
        return None
    return offer.model_copy(update={"normalized_availability": normalize_availability(offer.source_availability)})


def _normalize_variant(variant: CatalogVariant, reasons: list[str]) -> CatalogVariant:
    return variant.model_copy(update={
        "normalized_color": _COLOR_MAP.get(variant.source_color.strip().lower()) if variant.source_color else None,
        "normalized_material": _MATERIAL_MAP.get(variant.source_material.strip().lower()) if variant.source_material else None,
        "dimensions": _normalize_dimensions(variant.dimensions, reasons),
        "current_offer": _normalize_offer(variant.current_offer),
    })


def normalize_product(product: CatalogProduct) -> NormalizationResult:
    """Return a normalized copy; source fields and original records are never overwritten."""
    reasons: list[str] = []
    variants = [_normalize_variant(variant, reasons) for variant in product.variants]
    return NormalizationResult(product=product.model_copy(update={"variants": variants}), review_reasons=tuple(reasons))
