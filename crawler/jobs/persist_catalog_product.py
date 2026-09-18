"""Controlled one-product catalog persistence CLI with dry-run as the default."""

import argparse
import asyncio
import json

from crawler.core.config import get_settings
from crawler.core.normalizer import normalize_product
from crawler.core.persistence import build_persistence_plan
from crawler.core.supabase_repository import HttpxPostgrestTransport, SupabaseCatalogExecutor
from crawler.core.fetcher import HttpFetcher
from crawler.vendors.article import ArticleVendorAdapter
from crawler.vendors.ikea import IkeaVendorAdapter


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Persist one catalog product only when both write guards are enabled.")
    parser.add_argument("--vendor", required=True, choices=["article", "ikea"])
    parser.add_argument("--url", required=True)
    parser.add_argument("--normalized", action="store_true")
    parser.add_argument("--execute", action="store_true")
    return parser.parse_args()


def _adapter(vendor: str):
    return ArticleVendorAdapter() if vendor == "article" else IkeaVendorAdapter()


async def persist_one(url: str, vendor: str, *, normalized: bool, execute: bool) -> dict[str, object]:
    """Fetch and plan one product; executor mutation needs both explicit guards."""
    fetch_result = await HttpFetcher().fetch(url)
    if not fetch_result.succeeded or fetch_result.response_text is None:
        reason = fetch_result.error.message if fetch_result.error else "No HTML returned."
        raise RuntimeError(f"Product fetch failed: {reason}")
    product = _adapter(vendor).parse_product(fetch_result.response_text, fetch_result.final_url, fetch_result.fetched_at)
    if normalized:
        product = normalize_product(product).product
    settings = get_settings()
    executor = SupabaseCatalogExecutor(
        HttpxPostgrestTransport(settings) if execute and settings.catalog_allow_writes else None,
        settings=settings,
        write_enabled=execute,
    )
    return (await executor.execute(build_persistence_plan(product), execution_requested=execute)).as_dict()


def main() -> None:
    args = parse_args()
    print(json.dumps(asyncio.run(persist_one(args.url, args.vendor, normalized=args.normalized, execute=args.execute)), indent=2))


if __name__ == "__main__":
    main()