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


def main() -> None:
    args = parse_args()
    asyncio.run(inspect(args.url, args.normalized))


if __name__ == "__main__":
    main()
