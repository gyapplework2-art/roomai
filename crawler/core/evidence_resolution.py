"""Generic deterministic precedence resolution for extracted attribute evidence."""

from dataclasses import dataclass
from typing import Literal

EvidenceSource = Literal["official_api", "structured_data", "labeled_html", "vendor_url_slug"]
AttributeConcept = Literal["color", "material", "style"]
_PRIORITY = {"official_api": 1, "structured_data": 2, "labeled_html": 3, "vendor_url_slug": 4}
_LABEL_CONCEPTS = {
    "color": "color", "colour": "color", "finish": "color", "fabric color": "color", "leather color": "color", "upholstery color": "color",
    "material": "material", "materials": "material", "upholstery": "material", "upholstery material": "material", "fabric": "material", "leather": "material",
    "style": "style", "design style": "style", "furniture style": "style", "product style": "style",
}


@dataclass(frozen=True)
class AttributeCandidate:
    concept: AttributeConcept
    value: str
    source: EvidenceSource
    priority: int
    method: Literal["deterministic"] = "deterministic"


@dataclass(frozen=True)
class ResolvedAttribute:
    selected: AttributeCandidate | None
    candidates: tuple[AttributeCandidate, ...]
    review_reasons: tuple[str, ...]


def resolve_attribute(candidates: list[AttributeCandidate]) -> ResolvedAttribute:
    """Select strongest explicit evidence and surface material conflicts without discarding evidence."""
    ordered = tuple(sorted(candidates, key=lambda candidate: candidate.priority))
    selected = ordered[0] if ordered else None
    reasons: list[str] = []
    if selected and any(candidate.value.casefold() != selected.value.casefold() for candidate in ordered[1:]):
        reasons.append(f"attribute_conflict:{selected.concept}")
    return ResolvedAttribute(selected, ordered, tuple(reasons))


def variant_attribute_candidates(
    source_color: str | None,
    source_material: str | None,
    attributes: dict[str, object],
    url_evidence: dict[str, object],
    source_style: str | None = None,
) -> dict[str, list[AttributeCandidate]]:
    """Build generic candidates from explicit fields, labeled attributes, and configured URL evidence."""
    candidates: dict[str, list[AttributeCandidate]] = {"color": [], "material": [], "style": []}
    if source_color:
        candidates["color"].append(AttributeCandidate("color", source_color, "structured_data", _PRIORITY["structured_data"]))
    if source_material:
        candidates["material"].append(AttributeCandidate("material", source_material, "structured_data", _PRIORITY["structured_data"]))
    if source_style:
        candidates["style"].append(AttributeCandidate("style", source_style, "structured_data", _PRIORITY["structured_data"]))
    for collection_key in ("article_attributes", "ikea_labeled_attributes", "article_html_specifications"):
        collection = attributes.get(collection_key)
        if not isinstance(collection, dict):
            continue
        for label, value in collection.items():
            concept = _LABEL_CONCEPTS.get(label.strip().casefold().rstrip(":").strip()) if isinstance(label, str) else None
            if concept and isinstance(value, str) and value.strip():
                candidates[concept].append(AttributeCandidate(concept, value, "labeled_html", _PRIORITY["labeled_html"]))
    for concept in ("color", "material"):
        values = url_evidence.get(concept)
        if isinstance(values, list):
            for value in values:
                if isinstance(value, dict) and isinstance(value.get("value"), str):
                    candidates[concept].append(AttributeCandidate(concept, value["value"], "vendor_url_slug", _PRIORITY["vendor_url_slug"]))
    return candidates
