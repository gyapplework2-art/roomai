"""Controlled, stage-oriented catalog expansion CLI."""

import argparse
import asyncio
import json
from pathlib import Path

from crawler.core.catalog_batch import intake_candidates, persist_batch, promote_batch
from crawler.core.catalog_coverage import US_INITIAL_COVERAGE_PLAN, build_coverage_report
from crawler.core.config import get_settings
from crawler.core.fetcher import HttpFetcher
from crawler.core.supabase_repository import HttpxPostgrestTransport, SupabaseCatalogExecutor
from crawler.discovery.article import canonicalize_article_product_url, discover_article_sofa_urls, discover_article_sofas
from crawler.discovery.sitemap import extract_sitemap_urls
from crawler.vendors.article import ArticleVendorAdapter
from crawler.vendors.ikea import IkeaVendorAdapter

DEFAULT_LIMIT = 10
MAX_LIMIT = 50


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run one explicit, bounded catalog expansion stage.")
    parser.add_argument("stage", choices=["plan", "discover", "intake", "persist", "promote"])
    parser.add_argument("--vendor", choices=["article", "ikea"], default="article")
    parser.add_argument("--market", required=True, choices=["US", "CA"])
    parser.add_argument("--category", default="sofas")
    parser.add_argument("--source-url")
    parser.add_argument("--source-type", choices=["category", "sitemap"], default="category")
    parser.add_argument("--input", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--inventory", type=Path, help="JSON object of market/type counts for plan reporting.")
    parser.add_argument("--variant-id", action="append", default=[])
    parser.add_argument("--limit", type=int, default=DEFAULT_LIMIT)
    parser.add_argument("--execute", action="store_true", help="Request writes; existing environment write guards still apply.")
    return parser.parse_args()


def _validate_limit(limit: int) -> None:
    if limit < 1 or limit > MAX_LIMIT:
        raise ValueError(f"Limit must be between 1 and {MAX_LIMIT}.")


def _load_candidates(path: Path) -> list[dict[str, object]]:
    document = json.loads(path.read_text())
    candidates = document.get("candidates") if isinstance(document, dict) else None
    if not isinstance(candidates, list) or not all(isinstance(item, dict) for item in candidates):
        raise ValueError("Input must contain a candidates list.")
    return candidates


def _write(document: dict[str, object], output: Path | None) -> dict[str, object]:
    if output:
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(document, indent=2, default=str) + "\n")
    return document


def _plan_document(inventory_path: Path | None) -> dict[str, object]:
    counts: dict[tuple[str, str], int] = {}
    if inventory_path:
        raw = json.loads(inventory_path.read_text())
        if isinstance(raw, dict):
            for key, value in raw.items():
                if isinstance(key, str) and ":" in key and isinstance(value, int):
                    market, furniture_type = key.split(":", 1)
                    counts[(market, furniture_type)] = value
    report = build_coverage_report(US_INITIAL_COVERAGE_PLAN, counts)
    return {
        "stage": "plan",
        "targets": [target.__dict__ for target in US_INITIAL_COVERAGE_PLAN.targets],
        "coverage": {
            "rows": [row.__dict__ for row in report.rows],
            "summary": report.summary.__dict__,
        },
    }


async def run(args: argparse.Namespace) -> dict[str, object]:
    _validate_limit(args.limit)
    if args.stage == "plan":
        return _write(_plan_document(args.inventory), args.output)

    if args.stage == "discover":
        if args.vendor != "article" or args.market != "US" or args.category != "sofas":
            raise ValueError("The first working discovery adapter is Article US sofas; no IKEA discovery is claimed.")
        if not args.source_url:
            raise ValueError("discover requires an explicit --source-url.")
        fetched = await HttpFetcher().fetch(args.source_url)
        if not fetched.succeeded or fetched.response_text is None:
            raise RuntimeError("Approved discovery source could not be fetched.")
        discovery = (
            discover_article_sofa_urls(extract_sitemap_urls(fetched.response_text), fetched.final_url, limit=args.limit)
            if args.source_type == "sitemap"
            else discover_article_sofas(fetched.response_text, fetched.final_url, limit=args.limit)
        )
        document = {
            "stage": "discover",
            "summary": {"vendor": "Article", "market": "US", "category": "sofas", "requested_limit": args.limit, "unique_candidates_found": len(discovery.candidates)},
            "candidates": [candidate.__dict__ | {"discovered_at": candidate.discovered_at.isoformat()} for candidate in discovery.candidates],
        }
        return _write(document, args.output)

    if args.stage in {"intake", "persist"}:
        if args.input is None:
            raise ValueError(f"{args.stage} requires --input.")
        candidates = _load_candidates(args.input)
        if args.vendor == "ikea" and args.market != "US":
            raise ValueError("IKEA intake is currently limited to the configured US adapter market.")
        adapter = ArticleVendorAdapter(args.market) if args.vendor == "article" else IkeaVendorAdapter(args.market)
        intake = await intake_candidates(candidates, adapter=adapter, limit=args.limit)
        if args.stage == "intake":
            return _write({"stage": "intake", **intake.as_dict()}, args.output)
        settings = get_settings()
        executor = SupabaseCatalogExecutor(
            HttpxPostgrestTransport(settings) if args.execute and settings.catalog_allow_writes else None,
            settings=settings,
            write_enabled=args.execute,
        )
        persistence = await persist_batch(
            (item.plan for item in intake.ready if item.plan is not None),
            executor=executor,
            execute=args.execute,
        )
        return _write({"stage": "persist", "intake": intake.as_dict(), "persistence": persistence.as_dict()}, args.output)

    if args.stage == "promote":
        if not args.variant_id:
            raise ValueError("promote requires at least one --variant-id.")
        settings = get_settings()
        transport = HttpxPostgrestTransport(settings)
        promotion = await promote_batch(args.variant_id, transport=transport, settings=settings, execute=args.execute)
        return _write({"stage": "promote", **promotion.as_dict()}, args.output)

    raise ValueError("Unsupported stage.")


def main() -> None:
    args = parse_args()
    print(json.dumps(asyncio.run(run(args)), indent=2, default=str))


if __name__ == "__main__":
    main()
