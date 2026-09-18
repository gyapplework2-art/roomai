"""Reusable, local-only JSON inspection helpers for source investigations."""

from dataclasses import dataclass
from typing import Iterator


@dataclass(frozen=True)
class JsonPathMatch:
    path: str
    preview: str
    structured_attribute: bool


def compact_preview(value: object, limit: int = 160) -> str:
    """Return a bounded, one-line representation suitable for diagnostics."""
    text = repr(value).replace("\n", " ")
    return text if len(text) <= limit else f"{text[:limit - 3]}..."


def walk_json(value: object, path: str = "$") -> Iterator[tuple[str, object]]:
    """Yield every value with a stable JSON-style path."""
    yield path, value
    if isinstance(value, dict):
        for key, child in value.items():
            yield from walk_json(child, f"{path}.{key}")
    elif isinstance(value, list):
        for index, child in enumerate(value):
            yield from walk_json(child, f"{path}[{index}]")


def find_json_paths(value: object, keywords: list[str]) -> list[JsonPathMatch]:
    """Find keys or string values containing requested terms without interpreting them."""
    normalized_keywords = tuple(keyword.lower() for keyword in keywords)
    matches: list[JsonPathMatch] = []
    for path, current in walk_json(value):
        searchable = path.lower()
        if isinstance(current, str):
            searchable = f"{searchable} {current.lower()}"
        if any(keyword in searchable for keyword in normalized_keywords):
            matches.append(JsonPathMatch(
                path=path,
                preview=compact_preview(current),
                structured_attribute=path.endswith(".attributes") or ".attributes[" in path or ".specifications[" in path,
            ))
    return matches
