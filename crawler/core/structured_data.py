"""Standard-library JSON-LD extraction for generic source product facts."""

import json
from dataclasses import dataclass
from html.parser import HTMLParser

__all__ = [
    "JsonLdExtraction",
    "StructuredProductFacts",
    "extract_json_ld",
    "extract_products",
    "is_product",
    "product_facts",
]


@dataclass(frozen=True)
class JsonLdExtraction:
    """JSON-LD preserved from one script block, including parse errors."""

    raw_text: str
    data: object | None
    error: str | None = None


@dataclass(frozen=True)
class StructuredProductFacts:
    """Generic schema.org facts; source JSON-LD is preserved unchanged."""

    source: dict[str, object]
    name: str | None
    description: str | None
    sku: str | None
    mpn: str | None
    gtin: str | None
    image: object | None
    brand: object | None
    color: str | None
    material: str | None
    category: str | None
    url: str | None
    offers: list[dict[str, object]]


class _JsonLdScriptParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.blocks: list[str] = []
        self._in_json_ld = False
        self._parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() == "script" and dict(attrs).get("type", "").lower() == "application/ld+json":
            self._in_json_ld = True
            self._parts = []

    def handle_data(self, data: str) -> None:
        if self._in_json_ld:
            self._parts.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() == "script" and self._in_json_ld:
            self.blocks.append("".join(self._parts))
            self._in_json_ld = False
            self._parts = []


def extract_json_ld(html: str) -> list[JsonLdExtraction]:
    """Extract all JSON-LD script blocks while isolating malformed JSON."""
    parser = _JsonLdScriptParser()
    parser.feed(html)
    parser.close()
    results: list[JsonLdExtraction] = []
    for raw_text in parser.blocks:
        try:
            results.append(JsonLdExtraction(raw_text=raw_text, data=json.loads(raw_text)))
        except json.JSONDecodeError as error:
            results.append(JsonLdExtraction(raw_text=raw_text, data=None, error=str(error)))
    return results


def _nodes(value: object) -> list[dict[str, object]]:
    if isinstance(value, list):
        return [node for item in value for node in _nodes(item)]
    if not isinstance(value, dict):
        return []
    nodes = [value]
    graph = value.get("@graph")
    if isinstance(graph, list):
        nodes.extend(node for item in graph for node in _nodes(item))
    return nodes


def is_product(node: dict[str, object]) -> bool:
    """Return whether a JSON-LD node declares schema.org Product."""
    node_type = node.get("@type")
    return node_type == "Product" or (isinstance(node_type, list) and "Product" in node_type)


def _string(value: object) -> str | None:
    return value if isinstance(value, str) else None


def _offers(value: object) -> list[dict[str, object]]:
    if isinstance(value, dict):
        return [value]
    if isinstance(value, list):
        return [offer for offer in value if isinstance(offer, dict)]
    return []


def product_facts(node: dict[str, object]) -> StructuredProductFacts:
    """Read generic source facts without normalization, summarization, or price calculation."""
    gtin = next((_string(node.get(key)) for key in ("gtin", "gtin8", "gtin12", "gtin13", "gtin14") if _string(node.get(key))), None)
    return StructuredProductFacts(
        source=node,
        name=_string(node.get("name")),
        description=_string(node.get("description")),
        sku=_string(node.get("sku")),
        mpn=_string(node.get("mpn")),
        gtin=gtin,
        image=node.get("image"),
        brand=node.get("brand"),
        color=_string(node.get("color")),
        material=_string(node.get("material")),
        category=_string(node.get("category")),
        url=_string(node.get("url")),
        offers=_offers(node.get("offers")),
    )


def extract_products(html: str) -> list[StructuredProductFacts]:
    """Return all schema.org Product nodes from valid JSON-LD script blocks."""
    return [
        product_facts(node)
        for extraction in extract_json_ld(html)
        if extraction.data is not None
        for node in _nodes(extraction.data)
        if is_product(node)
    ]
