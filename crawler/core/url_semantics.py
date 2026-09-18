"""Generic deterministic URL semantic evidence helpers."""

from dataclasses import dataclass
from urllib.parse import unquote, urlsplit


@dataclass(frozen=True)
class AttributeEvidence:
    value: str
    source: str
    method: str


def product_slug(url: str) -> str | None:
    """Return the final URL path segment as preserved vendor evidence."""
    path = urlsplit(url).path.rstrip("/")
    slug = unquote(path.rsplit("/", 1)[-1]).strip()
    return slug or None


def slug_tokens(url: str) -> tuple[str, ...]:
    """Tokenize a URL slug without assigning meaning to arbitrary tokens."""
    slug = product_slug(url)
    return tuple(token for token in (slug or "").lower().split("-") if token)


def configured_slug_evidence(
    url: str,
    *,
    material_tokens: set[str],
    color_phrases: set[tuple[str, ...]],
) -> dict[str, list[dict[str, str]]]:
    """Return only vendor-configured URL candidates with deterministic provenance."""
    tokens = slug_tokens(url)
    evidence: dict[str, list[dict[str, str]]] = {}
    materials = [token for token in tokens if token in material_tokens]
    colors = [" ".join(phrase) for phrase in color_phrases if _contains_phrase(tokens, phrase)]
    if materials:
        evidence["material"] = [AttributeEvidence(value, "vendor_url_slug", "deterministic").__dict__ for value in materials]
    if colors:
        evidence["color"] = [AttributeEvidence(value, "vendor_url_slug", "deterministic").__dict__ for value in colors]
    return evidence


def _contains_phrase(tokens: tuple[str, ...], phrase: tuple[str, ...]) -> bool:
    width = len(phrase)
    return any(tokens[index : index + width] == phrase for index in range(len(tokens) - width + 1))
