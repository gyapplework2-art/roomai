"""Conservative, non-mutating catalog identity resolution proposals."""

from dataclasses import dataclass
from typing import Literal

from crawler.models.product import CatalogProduct

RelationshipType = Literal["same_product_candidate", "variant_candidate", "related_only", "insufficient_evidence"]


@dataclass(frozen=True)
class ResolutionEvidence:
    code: str
    detail: str


@dataclass(frozen=True)
class ResolutionProposal:
    candidates: tuple[CatalogProduct, ...]
    relationship_type: RelationshipType
    confidence: Literal["low", "medium"]
    requires_review: bool
    evidence: tuple[ResolutionEvidence, ...]


def _page_id(product: CatalogProduct) -> str | None:
    value = product.source_payload.get("article_page_id")
    return value if isinstance(value, str) else None


def _related_ids(product: CatalogProduct) -> set[str]:
    value = product.source_payload.get("related_article_page_ids")
    return {item for item in value if isinstance(item, str)} if isinstance(value, list) else set()


def propose_resolution(left: CatalogProduct, right: CatalogProduct) -> ResolutionProposal:
    """Propose only conservative relationships from explicit source evidence."""
    evidence: list[ResolutionEvidence] = []
    if left.vendor_market_code != right.vendor_market_code:
        evidence.append(ResolutionEvidence("different_vendor_market", "Vendor markets differ."))
        return ResolutionProposal((left, right), "insufficient_evidence", "low", True, tuple(evidence))
    if left.source_payload.get("vendor") == right.source_payload.get("vendor"):
        evidence.append(ResolutionEvidence("same_vendor", "Explicit source vendor matches."))
    left_id, right_id = _page_id(left), _page_id(right)
    if right_id and right_id in _related_ids(left) or left_id and left_id in _related_ids(right):
        evidence.append(ResolutionEvidence("vendor_related_product", "Vendor supplied an isRelatedTo relationship."))
        return ResolutionProposal((left, right), "related_only", "low", True, tuple(evidence))
    if left.vendor_product_id and left.vendor_product_id == right.vendor_product_id:
        evidence.append(ResolutionEvidence("same_vendor_product_id", "Explicit vendor product identifiers match."))
        return ResolutionProposal((left, right), "same_product_candidate", "medium", True, tuple(evidence))
    evidence.append(ResolutionEvidence("insufficient_explicit_evidence", "Names alone do not establish identity."))
    return ResolutionProposal((left, right), "insufficient_evidence", "low", True, tuple(evidence))
