"""Vendor-neutral deterministic attribute vocabulary normalization."""

import re

_COLOR_VALUES = {
    "gray": "gray", "grey": "gray", "light gray": "light_gray", "light grey": "light_gray",
    "dark gray": "dark_gray", "dark grey": "dark_gray", "black": "black", "white": "white",
    "ivory": "ivory", "off white": "off_white", "cream": "cream", "beige": "beige",
    "warm beige": "warm_beige", "oatmeal": "warm_beige", "taupe": "taupe", "tan": "tan",
    "brown": "brown", "natural": "natural", "charcoal": "charcoal", "charcoal gray": "charcoal",
    "charcoal grey": "charcoal", "green": "green", "sage green": "sage_green", "sage": "sage_green",
    "olive green": "olive_green", "olive": "olive_green", "dark green": "dark_green",
    "forest green": "dark_green", "blue": "blue", "navy": "navy", "navy blue": "navy",
    "red": "red", "terracotta": "terracotta", "terra cotta": "terracotta", "burgundy": "burgundy",
    "orange": "orange", "yellow": "yellow", "pink": "pink", "purple": "purple",
}
_MATERIAL_VALUES = {
    "fabric": "fabric", "leather": "leather", "velvet": "velvet", "polyester": "polyester",
    "polyester fabric": "polyester", "linen": "linen", "cotton": "cotton", "wool": "wool",
    "full aniline leather": "leather", "full grain leather": "leather",
    "boucle": "boucle", "bouclé": "boucle", "chenille": "chenille", "microfiber": "microfiber",
    "faux leather": "faux_leather", "vegan leather": "vegan_leather", "rattan": "rattan",
    "wicker": "wicker", "bamboo": "bamboo", "wood": "wood", "solid wood": "wood",
    "oak": "oak", "walnut": "walnut", "acacia": "acacia", "teak": "teak", "mdf": "mdf",
    "particleboard": "particleboard", "particle board": "particleboard", "plywood": "plywood",
    "metal": "metal", "steel": "steel", "brass": "brass", "iron": "iron",
    "stainless steel": "stainless_steel", "aluminum": "aluminum", "glass": "glass",
    "marble": "marble", "ceramic": "ceramic", "stone": "stone", "concrete": "concrete",
    "performance basketweave": "fabric", "woven fabric": "fabric", "performance velvet": "velvet",
}
_STYLE_VALUES = {
    "modern": "modern",
    "contemporary": "contemporary",
    "mid century modern": "mid_century_modern",
    "midcentury modern": "mid_century_modern",
    "traditional": "traditional",
    "transitional": "transitional",
    "scandinavian": "scandinavian",
    "scandi": "scandinavian",
    "minimalist": "minimalist",
    "minimal": "minimalist",
    "industrial": "industrial",
    "farmhouse": "farmhouse",
    "rustic": "rustic",
    "coastal": "coastal",
    "bohemian": "bohemian",
    "boho": "bohemian",
    "art deco": "art_deco",
    "glam": "glam",
    "glamorous": "glam",
    "classic": "classic",
}
_COMPOSITE_MATERIAL = re.compile(r"(?:\band\b|/|&)")


def _normalized_words(value: str) -> str:
    return " ".join(value.lower().replace("-", " ").split())


def _normalized_style_words(value: str) -> str:
    return " ".join(value.lower().replace("-", " ").replace("_", " ").split())


def normalize_color(value: str | None) -> str | None:
    """Normalize an explicit source color only when a controlled term is present."""
    if not value:
        return None
    normalized = _normalized_words(value)
    if normalized in _COLOR_VALUES:
        return _COLOR_VALUES[normalized]
    terms = sorted(_COLOR_VALUES, key=len, reverse=True)
    return next((_COLOR_VALUES[term] for term in terms if re.search(rf"\b{re.escape(term)}\b", normalized)), None)


def normalize_material(value: str | None) -> str | None:
    """Normalize an explicit primary material without collapsing composite materials."""
    if not value:
        return None
    normalized = _normalized_words(value)
    if _COMPOSITE_MATERIAL.search(normalized):
        return None
    return _MATERIAL_VALUES.get(normalized)


def normalize_style(value: str | None) -> str | None:
    """Normalize an explicit source style only when it exactly matches controlled vocabulary."""
    if not value:
        return None
    return _STYLE_VALUES.get(_normalized_style_words(value))


def normalize_cushion_fill(value: str | None) -> str | None:
    """Normalize explicit cushion-fill labels without inferring composition."""
    if not value:
        return None
    normalized = _normalized_words(value)
    return {
        "foam": "foam",
        "foam and fiber": "foam_and_fiber",
        "pocket springs and foam": "pocket_springs_and_foam",
    }.get(normalized)


def normalize_boolean(value: str | None) -> bool | None:
    """Normalize explicit yes/no-style labels without treating absence as false."""
    if not value:
        return None
    normalized = _normalized_words(value)
    if normalized in {"yes", "true"}:
        return True
    if normalized in {"no", "false"}:
        return False
    return None
