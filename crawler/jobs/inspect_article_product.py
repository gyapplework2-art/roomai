"""Inspect one explicitly supplied Article product URL as source-fact JSON.

Before use, developers must confirm Article's robots policies, terms, rate limits,
and access restrictions permit the request. This tool does not discover links,
write to a database, or bypass access controls.
"""

import argparse
import asyncio
import json

from crawler.core.fetcher import HttpFetcher
from crawler.vendors.article import ArticleVendorAdapter


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Inspect one Article US product URL.")
    parser.add_argument("url", help="One explicit Article product URL to inspect.")
    return parser.parse_args()


async def inspect(url: str) -> None:
    adapter = ArticleVendorAdapter()
    product = await adapter.fetch_product(url, HttpFetcher())
    print(json.dumps(product.model_dump(mode="json"), indent=2, sort_keys=True))


def main() -> None:
    args = parse_args()
    asyncio.run(inspect(args.url))


if __name__ == "__main__":
    main()
