"""Generate a database-ready plan for one URL without any Supabase operation."""

import argparse
import asyncio
import json

from crawler.core.dry_run import build_catalog_dry_run
from crawler.core.fetcher import HttpFetcher
from crawler.core.normalizer import normalize_product
from crawler.core.persistence import build_persistence_plan
from crawler.vendors.article import ArticleVendorAdapter
from crawler.vendors.ikea import IkeaVendorAdapter


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Dry-run one catalog product without database writes.")
    parser.add_argument("--vendor", required=True, choices=["article", "ikea"])
    parser.add_argument("--url", required=True)
    parser.add_argument("--normalized", action="store_true")
    return parser.parse_args()


def _adapter(vendor: str):
    return ArticleVendorAdapter() if vendor == "article" else IkeaVendorAdapter()


async def dry_run(url: str, vendor: str, *, normalized: bool = False) -> dict[str, object]:
    """Fetch one explicit page, plan writes, and return preflight JSON without repository use."""
    result = await HttpFetcher().fetch(url)
    if not result.succeeded or result.response_text is None:
        reason = result.error.message if result.error else "No HTML returned."
        raise RuntimeError(f"Product fetch failed: {reason}")
    product = _adapter(vendor).parse_product(result.response_text, result.final_url, result.fetched_at)
    if normalized:
        product = normalize_product(product).product
    return build_catalog_dry_run(build_persistence_plan(product)).as_dict()


def main() -> None:
    args = parse_args()
    print(json.dumps(asyncio.run(dry_run(args.url, args.vendor, normalized=args.normalized)), indent=2, default=str))


if __name__ == "__main__":
    main()
