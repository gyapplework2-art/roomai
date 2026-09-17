"""Controlled discovery-only CLI for one explicitly supplied Article US sofa listing page."""

import argparse
import asyncio
import json
from pathlib import Path

from crawler.core.fetcher import HttpFetcher
from crawler.discovery.article import discover_article_sofa_urls, discover_article_sofas
from crawler.discovery.sitemap import extract_sitemap_urls


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Discover bounded Article US sofa product URL candidates.")
    parser.add_argument("vendor", choices=["article"])
    parser.add_argument("--market", required=True, choices=["US"])
    parser.add_argument("--category", required=True, choices=["sofas"])
    parser.add_argument("--source-url", required=True, help="One public Article US sofa listing or sitemap URL approved for inspection.")
    parser.add_argument("--source-type", choices=["category", "sitemap"], default="category")
    parser.add_argument("--limit", type=int, default=30)
    parser.add_argument("--output", type=Path, help="Optional local JSON output path.")
    return parser.parse_args()


async def run(args: argparse.Namespace) -> dict[str, object]:
    """Fetch one public source page and emit reviewable candidates without persistence."""
    result = await HttpFetcher().fetch(args.source_url)
    if not result.succeeded or result.response_text is None:
        message = result.error.message if result.error else "No HTML returned."
        raise RuntimeError(f"Discovery fetch failed: {message}")
    discovery = (
        discover_article_sofa_urls(extract_sitemap_urls(result.response_text), result.final_url, limit=args.limit)
        if args.source_type == "sitemap"
        else discover_article_sofas(result.response_text, result.final_url, limit=args.limit)
    )
    document = {
        "summary": {
            "vendor": "Article",
            "market": "US",
            "category": "sofas",
            "requested_limit": discovery.requested_limit,
            "unique_candidates_found": len(discovery.candidates),
            "duplicates_skipped": discovery.duplicates_skipped,
            "invalid_non_product_urls_skipped": discovery.invalid_urls_skipped,
        },
        "candidates": [candidate.__dict__ | {"discovered_at": candidate.discovered_at.isoformat()} for candidate in discovery.candidates],
    }
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(document, indent=2) + "\n")
    return document


def main() -> None:
    args = parse_args()
    document = asyncio.run(run(args))
    print(json.dumps(document, indent=2))


if __name__ == "__main__":
    main()
