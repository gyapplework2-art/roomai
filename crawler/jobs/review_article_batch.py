"""Bounded, review-only Article US sofa batch pipeline.

This job reads discovery candidates, fetches them sequentially, and produces a
human-reviewable report. It never applies persistence plans or writes to Supabase.
"""

import argparse
import asyncio
import json
from collections.abc import Iterable
from pathlib import Path
from typing import Protocol

from crawler.core.fetcher import HttpFetcher
from crawler.core.normalizer import normalize_product
from crawler.core.persistence import CatalogPersistencePlan, build_persistence_plan
from crawler.core.product_resolver import ResolutionProposal, propose_resolution
from crawler.models.product import CatalogProduct
from crawler.vendors.article import ArticleVendorAdapter

DEFAULT_LIMIT = 10
MAX_LIMIT = 50
COMPLETED_STATUSES = frozenset({"success", "normalization_review"})
FAILED_STATUSES = frozenset({"fetch_failed", "extraction_failed", "persistence_plan_failed"})


class ProductFetcher(Protocol):
    async def fetch(self, url: str):
        """Fetch a single URL using the generic fetcher result contract."""


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Review a bounded Article US sofa discovery batch.")
    parser.add_argument("--input", required=True, type=Path, help="Discovery JSON produced by discover_products.")
    parser.add_argument("--limit", type=int, default=DEFAULT_LIMIT)
    parser.add_argument("--output", type=Path, help="Optional local JSON review output path.")
    return parser.parse_args()


def load_candidates(path: Path) -> list[dict[str, object]]:
    """Load the existing discovery JSON shape without network or database access."""
    document = json.loads(path.read_text())
    candidates = document.get("candidates") if isinstance(document, dict) else None
    if not isinstance(candidates, list):
        raise ValueError("Discovery input must contain a candidates list.")
    return [candidate for candidate in candidates if isinstance(candidate, dict)]


def _review_variant(source_variant, normalized_variant) -> dict[str, object]:
    dimensions = source_variant.dimensions
    normalized_dimensions = normalized_variant.dimensions
    offer = source_variant.current_offer
    normalized_offer = normalized_variant.current_offer
    return {
        "vendor_sku": source_variant.vendor_sku,
        "vendor_variant_id": source_variant.vendor_variant_id,
        "variant_name": source_variant.variant_name,
        "source_color": source_variant.source_color,
        "normalized_color": normalized_variant.normalized_color,
        "source_material": source_variant.source_material,
        "normalized_material": normalized_variant.normalized_material,
        "article_attributes": source_variant.variant_attributes.get("article_attributes", {}),
        "resolved_attribute_evidence": normalized_variant.variant_attributes.get("attribute_evidence", {}),
        "source_dimension_text": dimensions.source_dimension_text if dimensions else None,
        "source_dimension_details": dimensions.dimension_details if dimensions else {},
        "normalized_dimensions": normalized_dimensions.model_dump(mode="json") if normalized_dimensions else None,
        "offer": {
            "currency": offer.currency if offer else None,
            "vendor_list_price": offer.vendor_list_price if offer else None,
            "vendor_sale_price": offer.vendor_sale_price if offer else None,
            "vendor_shipping_fee": offer.vendor_shipping_fee if offer else None,
            "source_availability": offer.source_availability if offer else None,
            "normalized_availability": normalized_offer.normalized_availability if normalized_offer else None,
            "delivery_text": offer.delivery_text if offer else None,
        },
        "image_urls": [image.source_url for image in source_variant.images],
    }


def _review_plan(plan: CatalogPersistencePlan) -> dict[str, object]:
    return {
        "vendor": plan.vendor.__dict__,
        "vendor_market": plan.vendor_market.__dict__,
        "product_natural_key": plan.product_natural_key,
        "canonical_furniture_type_code": plan.canonical_furniture_type_code,
        "publication_status": plan.product["publication_status"],
        "needs_taxonomy_review": plan.product["needs_taxonomy_review"],
        "review_reasons": list(plan.review_reasons),
        "variants": [
            {
                "natural_key": variant.natural_key,
                "publication_status": variant.values["publication_status"],
                "has_dimensions": variant.dimensions is not None,
                "has_current_offer": variant.offer is not None,
                "image_count": len(variant.images),
            }
            for variant in plan.variants
        ],
    }


def _review_resolutions(product: CatalogProduct, previous: Iterable[CatalogProduct]) -> list[dict[str, object]]:
    proposals: list[dict[str, object]] = []
    for prior_product in previous:
        proposal: ResolutionProposal = propose_resolution(prior_product, product)
        proposals.append({
            "candidate_product_url": prior_product.product_url,
            "relationship_type": proposal.relationship_type,
            "confidence": proposal.confidence,
            "requires_review": proposal.requires_review,
            "evidence": [evidence.__dict__ for evidence in proposal.evidence],
        })
    return proposals


def _quality_counts(products: list[dict[str, object]]) -> dict[str, int]:
    successful = [product for product in products if product["status"] in COMPLETED_STATUSES]
    variants = [variant for product in successful for variant in product.get("variants", [])]
    return {
        "missing_dimensions": sum(variant["normalized_dimensions"] is None for variant in variants),
        "missing_price": sum(variant["offer"]["vendor_sale_price"] is None for variant in variants),
        "missing_images": sum(not variant["image_urls"] for variant in variants),
        "missing_material": sum(variant["source_material"] is None for variant in variants),
        "missing_color": sum(variant["source_color"] is None for variant in variants),
        "unknown_availability": sum(variant["offer"]["normalized_availability"] is None for variant in variants),
    }


def _completed_status(normalization_reasons: tuple[str, ...], plan_reasons: tuple[str, ...]) -> tuple[str, list[str]]:
    review_reasons = list(dict.fromkeys((*normalization_reasons, *plan_reasons)))
    return ("normalization_review" if review_reasons else "success", review_reasons)


async def review_candidates(
    candidates: list[dict[str, object]],
    *,
    limit: int = DEFAULT_LIMIT,
    fetcher: ProductFetcher | None = None,
) -> dict[str, object]:
    """Sequentially inspect discovery candidates without applying any persistence plan."""
    if limit < 1 or limit > MAX_LIMIT:
        raise ValueError(f"Batch limit must be between 1 and {MAX_LIMIT}.")
    active_fetcher = fetcher or HttpFetcher()
    adapter = ArticleVendorAdapter()
    processed: list[dict[str, object]] = []
    successful_records: list[CatalogProduct] = []

    for candidate in candidates[:limit]:
        product_url = candidate.get("product_url")
        if not isinstance(product_url, str):
            processed.append({"status": "fetch_failed", "product_url": None, "stage": "input", "reason": "Candidate is missing product_url."})
            continue
        try:
            fetch_result = await active_fetcher.fetch(product_url)
        except Exception as error:
            processed.append({"status": "fetch_failed", "product_url": product_url, "stage": "fetch", "reason": str(error)})
            continue
        if not fetch_result.succeeded or fetch_result.response_text is None:
            reason = fetch_result.error.message if fetch_result.error else "No HTML returned."
            processed.append({"status": "fetch_failed", "product_url": product_url, "stage": "fetch", "reason": reason})
            continue
        try:
            source_product = adapter.parse_product(
                fetch_result.response_text,
                fetch_result.final_url,
                fetch_result.fetched_at,
            )
        except Exception as error:
            processed.append({"status": "extraction_failed", "product_url": product_url, "stage": "extraction", "reason": str(error)})
            continue
        try:
            normalization = normalize_product(source_product)
        except Exception as error:
            processed.append({"status": "normalization_review", "product_url": product_url, "stage": "normalization", "reason": str(error)})
            continue
        try:
            plan = build_persistence_plan(source_product)
        except Exception as error:
            processed.append({"status": "persistence_plan_failed", "product_url": product_url, "stage": "persistence_plan", "reason": str(error)})
            continue

        resolutions = _review_resolutions(source_product, successful_records)
        status, review_reasons = _completed_status(
            normalization.review_reasons,
            plan.review_reasons,
        )
        processed.append({
            "status": status,
            "product_url": source_product.product_url,
            "article_page_id": source_product.source_payload.get("article_page_id"),
            "vendor": source_product.source_payload.get("vendor"),
            "vendor_market_code": source_product.vendor_market_code,
            "source_category": source_product.source_category or candidate.get("source_category"),
            "vendor_product_id": source_product.vendor_product_id,
            "product_name": source_product.source_product_name,
            "source_description": source_product.source_description,
            "brand": source_product.source_payload.get("brand"),
            "related_products": source_product.source_payload.get("related_products"),
            "attribute_evidence": source_product.source_payload.get("attribute_evidence", {}),
            "variants": [
                _review_variant(source_variant, normalized_variant)
                for source_variant, normalized_variant in zip(source_product.variants, normalization.product.variants, strict=True)
            ],
            "resolution_proposals": resolutions,
            "normalization_review_reasons": list(normalization.review_reasons),
            "persistence_review_reasons": list(plan.review_reasons),
            "review_reasons": review_reasons,
            "persistence_plan": _review_plan(plan),
        })
        successful_records.append(source_product)

    successful = sum(product["status"] in COMPLETED_STATUSES for product in processed)
    reviews = sum(product["status"] == "normalization_review" for product in processed)
    failed = sum(product["status"] in FAILED_STATUSES for product in processed)
    unexpected_statuses = sorted(
        {product["status"] for product in processed} - COMPLETED_STATUSES - FAILED_STATUSES
    )
    return {
        "summary": {
            "vendor": "Article",
            "market": "US",
            "category": "sofas",
            "requested_limit": limit,
            "candidates_received": len(candidates),
            "products_attempted": len(processed),
            "products_successful": successful,
            "products_with_review": reviews,
            "products_failed": failed,
            "unexpected_statuses": unexpected_statuses,
            **_quality_counts(processed),
        },
        "products": processed,
    }


async def run(args: argparse.Namespace) -> dict[str, object]:
    document = await review_candidates(load_candidates(args.input), limit=args.limit)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(document, indent=2, default=str) + "\n")
    return document


def main() -> None:
    args = parse_args()
    document = asyncio.run(run(args))
    print(json.dumps(document["summary"], indent=2))
    for product in document["products"]:
        print(json.dumps(product, default=str))


if __name__ == "__main__":
    main()
