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


def _print_dimensions(label: str, product) -> None:
    print(label)
    for index, variant in enumerate(product.variants, start=1):
        dimensions = variant.dimensions
        if dimensions is None:
            continue
        if len(product.variants) > 1:
            print(f"Variant {index}")
        if label == "SOURCE DIMENSIONS":
            for name in ("width", "depth", "height", "weight"):
                detail = dimensions.dimension_details.get(name)
                if isinstance(detail, dict) and "value" in detail and "unit" in detail:
                    print(f"{name}: {detail['value']} {detail['unit']}")
            if not dimensions.dimension_details and dimensions.source_dimension_text:
                print(dimensions.source_dimension_text)
        else:
            for name in ("width_cm", "depth_cm", "height_cm", "weight_kg"):
                value = getattr(dimensions, name)
                if value is not None:
                    print(f"{name}: {value}")


def _print_rich_attributes(source_product, normalized_product) -> None:
    print("RICH ATTRIBUTES")
    for index, (source_variant, normalized_variant) in enumerate(
        zip(source_product.variants, normalized_product.variants, strict=True), start=1
    ):
        if len(source_product.variants) > 1:
            print(f"Variant {index}")
        print(f"source_color: {source_variant.source_color}")
        print(f"normalized_color: {normalized_variant.normalized_color}")
        print(f"source_material: {source_variant.source_material}")
        print(f"normalized_material: {normalized_variant.normalized_material}")
        print(f"image_count: {len(source_variant.images)}")
        for image in source_variant.images:
            print(f"image_url: {image.source_url}")
        attributes = source_variant.variant_attributes.get("article_attributes", {})
        if attributes:
            print(f"article_attributes: {json.dumps(attributes, sort_keys=True)}")
        resolved_evidence = normalized_variant.variant_attributes.get("attribute_evidence", {})
        if resolved_evidence:
            print(f"resolved_attribute_evidence: {json.dumps(resolved_evidence, sort_keys=True)}")
    evidence = source_product.source_payload.get("attribute_evidence", {})
    if evidence:
        print(f"attribute_evidence: {json.dumps(evidence, sort_keys=True)}")


async def inspect(url: str, normalized: bool = False) -> None:
    adapter = ArticleVendorAdapter()
    product = await adapter.fetch_product(url, HttpFetcher())
    print(json.dumps(product.model_dump(mode="json"), indent=2, sort_keys=True))
    if normalized:
        normalized_product = normalize_product(product).product
        print()
        _print_dimensions("SOURCE DIMENSIONS", product)
        print()
        _print_dimensions("NORMALIZED DIMENSIONS", normalized_product)
        print()
        _print_rich_attributes(product, normalized_product)


def main() -> None:
    args = parse_args()
    asyncio.run(inspect(args.url, args.normalized))


if __name__ == "__main__":
    main()
