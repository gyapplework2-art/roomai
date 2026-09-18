"""Deterministic normalization of explicit vendor facts without source mutation."""

from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from typing import Literal

from crawler.core.attribute_normalizer import normalize_color, normalize_material
from crawler.core.evidence_resolution import resolve_attribute, variant_attribute_candidates
from crawler.core.taxonomy import resolve_furniture_type
from crawler.models.product import CatalogProduct, CatalogVariant, CurrentOffer, ProductDimensions

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


def _normalize_variant(
    variant: CatalogVariant,
    url_evidence: dict[str, object],
    reasons: list[str],
) -> CatalogVariant:
    candidates = variant_attribute_candidates(
        variant.source_color,
        variant.source_material,
        variant.variant_attributes,
        url_evidence,
    )
    color = resolve_attribute(candidates["color"])
    material = resolve_attribute(candidates["material"])
    reasons.extend((*color.review_reasons, *material.review_reasons))
    selected_color = color.selected.value if color.selected else None
    selected_material = material.selected.value if material.selected else None
    if selected_color and normalize_color(selected_color) is None:
        reasons.append("unknown_color")
    if selected_material and normalize_material(selected_material) is None:
        reasons.append("unknown_material")
    evidence = {
        "color": [candidate.__dict__ | {"selected": candidate == color.selected} for candidate in color.candidates],
        "material": [candidate.__dict__ | {"selected": candidate == material.selected} for candidate in material.candidates],
    }
    return variant.model_copy(update={
        "source_color": selected_color,
        "source_material": selected_material,
        "normalized_color": normalize_color(selected_color),
        "normalized_material": normalize_material(selected_material),
        "variant_attributes": {**variant.variant_attributes, "attribute_evidence": evidence},
        "dimensions": _normalize_dimensions(variant.dimensions, reasons),
        "current_offer": _normalize_offer(variant.current_offer),
    })


def normalize_product(product: CatalogProduct) -> NormalizationResult:
    """Return a normalized copy; source fields and original records are never overwritten."""
    reasons: list[str] = []

    raw_evidence = product.source_payload.get("attribute_evidence")
    url_evidence = raw_evidence if isinstance(raw_evidence, dict) else {}

    variants = [
        _normalize_variant(variant, url_evidence, reasons)
        for variant in product.variants
    ]

    taxonomy = resolve_furniture_type(product)

    if taxonomy.review_required:
        reasons.append("taxonomy_review")

    normalized_product = product.model_copy(
        update={
            "variants": variants,
            "canonical_furniture_type_code": taxonomy.furniture_type_code,
            "needs_taxonomy_review": taxonomy.review_required,
        }
    )

    return NormalizationResult(
        product=normalized_product,
        review_reasons=tuple(dict.fromkeys(reasons)),
    )