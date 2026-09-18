"""Deterministic furniture taxonomy resolution for RoomAI catalog products."""

from dataclasses import dataclass
import re

from crawler.models.product import CatalogProduct


@dataclass(frozen=True)
class TaxonomyResolution:
    furniture_type_code: str | None
    confidence: float
    method: str
    source_value: str | None
    review_required: bool


def _normalize_text(value: str | None) -> str:
    if not value:
        return ""

    value = value.casefold()
    value = value.replace("&", " and ")
    value = re.sub(r"[/_-]+", " ", value)
    value = re.sub(r"[^a-z0-9\s]", " ", value)
    return " ".join(value.split())


# Canonical RoomAI furniture-type codes.
#
# These codes are machine identifiers. Customer-facing names remain defined
# by the RoomAI taxonomy/database.
CANONICAL_TYPES = frozenset(
    {
        "sofa",
        "sectional_sofa",
        "sofa_with_chaise",
        "loveseat",
        "accent_chair",
        "lounge_chair",
        "swivel_chair",
        "recliner",
        "coffee_table",
        "side_end_table",
        "console_table",
        "dining_table",
        "dining_chair",
        "bar_counter_stool",
        "bed_frame",
        "nightstand",
        "dresser",
        "bench",
        "desk",
        "office_chair",
        "bookcase_shelving",
        "cabinet",
        "media_console",
        "area_rug",
        "floor_lamp",
        "table_lamp",
        "pendant_chandelier",
        "mirror",
    }
)


# High-confidence deterministic aliases.
ALIASES: dict[str, str] = {
    # Sofas
    "sofa": "sofa",
    "sofas": "sofa",
    "couch": "sofa",
    "couches": "sofa",

    # Sectionals
    "sectional": "sectional_sofa",
    "sectionals": "sectional_sofa",
    "sectional sofa": "sectional_sofa",
    "sectional sofas": "sectional_sofa",
    "modular sofa": "sectional_sofa",
    "modular sofas": "sectional_sofa",

    # Chaise sofas
    "sofa with chaise": "sofa_with_chaise",
    "sofas with chaise": "sofa_with_chaise",
    "chaise sofa": "sofa_with_chaise",
    "chaise sofas": "sofa_with_chaise",

    # Chairs
    "accent chair": "accent_chair",
    "accent chairs": "accent_chair",
    "lounge chair": "lounge_chair",
    "lounge chairs": "lounge_chair",
    "swivel chair": "swivel_chair",
    "swivel chairs": "swivel_chair",
    "recliner": "recliner",
    "recliners": "recliner",

    # Tables
    "coffee table": "coffee_table",
    "coffee tables": "coffee_table",
    "side table": "side_end_table",
    "side tables": "side_end_table",
    "end table": "side_end_table",
    "end tables": "side_end_table",
    "side and end table": "side_end_table",
    "side and end tables": "side_end_table",
    "console table": "console_table",
    "console tables": "console_table",
    "dining table": "dining_table",
    "dining tables": "dining_table",

    # Dining seating
    "dining chair": "dining_chair",
    "dining chairs": "dining_chair",
    "bar stool": "bar_counter_stool",
    "bar stools": "bar_counter_stool",
    "counter stool": "bar_counter_stool",
    "counter stools": "bar_counter_stool",

    # Bedroom
    "bed": "bed_frame",
    "beds": "bed_frame",
    "bed frame": "bed_frame",
    "bed frames": "bed_frame",
    "nightstand": "nightstand",
    "nightstands": "nightstand",
    "bedside table": "nightstand",
    "bedside tables": "nightstand",
    "dresser": "dresser",
    "dressers": "dresser",

    # Other furniture
    "bench": "bench",
    "benches": "bench",
    "desk": "desk",
    "desks": "desk",
    "office chair": "office_chair",
    "office chairs": "office_chair",
    "bookcase": "bookcase_shelving",
    "bookcases": "bookcase_shelving",
    "shelving": "bookcase_shelving",
    "shelving unit": "bookcase_shelving",
    "shelving units": "bookcase_shelving",
    "cabinet": "cabinet",
    "cabinets": "cabinet",
    "media console": "media_console",
    "media consoles": "media_console",
    "tv stand": "media_console",
    "tv stands": "media_console",

    # Rugs
    "area rug": "area_rug",
    "area rugs": "area_rug",
    "rug": "area_rug",
    "rugs": "area_rug",

    # Lighting
    "floor lamp": "floor_lamp",
    "floor lamps": "floor_lamp",
    "table lamp": "table_lamp",
    "table lamps": "table_lamp",
    "pendant": "pendant_chandelier",
    "pendants": "pendant_chandelier",
    "pendant light": "pendant_chandelier",
    "pendant lights": "pendant_chandelier",
    "chandelier": "pendant_chandelier",
    "chandeliers": "pendant_chandelier",

    # Decor
    "mirror": "mirror",
    "mirrors": "mirror",
}


# Product-name phrases that are more specific than a retailer's broad
# category and therefore may override that category.
SPECIFIC_NAME_RULES: tuple[tuple[str, str], ...] = (
    ("sofa with chaise", "sofa_with_chaise"),
    ("sofa w chaise", "sofa_with_chaise"),
    ("sectional sofa", "sectional_sofa"),
)


def _resolve_alias(value: str | None) -> str | None:
    normalized = _normalize_text(value)
    if not normalized:
        return None
    return ALIASES.get(normalized)


def _resolve_specific_name(value: str | None) -> tuple[str, str] | None:
    normalized = _normalize_text(value)
    if not normalized:
        return None

    for phrase, code in SPECIFIC_NAME_RULES:
        if phrase in normalized:
            return code, phrase

    return None


def resolve_furniture_type(product: CatalogProduct) -> TaxonomyResolution:
    """Resolve vendor terminology to a canonical RoomAI furniture type.

    Resolution is deterministic and conservative. Unknown or ambiguous
    products remain unresolved for taxonomy review rather than being guessed.
    """

    # Most explicit structured source evidence first.
    evidence = (
        ("source_product_type", product.source_product_type),
        ("source_subcategory", product.source_subcategory),
        ("source_category", product.source_category),
    )

    structured_resolution: tuple[str, str, str] | None = None

    for field_name, value in evidence:
        code = _resolve_alias(value)
        if code is not None:
            structured_resolution = (code, field_name, value)
            break

    # A highly specific product-name phrase can refine a broad category.
    name_resolution = _resolve_specific_name(product.source_product_name)

    if name_resolution is not None:
        name_code, matched_phrase = name_resolution

        if structured_resolution is None or (
            structured_resolution[0] in {"sofa", "sectional_sofa"}
            and name_code == "sofa_with_chaise"
        ):
            return TaxonomyResolution(
                furniture_type_code=name_code,
                confidence=0.98,
                method="specific_product_name",
                source_value=matched_phrase,
                review_required=False,
            )

    if structured_resolution is not None:
        code, field_name, source_value = structured_resolution
        return TaxonomyResolution(
            furniture_type_code=code,
            confidence=1.0,
            method=f"exact_alias:{field_name}",
            source_value=source_value,
            review_required=False,
        )

    return TaxonomyResolution(
        furniture_type_code=None,
        confidence=0.0,
        method="unresolved",
        source_value=None,
        review_required=True,
    )