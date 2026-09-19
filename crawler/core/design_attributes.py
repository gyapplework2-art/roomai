"""Typed registry for furniture design attributes and type applicability.

Applicability describes which concepts may meaningfully describe a furniture type.
It never implies that a product has those attributes.
"""

from dataclasses import dataclass
from decimal import Decimal
import re
from types import MappingProxyType
from typing import Literal, Mapping

from crawler.core.attribute_normalizer import normalize_boolean, normalize_cushion_fill, normalize_material
from crawler.core.measurements import parse_measurement_text
from crawler.core.taxonomy import CANONICAL_TYPES

AttributeValueType = Literal["string", "boolean", "integer", "measurement"]


@dataclass(frozen=True)
class DesignAttributeDefinition:
    name: str
    value_type: AttributeValueType


_ATTRIBUTE_DEFINITION_ITEMS: tuple[DesignAttributeDefinition, ...] = (
    DesignAttributeDefinition("finish", "string"),
    DesignAttributeDefinition("indoor_outdoor", "string"),
    DesignAttributeDefinition("assembly_required", "boolean"),
    DesignAttributeDefinition("upholstery", "string"),
    DesignAttributeDefinition("frame_material", "string"),
    DesignAttributeDefinition("cushion_fill", "string"),
    DesignAttributeDefinition("firmness", "string"),
    DesignAttributeDefinition("orientation", "string"),
    DesignAttributeDefinition("reclining", "boolean"),
    DesignAttributeDefinition("sleeper", "boolean"),
    DesignAttributeDefinition("removable_cover", "boolean"),
    DesignAttributeDefinition("seat_height", "measurement"),
    DesignAttributeDefinition("arm_type", "string"),
    DesignAttributeDefinition("back_type", "string"),
    DesignAttributeDefinition("swivel", "boolean"),
    DesignAttributeDefinition("adjustable_height", "boolean"),
    DesignAttributeDefinition("footrest", "boolean"),
    DesignAttributeDefinition("shape", "string"),
    DesignAttributeDefinition("tabletop_material", "string"),
    DesignAttributeDefinition("base_material", "string"),
    DesignAttributeDefinition("extendable", "boolean"),
    DesignAttributeDefinition("extension_type", "string"),
    DesignAttributeDefinition("storage_type", "string"),
    DesignAttributeDefinition("drawer_count", "integer"),
    DesignAttributeDefinition("door_count", "integer"),
    DesignAttributeDefinition("shelf_count", "integer"),
    DesignAttributeDefinition("adjustable_shelves", "boolean"),
    DesignAttributeDefinition("soft_close", "boolean"),
    DesignAttributeDefinition("sit_stand", "boolean"),
    DesignAttributeDefinition("cable_management", "boolean"),
    DesignAttributeDefinition("max_tv_size", "measurement"),
    DesignAttributeDefinition("bed_size", "string"),
    DesignAttributeDefinition("headboard", "boolean"),
    DesignAttributeDefinition("platform_slat_type", "string"),
    DesignAttributeDefinition("pattern", "string"),
    DesignAttributeDefinition("construction", "string"),
    DesignAttributeDefinition("pile_height", "measurement"),
    DesignAttributeDefinition("pile_type", "string"),
    DesignAttributeDefinition("backing", "string"),
    DesignAttributeDefinition("washable", "boolean"),
    DesignAttributeDefinition("shade_material", "string"),
    DesignAttributeDefinition("bulb_type", "string"),
    DesignAttributeDefinition("bulb_base", "string"),
    DesignAttributeDefinition("bulb_count", "integer"),
    DesignAttributeDefinition("dimmable", "boolean"),
    DesignAttributeDefinition("integrated_led", "boolean"),
    DesignAttributeDefinition("light_direction", "string"),
    DesignAttributeDefinition("adjustable_drop", "measurement"),
    DesignAttributeDefinition("frame_finish", "string"),
    DesignAttributeDefinition("wall_mountable", "boolean"),
    DesignAttributeDefinition("full_length", "boolean"),
)

ATTRIBUTE_DEFINITIONS: Mapping[str, DesignAttributeDefinition] = MappingProxyType(
    {definition.name: definition for definition in _ATTRIBUTE_DEFINITION_ITEMS}
)

_UPHOLSTERED_SEATING = (
    "upholstery", "frame_material", "cushion_fill", "firmness", "reclining", "sleeper",
    "removable_cover", "assembly_required", "indoor_outdoor",
)
_CHAIR_SEATING = (
    "upholstery", "frame_material", "seat_height", "arm_type", "back_type",
    "assembly_required", "indoor_outdoor",
)
_STORAGE_CASE_GOODS = (
    "storage_type", "drawer_count", "door_count", "shelf_count", "adjustable_shelves",
    "soft_close", "finish", "frame_material", "assembly_required",
)
_LIGHTING = (
    "shade_material", "base_material", "bulb_type", "bulb_base", "bulb_count", "dimmable",
    "integrated_led", "light_direction", "assembly_required",
)

_DESIGN_ATTRIBUTE_LABELS = MappingProxyType({
    "upholstery": "upholstery",
    "upholstery material": "upholstery",
    "fabric": "upholstery",
    "frame material": "frame_material",
    "frame": "frame_material",
    "cushion fill": "cushion_fill",
    "seat cushion": "cushion_fill",
    "assembly required": "assembly_required",
    "table top": "tabletop_material",
    "top": "tabletop_material",
    "tabletop material": "tabletop_material",
    "top material": "tabletop_material",
    "leg": "base_material",
    "base material": "base_material",
    "shade": "shade_material",
})

FURNITURE_TYPE_ATTRIBUTES: Mapping[str, tuple[str, ...]] = MappingProxyType({
    "sofa": _UPHOLSTERED_SEATING,
    "sectional_sofa": (*_UPHOLSTERED_SEATING, "orientation"),
    "sofa_with_chaise": (*_UPHOLSTERED_SEATING, "orientation"),
    "loveseat": _UPHOLSTERED_SEATING,
    "accent_chair": _CHAIR_SEATING,
    "lounge_chair": (*_CHAIR_SEATING, "swivel", "footrest"),
    "swivel_chair": (*_CHAIR_SEATING, "swivel", "adjustable_height"),
    "recliner": (*_CHAIR_SEATING, "reclining", "footrest"),
    "coffee_table": (
        "shape", "tabletop_material", "base_material", "finish", "storage_type",
        "shelf_count", "assembly_required", "indoor_outdoor",
    ),
    "side_end_table": (
        "shape", "tabletop_material", "base_material", "finish", "storage_type",
        "drawer_count", "shelf_count", "assembly_required", "indoor_outdoor",
    ),
    "console_table": (
        "shape", "tabletop_material", "base_material", "finish", "storage_type",
        "drawer_count", "shelf_count", "assembly_required", "indoor_outdoor",
    ),
    "dining_table": (
        "shape", "tabletop_material", "base_material", "finish", "extendable",
        "extension_type", "assembly_required", "indoor_outdoor",
    ),
    "dining_chair": (*_CHAIR_SEATING, "footrest"),
    "bar_counter_stool": (
        "upholstery", "frame_material", "seat_height", "back_type", "swivel",
        "adjustable_height", "footrest", "assembly_required", "indoor_outdoor",
    ),
    "bed_frame": (
        "bed_size", "frame_material", "finish", "headboard", "storage_type",
        "drawer_count", "platform_slat_type", "assembly_required",
    ),
    "nightstand": _STORAGE_CASE_GOODS,
    "dresser": _STORAGE_CASE_GOODS,
    "bench": (
        "upholstery", "frame_material", "seat_height", "storage_type", "finish",
        "assembly_required", "indoor_outdoor",
    ),
    "desk": (
        "shape", "tabletop_material", "base_material", "finish", "storage_type",
        "drawer_count", "shelf_count", "sit_stand", "adjustable_height", "cable_management",
        "assembly_required",
    ),
    "office_chair": (
        "upholstery", "frame_material", "seat_height", "arm_type", "back_type", "swivel",
        "adjustable_height", "assembly_required",
    ),
    "bookcase_shelving": (
        "frame_material", "finish", "shelf_count", "adjustable_shelves", "door_count",
        "storage_type", "assembly_required",
    ),
    "cabinet": _STORAGE_CASE_GOODS,
    "media_console": (*_STORAGE_CASE_GOODS, "cable_management", "max_tv_size"),
    "area_rug": (
        "shape", "pattern", "construction", "pile_height", "pile_type", "backing",
        "washable", "indoor_outdoor",
    ),
    "floor_lamp": _LIGHTING,
    "table_lamp": _LIGHTING,
    "pendant_chandelier": (*_LIGHTING, "adjustable_drop"),
    "mirror": (
        "shape", "frame_material", "frame_finish", "orientation", "wall_mountable", "full_length",
    ),
})


def _validate_registry() -> None:
    names = [definition.name for definition in _ATTRIBUTE_DEFINITION_ITEMS]
    if len(names) != len(set(names)):
        raise ValueError("Duplicate design attribute definitions are not allowed.")
    if set(ATTRIBUTE_DEFINITIONS) != set(names):
        raise ValueError("Design attribute registry keys must match definition names.")
    unknown_types = set(FURNITURE_TYPE_ATTRIBUTES) - CANONICAL_TYPES
    if unknown_types:
        raise ValueError(f"Unknown furniture types in attribute registry: {sorted(unknown_types)}")
    missing_types = CANONICAL_TYPES - set(FURNITURE_TYPE_ATTRIBUTES)
    if missing_types:
        raise ValueError(f"Missing furniture type attribute registry entries: {sorted(missing_types)}")
    unknown_attributes = {
        attribute
        for attributes in FURNITURE_TYPE_ATTRIBUTES.values()
        for attribute in attributes
        if attribute not in ATTRIBUTE_DEFINITIONS
    }
    if unknown_attributes:
        raise ValueError(f"Unknown design attributes in applicability registry: {sorted(unknown_attributes)}")
    for furniture_type, attributes in FURNITURE_TYPE_ATTRIBUTES.items():
        if len(attributes) != len(set(attributes)):
            raise ValueError(f"Duplicate design attributes for furniture type: {furniture_type}")


def get_attribute_definition(name: str) -> DesignAttributeDefinition | None:
    return ATTRIBUTE_DEFINITIONS.get(name)


def applicable_attributes(furniture_type_code: str | None) -> tuple[str, ...]:
    if not furniture_type_code:
        return ()
    return FURNITURE_TYPE_ATTRIBUTES.get(furniture_type_code, ())


def is_attribute_applicable(furniture_type_code: str | None, attribute_name: str) -> bool:
    return attribute_name in applicable_attributes(furniture_type_code)


def normalized_labeled_design_attributes(
    furniture_type_code: str | None,
    variant_attributes: Mapping[str, object],
) -> dict[str, object]:
    """Normalize supported explicit labeled design attributes when applicable.

    Raw vendor collections remain the provenance; no attributes are inferred from
    applicability, prose, URLs, names, descriptions, or missing labels.
    """
    normalized: dict[str, object] = {}
    for collection_key in ("article_attributes", "ikea_labeled_attributes", "article_html_specifications"):
        collection = variant_attributes.get(collection_key)
        if not isinstance(collection, dict):
            continue
        for label, raw_value in collection.items():
            if _is_label(label, "pile"):
                pile_attributes = _normalize_pile_specification(furniture_type_code, raw_value)
                normalized.update(pile_attributes)
                continue
            attribute_name = _design_attribute_for_label(label)
            if attribute_name is None or not is_attribute_applicable(furniture_type_code, attribute_name):
                continue
            value = _normalize_design_attribute_value(attribute_name, raw_value)
            if value is not None:
                normalized[attribute_name] = value
    return normalized


def _normalize_pile_specification(furniture_type_code: str | None, value: object) -> dict[str, object]:
    if not isinstance(value, str):
        return {}
    match = re.fullmatch(r"(.+?)\s+-\s+([A-Za-z]+)\s*", value.strip())
    if match is None:
        return {}
    measurement = parse_measurement_text(match.group(1).strip())
    pile_type = match.group(2).casefold()
    if measurement is None or measurement["unit"] not in {"in", "inch", "inches", "cm", "centimeter", "centimeters"}:
        return {}
    if pile_type != "medium":
        return {}
    centimeters = Decimal(str(measurement["value"])) * Decimal("2.54") if measurement["unit"] in {"in", "inch", "inches"} else Decimal(str(measurement["value"]))
    normalized: dict[str, object] = {}
    if is_attribute_applicable(furniture_type_code, "pile_height"):
        normalized["pile_height"] = float(centimeters)
    if is_attribute_applicable(furniture_type_code, "pile_type"):
        normalized["pile_type"] = pile_type
    return normalized


def normalized_identity_design_attributes(
    furniture_type_code: str | None,
    source_product_name: str | None,
) -> dict[str, object]:
    """Normalize narrow product-identity design facts from explicit product names only."""
    if not source_product_name:
        return {}

    normalized_name = _normalized_identity_text(source_product_name)
    attributes: dict[str, object] = {}
    if furniture_type_code == "dresser":
        drawer_count = _identity_drawer_count(normalized_name)
        if drawer_count is not None and is_attribute_applicable(furniture_type_code, "drawer_count"):
            attributes["drawer_count"] = drawer_count
    if furniture_type_code == "bed_frame":
        bed_size = _identity_bed_size(normalized_name)
        if bed_size is not None and is_attribute_applicable(furniture_type_code, "bed_size"):
            attributes["bed_size"] = bed_size
        if "with storage" in normalized_name and is_attribute_applicable(furniture_type_code, "storage_type"):
            attributes["storage_type"] = "integrated_storage"
        if _identity_has_headboard(normalized_name) and is_attribute_applicable(furniture_type_code, "headboard"):
            attributes["headboard"] = True
    if furniture_type_code == "desk" and _identity_is_sit_stand_desk(normalized_name) and is_attribute_applicable(furniture_type_code, "sit_stand"):
        attributes["sit_stand"] = True
    if furniture_type_code in {"floor_lamp", "table_lamp", "pendant_chandelier"}:
        if _identity_is_dimmable_lighting(normalized_name) and is_attribute_applicable(furniture_type_code, "dimmable"):
            attributes["dimmable"] = True
        bulb_count = _identity_bulb_count(normalized_name)
        if bulb_count is not None and is_attribute_applicable(furniture_type_code, "bulb_count"):
            attributes["bulb_count"] = bulb_count
    if furniture_type_code == "area_rug" and _identity_is_flatwoven_rug(normalized_name) and is_attribute_applicable(furniture_type_code, "construction"):
        attributes["construction"] = "flatwoven"
    return attributes


def _normalized_identity_text(value: str) -> str:
    normalized = value.casefold().replace("/", " ").replace("-", " ")
    return " ".join(re.sub(r"[^a-z0-9\s]", " ", normalized).split())


def _identity_drawer_count(normalized_name: str) -> int | None:
    match = re.search(r"\b([1-9][0-9]*)\s+drawers?\b", normalized_name)
    return int(match.group(1)) if match else None


def _identity_bed_size(normalized_name: str) -> str | None:
    for phrase, value in (
        ("california king", "california_king"),
        ("twin xl", "twin_xl"),
        ("queen", "queen"),
        ("king", "king"),
        ("twin", "twin"),
        ("full", "full"),
    ):
        if re.search(rf"\b{re.escape(phrase)}\b", normalized_name):
            return value
    return None


def _identity_has_headboard(normalized_name: str) -> bool:
    return re.search(r"\bwith\b(?:\s+[a-z0-9]+){0,4}\s+headboard\b", normalized_name) is not None


def _identity_is_sit_stand_desk(normalized_name: str) -> bool:
    return any(
        re.search(pattern, normalized_name) is not None
        for pattern in (
            r"\bdesk sit stand\b",
            r"\bsit stand desk\b",
        )
    )


def _identity_is_dimmable_lighting(normalized_name: str) -> bool:
    return re.search(r"\bdimmable\b", normalized_name) is not None


def _identity_bulb_count(normalized_name: str) -> int | None:
    match = re.search(r"\bwith\s+([1-9][0-9]*)\s+lights\b", normalized_name)
    return int(match.group(1)) if match else None


def _identity_is_flatwoven_rug(normalized_name: str) -> bool:
    return re.search(r"\bflatwoven\b", normalized_name) is not None or re.search(r"\bflat\s+woven\b", normalized_name) is not None


def _design_attribute_for_label(label: object) -> str | None:
    if not isinstance(label, str):
        return None
    normalized = label.strip().casefold().rstrip(":").strip()
    return _DESIGN_ATTRIBUTE_LABELS.get(" ".join(normalized.split()))


def _is_label(label: object, expected: str) -> bool:
    if not isinstance(label, str):
        return False
    return label.strip().casefold().rstrip(":").strip() == expected


def _normalize_design_attribute_value(attribute_name: str, value: object) -> object | None:
    if not isinstance(value, str):
        return None
    if attribute_name in {"upholstery", "frame_material", "tabletop_material", "base_material", "shade_material"}:
        return normalize_material(value)
    if attribute_name == "cushion_fill":
        return normalize_cushion_fill(value)
    if attribute_name == "assembly_required":
        return normalize_boolean(value)
    return None


_validate_registry()
