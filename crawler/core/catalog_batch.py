"""Bounded batch intake, persistence, and promotion coordinators."""

from collections.abc import Awaitable, Callable, Iterable
from dataclasses import dataclass
from typing import Protocol

from crawler.core.catalog_promotion import PromotionReport, promote_catalog_variant
from crawler.core.config import CrawlerSettings, get_settings
from crawler.core.fetcher import FetchResult, HttpFetcher
from crawler.core.normalizer import normalize_product
from crawler.core.persistence import CatalogPersistencePlan, build_persistence_plan
from crawler.core.supabase_repository import ExecutionReport, SupabaseCatalogExecutor
from crawler.core.validator import validate_product
from crawler.models.product import CatalogProduct

DEFAULT_BATCH_LIMIT = 10
MAX_BATCH_LIMIT = 50


class CandidateFetcher(Protocol):
    async def fetch(self, url: str) -> FetchResult: ...


class ProductAdapter(Protocol):
    def parse_product(self, source: str, final_url: str, fetched_at) -> CatalogProduct: ...


@dataclass(frozen=True)
class BatchIntakeItem:
    status: str
    product_url: str | None
    stage: str
    reason: str | None = None
    product: CatalogProduct | None = None
    plan: CatalogPersistencePlan | None = None
    review_reasons: tuple[str, ...] = ()

    def as_dict(self) -> dict[str, object]:
        return {
            "status": self.status,
            "product_url": self.product_url,
            "stage": self.stage,
            "reason": self.reason,
            "review_reasons": list(self.review_reasons),
            "product_name": self.product.source_product_name if self.product else None,
            "product_natural_key": self.plan.product_natural_key if self.plan else None,
        }


@dataclass(frozen=True)
class BatchIntakeResult:
    items: tuple[BatchIntakeItem, ...]
    requested_limit: int

    @property
    def ready(self) -> tuple[BatchIntakeItem, ...]:
        return tuple(item for item in self.items if item.status == "ready")

    @property
    def review_required(self) -> tuple[BatchIntakeItem, ...]:
        return tuple(item for item in self.items if item.status == "review_required")

    @property
    def failed(self) -> tuple[BatchIntakeItem, ...]:
        return tuple(item for item in self.items if item.status == "failed")

    def as_dict(self) -> dict[str, object]:
        return {
            "summary": {
                "requested_limit": self.requested_limit,
                "products_attempted": len(self.items),
                "ready": len(self.ready),
                "review_required": len(self.review_required),
                "failed": len(self.failed),
            },
            "products": [item.as_dict() for item in self.items],
        }


async def intake_candidates(
    candidates: Iterable[dict[str, object]],
    *,
    adapter: ProductAdapter,
    fetcher: CandidateFetcher | None = None,
    limit: int = DEFAULT_BATCH_LIMIT,
) -> BatchIntakeResult:
    """Sequentially extract, normalize, validate, and plan a bounded candidate batch."""
    if limit < 1 or limit > MAX_BATCH_LIMIT:
        raise ValueError(f"Batch limit must be between 1 and {MAX_BATCH_LIMIT}.")
    active_fetcher = fetcher or HttpFetcher()
    items: list[BatchIntakeItem] = []

    for candidate in list(candidates)[:limit]:
        product_url = candidate.get("product_url")
        if not isinstance(product_url, str) or not product_url.strip():
            items.append(BatchIntakeItem("failed", None, "input", "missing_product_url"))
            continue
        try:
            fetch_result = await active_fetcher.fetch(product_url)
        except Exception:
            items.append(BatchIntakeItem("failed", product_url, "fetch", "fetch_exception"))
            continue
        if not fetch_result.succeeded or fetch_result.response_text is None:
            items.append(BatchIntakeItem("failed", product_url, "fetch", "fetch_failed"))
            continue
        try:
            product = adapter.parse_product(fetch_result.response_text, fetch_result.final_url, fetch_result.fetched_at)
            source_category = candidate.get("source_category")
            if product.source_category is None and isinstance(source_category, str) and source_category.strip():
                product = product.model_copy(update={"source_category": source_category.strip()})
        except Exception:
            items.append(BatchIntakeItem("failed", product_url, "extraction", "extraction_failed"))
            continue
        try:
            validated_product = validate_product(product)
            normalized = normalize_product(validated_product)
            plan = build_persistence_plan(validated_product)
        except Exception:
            items.append(BatchIntakeItem("failed", product_url, "normalization", "normalization_or_plan_failed"))
            continue
        reasons = tuple(dict.fromkeys((*normalized.review_reasons, *plan.review_reasons)))
        items.append(BatchIntakeItem(
            "review_required" if reasons else "ready",
            product.product_url,
            "validation",
            review_reasons=reasons,
            product=product,
            plan=plan,
        ))
    return BatchIntakeResult(tuple(items), limit)


@dataclass(frozen=True)
class BatchPersistenceItem:
    product_natural_key: str | None
    outcome: str
    report: ExecutionReport


@dataclass(frozen=True)
class BatchPersistenceResult:
    items: tuple[BatchPersistenceItem, ...]
    dry_run: bool

    def as_dict(self) -> dict[str, object]:
        return {
            "dry_run": self.dry_run,
            "summary": {
                "products": len(self.items),
                "persisted": sum(item.outcome == "persisted" for item in self.items),
                "planned": sum(item.outcome == "planned" for item in self.items),
                "skipped": sum(item.outcome == "skipped" for item in self.items),
                "failed": sum(item.outcome == "failed" for item in self.items),
            },
            "products": [
                {"product_natural_key": item.product_natural_key, "outcome": item.outcome, "report": item.report.as_dict()}
                for item in self.items
            ],
        }


async def persist_batch(
    plans: Iterable[CatalogPersistencePlan],
    *,
    executor: SupabaseCatalogExecutor,
    execute: bool = False,
) -> BatchPersistenceResult:
    """Apply plans independently through the existing guarded executor."""
    results: list[BatchPersistenceItem] = []
    seen_natural_keys: set[str] = set()
    for plan in plans:
        if plan.product_natural_key in seen_natural_keys:
            report = ExecutionReport(
                execution_requested=execute,
                writes_enabled=False,
                skipped_operations=[{"table": "catalog_products", "reason": "duplicate_product_natural_key"}],
            )
            results.append(BatchPersistenceItem(plan.product_natural_key, "skipped", report))
            continue
        seen_natural_keys.add(plan.product_natural_key)
        try:
            report = await executor.execute(plan, execution_requested=execute)
        except Exception:
            report = ExecutionReport(
                execution_requested=execute,
                writes_enabled=False,
                failed_operations=[{"table": "catalog_products", "reason": "executor_failed"}],
            )
        if report.failed_operations:
            outcome = "failed"
        elif execute and report.write_succeeded:
            outcome = "persisted"
        elif report.blocking_reasons:
            outcome = "skipped"
        else:
            outcome = "planned"
        results.append(BatchPersistenceItem(plan.product_natural_key, outcome, report))
    return BatchPersistenceResult(tuple(results), dry_run=not execute)


@dataclass(frozen=True)
class BatchPromotionItem:
    variant_id: str
    outcome: str
    report: PromotionReport


@dataclass(frozen=True)
class BatchPromotionResult:
    items: tuple[BatchPromotionItem, ...]

    def as_dict(self) -> dict[str, object]:
        return {
            "summary": {
                "variants": len(self.items),
                "promoted": sum(item.outcome == "promoted" for item in self.items),
                "review_required": sum(item.outcome == "review_required" for item in self.items),
                "failed": sum(item.outcome == "failed" for item in self.items),
            },
            "variants": [
                {"variant_id": item.variant_id, "outcome": item.outcome, "report": item.report.as_dict()}
                for item in self.items
            ],
        }


async def promote_batch(
    variant_ids: Iterable[str],
    *,
    transport,
    settings: CrawlerSettings | None = None,
    execute: bool = False,
    promote: Callable[..., Awaitable[PromotionReport]] = promote_catalog_variant,
) -> BatchPromotionResult:
    """Promote each variant independently using the existing conservative policy."""
    active_settings = settings or get_settings()
    items: list[BatchPromotionItem] = []
    for variant_id in variant_ids:
        try:
            report = await promote(
                variant_id,
                execution_requested=execute,
                transport=transport,
                settings=active_settings,
            )
            outcome = "promoted" if report.write_succeeded else "review_required" if report.blocking_reasons else "failed"
        except Exception:
            report = PromotionReport(execute, active_settings.catalog_allow_writes, variant_id, blocking_reasons=["promotion_failed"])
            outcome = "failed"
        items.append(BatchPromotionItem(variant_id, outcome, report))
    return BatchPromotionResult(tuple(items))
