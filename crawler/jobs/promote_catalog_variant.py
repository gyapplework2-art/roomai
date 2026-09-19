"""Controlled one-variant catalog promotion CLI."""

import argparse
import asyncio
import json

from crawler.core.catalog_promotion import (
    HttpxCatalogPromotionTransport,
    PromotionReport,
    promote_catalog_variant,
)
from crawler.core.config import get_settings


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Validate or promote one catalog variant.")
    parser.add_argument("--variant-id", required=True)
    parser.add_argument("--execute", action="store_true")
    return parser.parse_args()


async def run(variant_id: str, execute: bool) -> dict[str, object]:
    settings = get_settings()
    try:
        report = await promote_catalog_variant(
            variant_id,
            execution_requested=execute,
            transport=HttpxCatalogPromotionTransport(settings),
            settings=settings,
        )
        return report.as_dict()
    except RuntimeError as error:
        return PromotionReport(
            execution_requested=execute,
            writes_enabled=settings.catalog_allow_writes,
            variant_id=variant_id,
            blocking_reasons=[str(error)],
        ).as_dict()


def main() -> None:
    args = parse_args()
    print(json.dumps(asyncio.run(run(args.variant_id, args.execute)), indent=2))


if __name__ == "__main__":
    main()
