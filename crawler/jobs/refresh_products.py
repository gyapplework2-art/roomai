"""Bounded existing-product catalog refresh CLI; dry-run by default."""

import argparse
import asyncio
import json

from crawler.core.catalog_refresh import (
    DEFAULT_REFRESH_LIMIT,
    refresh_catalog,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Refresh existing catalog products. "
            "Dry-run unless --execute and CATALOG_ALLOW_WRITES=true."
        )
    )
    parser.add_argument("--market", default="article-us")
    parser.add_argument("--limit", type=int, default=DEFAULT_REFRESH_LIMIT)
    parser.add_argument("--execute", action="store_true")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    report = asyncio.run(
        refresh_catalog(
            market_code=args.market,
            limit=args.limit,
            execute=args.execute,
        )
    )
    print(json.dumps(report.as_dict(), indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
