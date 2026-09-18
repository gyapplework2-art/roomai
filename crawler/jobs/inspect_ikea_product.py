"""Review one explicitly supplied IKEA US product URL without persistence or discovery."""

import argparse
import asyncio
import json
from typing import Protocol

from crawler.core.fetcher import HttpFetcher
from crawler.core.normalizer import normalize_product
from crawler.models.product import CatalogProduct
from crawler.vendors.ikea import IkeaVendorAdapter


class ProductFetcher(Protocol):
    async def fetch(self, url: str):
        """Fetch one explicit URL using the established fetch-result contract."""


def _variant_report(source_variant, normalized_variant) -> dict[str, object]:
    source_dimensions = source_variant.dimensions
    normalized_dimensions = normalized_variant.dimensions
    offer = source_variant.current_offer
    normalized_offer = normalized_variant.current_offer
    return {
        "identity": {
            "vendor_sku": source_variant.vendor_sku,
            "vendor_variant_id": source_variant.vendor_variant_id,
            "variant_name": source_variant.variant_name,
        },
        "attributes": {
            "source_color": source_variant.source_color,
            "normalized_color": normalized_variant.normalized_color,
            "source_material": source_variant.source_material,
            "normalized_material": normalized_variant.normalized_material,
            "labeled_html_attributes": source_variant.variant_attributes.get(
                "ikea_labeled_attributes", {}
            ),
        },
        "dimensions": {
            "source_dimension_text": source_dimensions.source_dimension_text if source_dimensions else None,
            "source_dimension_details": source_dimensions.dimension_details if source_dimensions else {},
            "normalized": normalized_dimensions.model_dump(mode="json") if normalized_dimensions else None,
        },
        "commercial_facts": {
            "currency": offer.currency if offer else None,
            "vendor_list_price": offer.vendor_list_price if offer else None,
            "vendor_sale_price": offer.vendor_sale_price if offer else None,
            "vendor_shipping_fee": offer.vendor_shipping_fee if offer else None,
            "source_availability": offer.source_availability if offer else None,
            "normalized_availability": normalized_offer.normalized_availability if normalized_offer else None,
            "delivery_shipping_text": offer.delivery_text if offer else None,
        },
        "media": {
            "image_count": len(source_variant.images),
            "images": [image.model_dump(mode="json") for image in source_variant.images],
        },
    }


def _completeness(product: CatalogProduct, variants: list[dict[str, object]], review_reasons: list[str]) -> dict[str, object]:
    variant = variants[0] if variants else {}
    attributes = variant.get("attributes", {})
    dimensions = variant.get("dimensions", {}).get("normalized") if isinstance(variant.get("dimensions"), dict) else None
    commercial = variant.get("commercial_facts", {})
    identity_values = [product.product_url, product.vendor_product_id, product.source_product_name]
    dimensions_present = sum(
        value is not None for value in (dimensions or {}).values() if isinstance(dimensions, dict)
    )
    fields = {
        "identity": "complete" if all(identity_values) else "partial",
        "description": "present" if product.source_description else "missing",
        "color": "present" if isinstance(attributes, dict) and attributes.get("source_color") else "missing",
        "material": "present" if isinstance(attributes, dict) and attributes.get("source_material") else "missing",
        "dimensions": "complete" if dimensions_present >= 3 else "partial" if dimensions_present else "missing",
        "price": "present" if isinstance(commercial, dict) and commercial.get("vendor_sale_price") is not None else "missing",
        "availability": "present" if isinstance(commercial, dict) and commercial.get("source_availability") else "missing",
        "images": sum(item["media"]["image_count"] for item in variants),
        "labeled_attributes": sum(len(item["attributes"]["labeled_html_attributes"]) for item in variants),
        "review_reasons": review_reasons,
    }
    present = sum(value in {"complete", "present"} for value in fields.values() if isinstance(value, str))
    missing = sum(value == "missing" for value in fields.values() if isinstance(value, str))
    return fields | {"fields_present": present, "fields_missing": missing}


def build_validation_report(product: CatalogProduct, *, normalized: bool) -> dict[str, object]:
    """Render source and optional normalized facts into a compact, JSON-safe review document."""
    normalization = normalize_product(product) if normalized else None
    normalized_product = normalization.product if normalization else product
    variants = [
        _variant_report(source_variant, normalized_variant)
        for source_variant, normalized_variant in zip(product.variants, normalized_product.variants, strict=True)
    ]
    review_reasons = list(normalization.review_reasons) if normalization else []
    raw_json_ld = product.source_payload.get("json_ld")
    return {
        "identity": {
            "vendor": product.source_payload.get("vendor"),
            "vendor_market_code": product.vendor_market_code,
            "product_url": product.product_url,
            "vendor_product_id": product.vendor_product_id,
            "product_name": product.source_product_name,
            "source_category": product.source_category,
            "source_description": product.source_description,
        },
        "variants": variants,
        "evidence": {
            "structured_json_ld": {
                "present": isinstance(raw_json_ld, dict),
                "fields": sorted(raw_json_ld) if isinstance(raw_json_ld, dict) else [],
                "source": "json_ld",
            },
            "labeled_html": [item["attributes"]["labeled_html_attributes"] for item in variants],
            "url_evidence": product.source_payload.get("url_evidence", {}),
        },
        "completeness": _completeness(product, variants, review_reasons),
    }


async def inspect_product(url: str, *, normalized: bool = False, fetcher: ProductFetcher | None = None) -> dict[str, object]:
    """Fetch exactly one explicit IKEA URL and return its review-only validation report."""
    result = await (fetcher or HttpFetcher()).fetch(url)
    if not result.succeeded or result.response_text is None:
        reason = result.error.message if result.error else "No HTML returned."
        raise RuntimeError(f"IKEA product fetch failed: {reason}")
    product = IkeaVendorAdapter().parse_product(result.response_text, result.final_url, result.fetched_at)
    return build_validation_report(product, normalized=normalized)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Validate one explicitly supplied IKEA US product URL.")
    parser.add_argument("url", help="One explicit IKEA US product URL.")
    parser.add_argument("--normalized", action="store_true", help="Include deterministic normalized dimensions and attributes.")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    print(json.dumps(asyncio.run(inspect_product(args.url, normalized=args.normalized)), indent=2, default=str))


if __name__ == "__main__":
    main()
