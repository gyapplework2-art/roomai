"""Controlled, stage-oriented catalog expansion CLI."""

import argparse
import asyncio
import json
from pathlib import Path
from urllib.parse import urlsplit

from crawler.core.catalog_batch import intake_candidates, persist_batch, promote_batch
from crawler.core.catalog_coverage import US_INITIAL_COVERAGE_PLAN, build_coverage_report, select_expansion_targets
from crawler.core.catalog_inventory import HttpxCatalogInventoryTransport, load_inventory_counts
from crawler.core.config import get_settings
from crawler.core.dry_run import build_catalog_dry_run
from crawler.core.fetcher import HttpFetcher
from crawler.core.supabase_repository import HttpxPostgrestTransport, SupabaseCatalogExecutor
from crawler.discovery.article import DiscoveryResult, canonicalize_article_product_url, discover_article_category, discover_article_sofa_urls
from crawler.discovery.source_map import ApprovedDiscoverySource, approved_sources_for_target, select_approved_source
from crawler.discovery.sitemap import extract_sitemap_urls
from crawler.vendors.article import ArticleVendorAdapter
from crawler.vendors.ikea import IkeaVendorAdapter

DEFAULT_LIMIT = 10
MAX_LIMIT = 50


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run one explicit, bounded catalog expansion stage.")
    parser.add_argument("stage", choices=["plan", "discover", "intake", "persist", "promote", "expand"])
    parser.add_argument("--vendor", choices=["article", "ikea"], default="article")
    parser.add_argument("--market", required=True, choices=["US", "CA"])
    parser.add_argument("--category", default="sofas")
    parser.add_argument("--furniture-type", help="Canonical type for approved-source discovery.")
    parser.add_argument("--source-url")
    parser.add_argument("--source-type", choices=["category", "sitemap"], default="category")
    parser.add_argument("--input", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--inventory", type=Path, help="JSON object of market/type counts for plan reporting.")
    parser.add_argument(
        "--live-inventory",
        action="store_true",
        help="Read active catalog inventory from Supabase for plan reporting.",
    )
    parser.add_argument("--variant-id", action="append", default=[])
    parser.add_argument("--limit", type=int, default=DEFAULT_LIMIT)
    parser.add_argument("--target-limit", type=int, default=1, help="Maximum approved coverage targets discovered by expand.")
    parser.add_argument("--execute", action="store_true", help="Request writes; existing environment write guards still apply.")
    return parser.parse_args()


def _validate_limit(limit: int) -> None:
    if limit < 1 or limit > MAX_LIMIT:
        raise ValueError(f"Limit must be between 1 and {MAX_LIMIT}.")


def _load_candidates(path: Path) -> list[dict[str, object]]:
    document = json.loads(path.read_text())
    candidates = document.get("candidates") if isinstance(document, dict) else None
    if isinstance(document, dict) and document.get("stage") == "expand":
        targets = document.get("targets")
        if not isinstance(targets, list) or not all(isinstance(target, dict) and isinstance(target.get("candidates"), list) for target in targets):
            raise ValueError("Expansion input must contain target candidate lists.")
        candidates = [candidate for target in targets for candidate in target["candidates"]]
    if not isinstance(candidates, list) or not all(isinstance(item, dict) for item in candidates):
        raise ValueError("Input must contain a candidates list.")
    return candidates


def _approved_candidates(candidates: list[dict[str, object]], *, vendor: str, market: str) -> list[dict[str, object]]:
    approved = [
        source
        for target in US_INITIAL_COVERAGE_PLAN.targets
        for source in approved_sources_for_target(target.market_code, target.furniture_type_code)
        if source.vendor == vendor and source.vendor_market_code == market
    ]
    validated: list[dict[str, object]] = []
    seen_urls: set[str] = set()
    for candidate in candidates:
        source = next((item for item in approved if
            candidate.get("source_page_url") == item.source_url
            and candidate.get("vendor") == "Article"
            and candidate.get("vendor_market_code") == item.vendor_market_code
            and candidate.get("source_category") == item.source_category
        ), None)
        product_url = candidate.get("product_url")
        if source is None or not isinstance(product_url, str):
            raise ValueError("Candidate is not from an approved discovery source.")
        canonical = canonicalize_article_product_url(product_url) if vendor == "article" else None
        if canonical is None or urlsplit(canonical[0]).hostname != urlsplit(source.source_url).hostname:
            raise ValueError("Candidate product URL is not approved for its source.")
        if canonical[0] in seen_urls:
            continue
        seen_urls.add(canonical[0])
        validated.append({**candidate, "product_url": canonical[0], "furniture_type_code": source.furniture_type_code})
    return validated


def _write(document: dict[str, object], output: Path | None) -> dict[str, object]:
    if output:
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(document, indent=2, default=str) + "\n")
    return document


def _coverage_document(counts: dict[tuple[str, str], int], *, limit: int) -> dict[str, object]:
    report = build_coverage_report(US_INITIAL_COVERAGE_PLAN, counts)
    expansion_targets = select_expansion_targets(report, limit=limit)
    return {
        "stage": "plan",
        "targets": [target.__dict__ for target in US_INITIAL_COVERAGE_PLAN.targets],
        "coverage": {
            "rows": [row.__dict__ for row in report.rows],
            "summary": report.summary.__dict__,
            "expansion_targets": [row.__dict__ for row in expansion_targets],
            "expansion_source_status": [
                {
                    "market_code": target.market_code,
                    "furniture_type_code": target.furniture_type_code,
                    "source_available": bool(sources),
                    "approved_sources": [source.__dict__ for source in sources],
                }
                for target in expansion_targets
                for sources in [approved_sources_for_target(target.market_code, target.furniture_type_code)]
            ],
        },
    }


def _plan_document(inventory_path: Path | None, *, limit: int) -> dict[str, object]:
    counts: dict[tuple[str, str], int] = {}
    if inventory_path:
        raw = json.loads(inventory_path.read_text())
        if isinstance(raw, dict):
            for key, value in raw.items():
                if isinstance(key, str) and ":" in key and isinstance(value, int):
                    market, furniture_type = key.split(":", 1)
                    counts[(market, furniture_type)] = value
    return _coverage_document(counts, limit=limit)


def _approved_source(args: argparse.Namespace) -> ApprovedDiscoverySource:
    furniture_type = getattr(args, "furniture_type", None)
    if furniture_type:
        source = select_approved_source(args.market, furniture_type)
        if args.vendor != source.vendor:
            raise ValueError("Requested vendor is not approved for this target.")
        if args.source_url and args.source_url != source.source_url:
            raise ValueError("Discovery source URL is not approved for this target.")
        return source
    if not args.source_url:
        raise ValueError("discover requires --furniture-type or an approved --source-url.")
    for target in US_INITIAL_COVERAGE_PLAN.targets:
        for source in approved_sources_for_target(target.market_code, target.furniture_type_code):
            if source.market_code == args.market and source.source_url == args.source_url and source.vendor == args.vendor and source.source_category == args.category and source.source_type == args.source_type:
                return source
    raise ValueError("Discovery source URL is not approved for this target.")


def _discover_article_source(source: ApprovedDiscoverySource, html: str, page_url: str, limit: int, approved_host: str) -> DiscoveryResult:
    if source.vendor_market_code != "US":
        raise ValueError("Article discovery adapter currently supports US only.")
    if source.source_type == "sitemap":
        return discover_article_sofa_urls(extract_sitemap_urls(html), page_url, limit=limit, approved_host=approved_host)
    return discover_article_category(html, page_url, source_category=source.source_category, limit=limit, approved_host=approved_host)


_DISCOVERY_ADAPTERS = {"article": _discover_article_source}


async def _discover_source(source: ApprovedDiscoverySource, *, fetcher: HttpFetcher, limit: int) -> dict[str, object]:
    adapter = _DISCOVERY_ADAPTERS.get(source.vendor.lower())
    if adapter is None or (source.vendor.lower() == "article" and source.vendor_market_code != "US"):
        return {"source": source.__dict__, "status": "adapter_unavailable", "candidates": []}
    fetched = await fetcher.fetch(source.source_url)
    approved_host = urlsplit(source.source_url).hostname
    if not fetched.succeeded or fetched.response_text is None or urlsplit(fetched.final_url).hostname != approved_host:
        return {"source": source.__dict__, "status": "source_unavailable", "candidates": []}
    discovery = adapter(source, fetched.response_text, fetched.final_url, limit, approved_host)
    candidates = [
        candidate.__dict__ | {"discovered_at": candidate.discovered_at.isoformat()}
        for candidate in discovery.candidates
        if urlsplit(candidate.product_url).hostname == approved_host
    ]
    return {"source": source.__dict__, "status": "candidates_found" if candidates else "no_candidates", "candidates": candidates}


async def run(args: argparse.Namespace) -> dict[str, object]:
    _validate_limit(args.limit)
    if args.stage == "plan":
        if args.inventory is not None and args.live_inventory:
            raise ValueError("--inventory and --live-inventory cannot be used together.")

        if args.live_inventory:
            counts = await load_inventory_counts(HttpxCatalogInventoryTransport())
            return _write(_coverage_document(counts, limit=args.limit), args.output)

        return _write(_plan_document(args.inventory, limit=args.limit), args.output)

    if args.stage == "discover":
        source = _approved_source(args)
        discovery = await _discover_source(source, fetcher=HttpFetcher(), limit=args.limit)
        document = {
            "stage": "discover",
            "summary": {"vendor": source.vendor, "market": source.market_code, "furniture_type": source.furniture_type_code, "category": source.source_category, "requested_limit": args.limit, "unique_candidates_found": len(discovery["candidates"]), "status": discovery["status"]},
            "candidates": discovery["candidates"],
        }
        return _write(document, args.output)

    if args.stage == "expand":
        if args.execute:
            raise ValueError("expand is discovery-only; --execute is not supported.")
        if args.market != "US":
            raise ValueError("Expansion currently uses the US coverage plan only.")
        if args.inventory is not None and args.live_inventory:
            raise ValueError("--inventory and --live-inventory cannot be used together.")
        target_limit = getattr(args, "target_limit", 1)
        if target_limit < 1 or target_limit > MAX_LIMIT:
            raise ValueError(f"--target-limit must be between 1 and {MAX_LIMIT}.")
        counts = await load_inventory_counts(HttpxCatalogInventoryTransport()) if args.live_inventory else {}
        if args.inventory is not None:
            raw = json.loads(args.inventory.read_text())
            if isinstance(raw, dict):
                counts = {
                    tuple(key.split(":", 1)): value
                    for key, value in raw.items()
                    if isinstance(key, str) and ":" in key and isinstance(value, int)
                }
        report = build_coverage_report(US_INITIAL_COVERAGE_PLAN, counts)
        results: list[dict[str, object]] = []
        approved_count = 0
        fetcher = HttpFetcher()
        for target in select_expansion_targets(report):
            sources = approved_sources_for_target(target.market_code, target.furniture_type_code)
            if not sources:
                results.append({"coverage": target.__dict__, "status": "no_approved_source", "candidates": []})
                continue
            if approved_count >= target_limit:
                break
            approved_count += 1
            discovery = await _discover_source(sources[0], fetcher=fetcher, limit=min(args.limit, target.deficit_count))
            results.append({"coverage": target.__dict__, **discovery})
        return _write({
            "stage": "expand",
            "dry_run": True,
            "coverage": _coverage_document(counts, limit=args.limit)["coverage"],
            "summary": {"targets_attempted": approved_count, "candidates_discovered": sum(len(result["candidates"]) for result in results)},
            "targets": results,
        }, args.output)

    if args.stage in {"intake", "persist"}:
        if args.input is None:
            raise ValueError(f"{args.stage} requires --input.")
        candidates = _approved_candidates(_load_candidates(args.input), vendor=args.vendor, market=args.market)
        if args.vendor == "ikea" and args.market != "US":
            raise ValueError("IKEA intake is currently limited to the configured US adapter market.")
        adapter = ArticleVendorAdapter(args.market) if args.vendor == "article" else IkeaVendorAdapter(args.market)
        intake = await intake_candidates(candidates, adapter=adapter, fetcher=HttpFetcher(), limit=args.limit)
        if args.stage == "intake":
            return _write({"stage": "intake", **intake.as_dict()}, args.output)
        preflight = [
            {"product_natural_key": item.plan.product_natural_key, **build_catalog_dry_run(item.plan).as_dict()}
            for item in intake.ready
            if item.plan is not None
        ]
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
        return _write({"stage": "persist", "intake": intake.as_dict(), "preflight": preflight, "persistence": persistence.as_dict()}, args.output)

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
