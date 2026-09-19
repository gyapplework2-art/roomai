"""Inspect one explicitly supplied Article product URL as source-fact JSON.

Before use, developers must confirm Article's robots policies, terms, rate limits,
and access restrictions permit the request. This tool does not discover links,
write to a database, or bypass access controls.
"""

import argparse
import asyncio
import json

from crawler.core.fetcher import HttpFetcher
from crawler.core.normalizer import normalize_product
from crawler.models.product import CatalogProduct
from crawler.vendors.article import ArticleVendorAdapter


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Inspect one Article US product URL.")
    parser.add_argument("url", help="One explicit Article product URL to inspect.")
    parser.add_argument(
        "--normalized",
        action="store_true",
        help="Also display source dimension evidence and deterministic normalized dimensions.",
    )
    return parser.parse_args()


def _variant_report(source_variant, normalized_variant) -> dict[str, object]:
    source_dimensions = source_variant.dimensions
    normalized_dimensions = normalized_variant.dimensions
    return {
        "attributes": {
            "source_color": source_variant.source_color,
            "normalized_color": normalized_variant.normalized_color,
            "source_material": source_variant.source_material,
            "normalized_material": normalized_variant.normalized_material,
            "normalized_style": normalized_variant.normalized_style,
            "normalized_attributes": normalized_variant.variant_attributes.get("normalized_attributes", {}),
            "article_attributes": source_variant.variant_attributes.get("article_attributes", {}),
            "attribute_evidence": normalized_variant.variant_attributes.get("attribute_evidence", {}),
        },
        "dimensions": {
            "source_dimension_text": source_dimensions.source_dimension_text if source_dimensions else None,
            "source_dimension_details": source_dimensions.dimension_details if source_dimensions else {},
            "normalized": normalized_dimensions.model_dump(mode="json") if normalized_dimensions else None,
        },
        "media": {
            "image_count": len(source_variant.images),
            "images": [image.model_dump(mode="json") for image in source_variant.images],
        },
    }


def build_validation_report(product: CatalogProduct, *, normalized: bool) -> dict[str, object]:
    """Render raw Article facts separately from optional deterministic normalization."""
    normalized_product = normalize_product(product).product if normalized else None
    normalized_variants = (
        [
            _variant_report(source_variant, normalized_variant)
            for source_variant, normalized_variant in zip(product.variants, normalized_product.variants, strict=True)
        ]
        if normalized_product
        else None
    )
    return {
        "source_product": product.model_dump(mode="json"),
        "normalized": {
            "canonical_furniture_type_code": normalized_product.canonical_furniture_type_code,
            "variants": normalized_variants,
        } if normalized_product else None,
    }


async def inspect(url: str, normalized: bool = False) -> None:
    adapter = ArticleVendorAdapter()
    product = await adapter.fetch_product(url, HttpFetcher())
    print(json.dumps(build_validation_report(product, normalized=normalized), indent=2, sort_keys=True, default=str))


def main() -> None:
    args = parse_args()
    asyncio.run(inspect(args.url, args.normalized))


if __name__ == "__main__":
    main()
