"""Vendor-neutral deterministic attribute vocabulary normalization."""

import re

_COLOR_VALUES = {
    "gray": "gray", "grey": "gray", "light gray": "light_gray", "light grey": "light_gray",
    "dark gray": "dark_gray", "dark grey": "dark_gray", "black": "black", "white": "white",
    "cream": "cream", "beige": "beige", "tan": "tan", "brown": "brown", "green": "green",
    "blue": "blue", "navy": "navy", "red": "red", "orange": "orange", "yellow": "yellow",
    "pink": "pink", "purple": "purple", "oatmeal": "warm_beige", "charcoal": "gray",
}
_MATERIAL_VALUES = {
    "fabric": "fabric", "leather": "leather", "velvet": "velvet", "polyester": "polyester",
    "polyester fabric": "polyester", "linen": "linen", "cotton": "cotton", "wool": "wool",
    "wood": "wood", "solid wood": "wood", "metal": "metal", "steel": "steel",
    "aluminum": "aluminum", "glass": "glass", "marble": "marble", "performance basketweave": "fabric",
    "woven fabric": "fabric",
}
_COMPOSITE_MATERIAL = re.compile(r"\b(?:and|/|&)\b")


def normalize_color(value: str | None) -> str | None:
    """Normalize an explicit source color only when a controlled term is present."""
    if not value:
        return None
    normalized = " ".join(value.lower().split())
    if normalized in _COLOR_VALUES:
        return _COLOR_VALUES[normalized]
    terms = sorted(_COLOR_VALUES, key=len, reverse=True)
    return next((_COLOR_VALUES[term] for term in terms if re.search(rf"\b{re.escape(term)}\b", normalized)), None)


def normalize_material(value: str | None) -> str | None:
    """Normalize an explicit primary material without collapsing composite materials."""
    if not value:
        return None
    normalized = " ".join(value.lower().split())
    if _COMPOSITE_MATERIAL.search(normalized):
        return None
    return _MATERIAL_VALUES.get(normalized)
