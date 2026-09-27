"""Bounded refresh orchestration for existing RoomAI catalog products.

Refresh reuses the normal vendor parser, normalization, persistence planning,
and guarded executor. Dry-run is the default. This module does not schedule
crawl jobs and does not bypass vendor access restrictions.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

import httpx

from crawler.core.config import CrawlerSettings, get_settings
from crawler.core.fetcher import HttpFetcher
from crawler.core.normalizer import normalize_product
from crawler.core.persistence import build_persistence_plan
from crawler.core.supabase_repository import (
    HttpxPostgrestTransport,
    RestResponse,
    SupabaseCatalogExecutor,
    _response,
)
from crawler.vendors.article import ArticleVendorAdapter
from crawler.vendors.ikea import IkeaVendorAdapter


DEFAULT_REFRESH_LIMIT = 10
MAX_REFRESH_LIMIT = 50


class CatalogRefreshError(RuntimeError):
    """Raised when refresh candidate loading cannot safely continue."""


class CatalogRefreshTransport(Protocol):
    async def get_refresh_candidates(
        self,
        *,
        market_code: str,
        limit: int,
    ) -> RestResponse:
        """Read active existing products eligible for bounded refresh."""


class HttpxCatalogRefreshTransport:
    """Read-only PostgREST transport for selecting refresh candidates."""

    def __init__(self, settings: CrawlerSettings | None = None) -> None:
        self._settings = settings or get_settings()

    def _headers(self) -> dict[str, str]:
        _, key = self._settings.require_supabase_credentials()
        return {
            "apikey": key,
            "Content-Type": "application/json",
        }

    async def get_refresh_candidates(
        self,
        *,
        market_code: str,
        limit: int,
    ) -> RestResponse:
        url, _ = self._settings.require_supabase_credentials()

        select = ",".join(
            [
                "id",
                "source_product_name",
                "source_category",
                "product_url",
                "persistence_key",
                "last_seen_at",
                "publication_status",
                "is_active",
                (
                    "catalog_vendor_markets!inner("
                    "market_code,"
                    "catalog_vendors!inner(slug,crawl_enabled)"
                    ")"
                ),
            ]
        )

        async with httpx.AsyncClient(
            base_url=f"{url}/rest/v1",
            headers=self._headers(),
        ) as client:
            response = await client.get(
                "/catalog_products",
                params={
                    "is_active": "eq.true",
                    "catalog_vendor_markets.market_code": f"eq.{market_code}",
                    "catalog_vendor_markets.catalog_vendors.crawl_enabled": "eq.true",
                    "select": select,
                    "order": "last_seen_at.asc,id.asc",
                    "limit": str(limit),
                },
            )

        return _response(response)


@dataclass(frozen=True)
class RefreshCandidate:
    product_id: str
    vendor: str
    market_code: str
    product_name: str
    product_url: str
    persistence_key: str
    source_category: str | None
    last_seen_at: str | None


@dataclass(frozen=True)
class RefreshItemResult:
    product_id: str
    product_name: str
    product_url: str
    vendor: str
    status: str
    reason: str | None
    write_attempted: bool
    write_succeeded: bool
    successful_operations: tuple[str, ...]
    failed_operations: tuple[dict[str, str], ...]
    review_reasons: tuple[str, ...]
    blocking_reasons: tuple[str, ...]

    def as_dict(self) -> dict[str, object]:
        return {
            "product_id": self.product_id,
            "product_name": self.product_name,
            "product_url": self.product_url,
            "vendor": self.vendor,
            "status": self.status,
            "reason": self.reason,
            "write_attempted": self.write_attempted,
            "write_succeeded": self.write_succeeded,
            "successful_operations": list(self.successful_operations),
            "failed_operations": list(self.failed_operations),
            "review_reasons": list(self.review_reasons),
            "blocking_reasons": list(self.blocking_reasons),
        }


@dataclass(frozen=True)
class CatalogRefreshReport:
    market_code: str
    execution_requested: bool
    writes_enabled: bool
    candidates_total: int
    items: tuple[RefreshItemResult, ...]

    def as_dict(self) -> dict[str, object]:
        return {
            "market_code": self.market_code,
            "execution_requested": self.execution_requested,
            "writes_enabled": self.writes_enabled,
            "candidates_total": self.candidates_total,
            "refreshed_count": sum(
                item.status == "refreshed" for item in self.items
            ),
            "dry_run_count": sum(
                item.status == "dry_run" for item in self.items
            ),
            "review_required_count": sum(
                item.status == "review_required" for item in self.items
            ),
            "failed_count": sum(
                item.status == "failed" for item in self.items
            ),
            "items": [item.as_dict() for item in self.items],
        }


def _bounded_limit(limit: int) -> int:
    if limit < 1:
        raise ValueError("Refresh limit must be at least 1.")
    return min(limit, MAX_REFRESH_LIMIT)


def _related_row(value: object) -> dict[str, object] | None:
    if isinstance(value, dict):
        return value
    if isinstance(value, list):
        for item in value:
            if isinstance(item, dict):
                return item
    return None


def build_refresh_candidates(
    rows: list[dict[str, object]],
) -> tuple[RefreshCandidate, ...]:
    candidates: list[RefreshCandidate] = []

    for row in rows:
        if row.get("is_active") is not True:
            continue

        product_id = row.get("id")
        product_url = row.get("product_url")
        product_name = row.get("source_product_name")
        persistence_key = row.get("persistence_key")
        market = _related_row(row.get("catalog_vendor_markets"))

        if (
            not isinstance(product_id, str)
            or not isinstance(product_url, str)
            or not product_url.startswith(("http://", "https://"))
            or not isinstance(product_name, str)
            or not isinstance(persistence_key, str)
            or not persistence_key
            or market is None
        ):
            raise CatalogRefreshError("refresh_candidate_invalid")

        market_code = market.get("market_code")
        vendor = _related_row(market.get("catalog_vendors"))

        if (
            not isinstance(market_code, str)
            or vendor is None
            or vendor.get("crawl_enabled") is not True
            or not isinstance(vendor.get("slug"), str)
        ):
            raise CatalogRefreshError("refresh_candidate_relationship_invalid")

        source_category = row.get("source_category")
        last_seen_at = row.get("last_seen_at")

        candidates.append(
            RefreshCandidate(
                product_id=product_id,
                vendor=vendor["slug"],
                market_code=market_code,
                product_name=product_name,
                product_url=product_url,
                persistence_key=persistence_key,
                source_category=(
                    source_category if isinstance(source_category, str) else None
                ),
                last_seen_at=(
                    last_seen_at if isinstance(last_seen_at, str) else None
                ),
            )
        )

    return tuple(candidates)


async def load_refresh_candidates(
    *,
    market_code: str,
    limit: int = DEFAULT_REFRESH_LIMIT,
    transport: CatalogRefreshTransport | None = None,
) -> tuple[RefreshCandidate, ...]:
    bounded = _bounded_limit(limit)
    transport = transport or HttpxCatalogRefreshTransport()

    response = await transport.get_refresh_candidates(
        market_code=market_code,
        limit=bounded,
    )

    if response.status_code >= 300:
        raise CatalogRefreshError(
            f"refresh_candidate_read_failed: "
            f"{response.message or response.status_code}"
        )

    return build_refresh_candidates(response.data)


def _adapter(vendor: str):
    if vendor == "article":
        return ArticleVendorAdapter()
    if vendor == "ikea":
        return IkeaVendorAdapter()
    raise CatalogRefreshError(f"unsupported_refresh_vendor:{vendor}")


async def refresh_catalog(
    *,
    market_code: str,
    limit: int = DEFAULT_REFRESH_LIMIT,
    execute: bool = False,
    candidate_transport: CatalogRefreshTransport | None = None,
    fetcher: HttpFetcher | None = None,
    persistence_transport=None,
    settings: CrawlerSettings | None = None,
) -> CatalogRefreshReport:
    """Refresh a bounded set of existing products; dry-run unless explicitly executed."""
    settings = settings or get_settings()
    bounded = _bounded_limit(limit)

    candidates = await load_refresh_candidates(
        market_code=market_code,
        limit=bounded,
        transport=candidate_transport,
    )

    fetcher = fetcher or HttpFetcher(settings)

    if persistence_transport is None and execute and settings.catalog_allow_writes:
        persistence_transport = HttpxPostgrestTransport(settings)

    executor = SupabaseCatalogExecutor(
        persistence_transport,
        settings=settings,
        write_enabled=execute,
    )

    items: list[RefreshItemResult] = []

    for candidate in candidates:
        fetch_result = await fetcher.fetch(candidate.product_url)

        if not fetch_result.succeeded or fetch_result.response_text is None:
            reason = (
                fetch_result.error.message
                if fetch_result.error is not None
                else "No HTML returned."
            )
            items.append(
                RefreshItemResult(
                    product_id=candidate.product_id,
                    product_name=candidate.product_name,
                    product_url=candidate.product_url,
                    vendor=candidate.vendor,
                    status="failed",
                    reason=f"fetch_failed:{reason}",
                    write_attempted=False,
                    write_succeeded=False,
                    successful_operations=(),
                    failed_operations=(),
                    review_reasons=(),
                    blocking_reasons=(),
                )
            )
            continue

        try:
            product = _adapter(candidate.vendor).parse_product(
                fetch_result.response_text,
                fetch_result.final_url,
                fetch_result.fetched_at,
            )
        except Exception as error:
            items.append(
                RefreshItemResult(
                    product_id=candidate.product_id,
                    product_name=candidate.product_name,
                    product_url=candidate.product_url,
                    vendor=candidate.vendor,
                    status="failed",
                    reason=f"parse_failed:{type(error).__name__}",
                    write_attempted=False,
                    write_succeeded=False,
                    successful_operations=(),
                    failed_operations=(),
                    review_reasons=(),
                    blocking_reasons=(),
                )
            )
            continue

        if not product.source_category and candidate.source_category:
            product = product.model_copy(
                update={"source_category": candidate.source_category}
            )

        product = normalize_product(product).product
        plan = build_persistence_plan(product)

        if plan.product_natural_key != candidate.persistence_key:
            items.append(
                RefreshItemResult(
                    product_id=candidate.product_id,
                    product_name=candidate.product_name,
                    product_url=candidate.product_url,
                    vendor=candidate.vendor,
                    status="review_required",
                    reason="product_identity_mismatch",
                    write_attempted=False,
                    write_succeeded=False,
                    successful_operations=(),
                    failed_operations=(),
                    review_reasons=("product_identity_mismatch",),
                    blocking_reasons=(),
                )
            )
            continue

        if plan.review_reasons:
            items.append(
                RefreshItemResult(
                    product_id=candidate.product_id,
                    product_name=candidate.product_name,
                    product_url=candidate.product_url,
                    vendor=candidate.vendor,
                    status="review_required",
                    reason=";".join(plan.review_reasons),
                    write_attempted=False,
                    write_succeeded=False,
                    successful_operations=(),
                    failed_operations=(),
                    review_reasons=tuple(plan.review_reasons),
                    blocking_reasons=(),
                )
            )
            continue

        execution = await executor.execute(
            plan,
            execution_requested=execute,
        )

        if execution.failed_operations or execution.blocking_reasons:
            status = "failed"
        elif execution.write_succeeded:
            status = "refreshed"
        else:
            status = "dry_run"

        items.append(
            RefreshItemResult(
                product_id=candidate.product_id,
                product_name=candidate.product_name,
                product_url=candidate.product_url,
                vendor=candidate.vendor,
                status=status,
                reason=None,
                write_attempted=execution.write_attempted,
                write_succeeded=execution.write_succeeded,
                successful_operations=tuple(execution.successful_operations),
                failed_operations=tuple(execution.failed_operations),
                review_reasons=tuple(execution.review_reasons),
                blocking_reasons=tuple(execution.blocking_reasons),
            )
        )

    return CatalogRefreshReport(
        market_code=market_code,
        execution_requested=execute,
        writes_enabled=bool(execute and settings.catalog_allow_writes),
        candidates_total=len(candidates),
        items=tuple(items),
    )
