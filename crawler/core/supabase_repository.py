"""Vendor-neutral, guarded PostgREST executor for catalog persistence plans.

This module has no vendor imports and makes no request until execute is called
with both write gates enabled and a configured transport.
"""

from dataclasses import dataclass, field
from typing import Protocol

import httpx

from crawler.core.config import CrawlerSettings, get_settings
from crawler.core.dry_run import CatalogDryRun, DryRunOperation, build_catalog_dry_run
from crawler.core.persistence import CatalogPersistencePlan


@dataclass(frozen=True)
class RestResponse:
    status_code: int
    data: list[dict[str, object]]
    message: str | None = None
    error_code: str | None = None
    details: str | None = None
    hint: str | None = None


class CatalogRestTransport(Protocol):
    async def resolve_country(self, country_code: str) -> RestResponse:
        """Resolve one existing country by ISO code; never create countries."""

    async def resolve_furniture_type(self, furniture_type_code: str) -> RestResponse:
        """Resolve one existing furniture type by canonical code; never create taxonomy."""

    async def upsert(self, table: str, values: dict[str, object], conflict_target: str) -> RestResponse:
        """Upsert one row and return its database id."""

class HttpxPostgrestTransport:
    """Small server-only PostgREST transport using worker credentials lazily."""

    def __init__(self, settings: CrawlerSettings | None = None) -> None:
        self._settings = settings or get_settings()

    def _headers(self) -> dict[str, str]:
        _, key = self._settings.require_supabase_credentials()
        return {
            "apikey": key,
            "Content-Type": "application/json",
            "Prefer": "resolution=merge-duplicates,return=representation",
        }

    async def resolve_country(self, country_code: str) -> RestResponse:
        url, _ = self._settings.require_supabase_credentials()
        async with httpx.AsyncClient(base_url=f"{url}/rest/v1", headers=self._headers()) as client:
            response = await client.get("/catalog_countries", params={"country_code": f"eq.{country_code}", "select": "id"})
        return _response(response)

    async def resolve_furniture_type(self, furniture_type_code: str) -> RestResponse:
        url, _ = self._settings.require_supabase_credentials()
        async with httpx.AsyncClient(base_url=f"{url}/rest/v1", headers=self._headers()) as client:
            response = await client.get(
                "/catalog_furniture_types",
                params={
                    "code": f"eq.{furniture_type_code}",
                    "is_active": "eq.true",
                    "select": "id",
                },
            )
        return _response(response)

    async def upsert(self, table: str, values: dict[str, object], conflict_target: str) -> RestResponse:
        url, _ = self._settings.require_supabase_credentials()
        async with httpx.AsyncClient(base_url=f"{url}/rest/v1", headers=self._headers()) as client:
            response = await client.post(f"/{table}", params={"on_conflict": conflict_target}, json=values)
        return _response(response)


def _response(response: httpx.Response) -> RestResponse:
    try:
        payload = response.json()
    except ValueError:
        payload = []
    data = payload if isinstance(payload, list) else []
    if response.is_success:
        return RestResponse(response.status_code, data)
    error = payload if isinstance(payload, dict) else {}
    return RestResponse(
        response.status_code,
        data,
        _safe_text(error.get("message")) or f"HTTP {response.status_code}",
        _safe_text(error.get("code")),
        _safe_text(error.get("details")),
        _safe_text(error.get("hint")),
    )


def _safe_text(value: object) -> str | None:
    return value if isinstance(value, str) else None


@dataclass
class ExecutionReport:
    execution_requested: bool
    writes_enabled: bool
    write_attempted: bool = False
    write_succeeded: bool = False
    successful_operations: list[str] = field(default_factory=list)
    failed_operations: list[dict[str, str]] = field(default_factory=list)
    skipped_operations: list[dict[str, str]] = field(default_factory=list)
    resolved_identifiers: dict[str, str] = field(default_factory=dict)
    review_reasons: list[str] = field(default_factory=list)
    blocking_reasons: list[str] = field(default_factory=list)

    def as_dict(self) -> dict[str, object]:
        return {
            "execution_requested": self.execution_requested,
            "writes_enabled": self.writes_enabled,
            "write_attempted": self.write_attempted,
            "write_succeeded": self.write_succeeded,
            "operation_count": len(self.successful_operations) + len(self.failed_operations) + len(self.skipped_operations),
            "successful_operation_count": len(self.successful_operations),
            "failed_operation_count": len(self.failed_operations),
            "skipped_operation_count": len(self.skipped_operations),
            "successful_operations": self.successful_operations,
            "failed_operations": self.failed_operations,
            "skipped_operations": self.skipped_operations,
            "resolved_identifiers": self.resolved_identifiers,
            "review_reasons": self.review_reasons,
            "blocking_reasons": self.blocking_reasons,
        }


_CONFLICT_TARGETS = {
    "catalog_vendors": "slug",
    "catalog_vendor_markets": "market_code",
    "catalog_products": "vendor_market_id,persistence_key",
    "catalog_product_variants": "product_id,persistence_key",
    "catalog_product_dimensions": "variant_id",
    "catalog_current_offers": "variant_id",
    "catalog_product_images": "product_id,variant_id,source_url",
}


class SupabaseCatalogExecutor:
    """Apply a single generic plan sequentially with dual write guards."""

    def __init__(
        self,
        transport: CatalogRestTransport | None = None,
        *,
        settings: CrawlerSettings | None = None,
        write_enabled: bool = False,
    ) -> None:
        self._transport = transport
        self._settings = settings or get_settings()
        self._write_enabled = write_enabled

    async def execute(self, plan: CatalogPersistencePlan, *, execution_requested: bool = False) -> ExecutionReport:
        dry_run = build_catalog_dry_run(plan)
        report = ExecutionReport(
            execution_requested=execution_requested,
            writes_enabled=self._write_enabled and self._settings.catalog_allow_writes,
            review_reasons=list(dry_run.review_reasons),
            blocking_reasons=list(dry_run.blocking_reasons),
        )
        if not plan.product.get("persistence_key"):
            report.blocking_reasons.append("missing_persistence_key:catalog_products")
        if any(not variant.values.get("persistence_key") for variant in plan.variants):
            report.blocking_reasons.append("missing_persistence_key:catalog_product_variants")
        if plan.product.get("publication_status") != "staging" or any(
            variant.values.get("publication_status") != "staging" for variant in plan.variants
        ):
            report.blocking_reasons.append("non_staging_publication_status")
        if not execution_requested or not report.writes_enabled:
            return report
        if self._settings.catalog_max_products_per_execution < 1:
            report.blocking_reasons.append("invalid_product_limit")
            return report
        if report.blocking_reasons:
            return report
        if self._transport is None:
            report.blocking_reasons.append("missing_database_transport")
            return report
        report.write_attempted = True
        await self._apply(dry_run, report)
        report.write_succeeded = not report.failed_operations and not report.skipped_operations
        return report

    async def execute_many(
        self, plans: tuple[CatalogPersistencePlan, ...], *, execution_requested: bool = False,
    ) -> tuple[ExecutionReport, ...]:
        """Guard future batch callers: the initial rollout permits one plan only."""
        if len(plans) > self._settings.catalog_max_products_per_execution:
            return tuple(
                ExecutionReport(
                    execution_requested=execution_requested,
                    writes_enabled=False,
                    blocking_reasons=["product_limit_exceeded"],
                )
                for _ in plans
            )
        return tuple(await self.execute(plan, execution_requested=execution_requested) for plan in plans)

    async def _apply(self, dry_run: CatalogDryRun, report: ExecutionReport) -> None:
        for operation in dry_run.operations:
            if any(dependency not in report.resolved_identifiers for dependency in operation.dependencies):
                report.skipped_operations.append({"table": operation.target_table, "reason": "dependency_not_resolved"})
                continue
            if operation.operation == "resolve":
                if operation.target_table == "catalog_countries":
                    await self._resolve_country(operation, report)
                elif operation.target_table == "catalog_furniture_types":
                    await self._resolve_furniture_type(operation, report)
                else:
                    report.failed_operations.append({
                        "table": operation.target_table,
                        "reason": "unsupported_resolve_operation",
                    })
            else:
                await self._upsert(operation, report)

    async def _resolve_country(self, operation: DryRunOperation, report: ExecutionReport) -> None:
        country_code = operation.natural_key["country_code"]
        if self._transport is None:
            return
        response = await self._transport.resolve_country(country_code)
        reference = f"country:{country_code}"
        resolved_id = response.data[0].get("id") if response.data else None
        if response.status_code < 300 and isinstance(resolved_id, str):
            if reference is not None:
                report.resolved_identifiers[reference] = resolved_id
            report.successful_operations.append(operation.target_table)
        else:
            report.failed_operations.append({"table": operation.target_table, "reason": "country_not_found"})
    async def _resolve_furniture_type(
        self,
        operation: DryRunOperation,
        report: ExecutionReport,
    ) -> None:
        furniture_type_code = operation.natural_key["code"]
        if self._transport is None:
            return

        response = await self._transport.resolve_furniture_type(
            furniture_type_code
        )
        reference = f"furniture_type:{furniture_type_code}"
        resolved_id = response.data[0].get("id") if response.data else None

        if response.status_code < 300 and isinstance(resolved_id, str):
            report.resolved_identifiers[reference] = resolved_id
            report.successful_operations.append(operation.target_table)
        else:
            report.failed_operations.append({
                "table": operation.target_table,
                "reason": "furniture_type_not_found",
            })
    async def _upsert(self, operation: DryRunOperation, report: ExecutionReport) -> None:
        values = {key: report.resolved_identifiers.get(value, value) if isinstance(value, str) else value for key, value in operation.values.items()}
        if operation.target_table in {"catalog_products", "catalog_product_variants"} and not values.get("persistence_key"):
            report.failed_operations.append({"table": operation.target_table, "reason": "missing_persistence_key"})
            return
        if values.get("publication_status") not in {None, "staging"}:
            report.failed_operations.append({"table": operation.target_table, "reason": "non_staging_publication_status"})
            return
        if self._transport is None:
            return
        response = await self._transport.upsert(operation.target_table, values, _CONFLICT_TARGETS[operation.target_table])
        reference = _operation_reference(operation)
        resolved_id = response.data[0].get("id") if response.data else None

        if response.status_code < 300 and isinstance(resolved_id, str):
            if reference is not None:
                report.resolved_identifiers[reference] = resolved_id
            report.successful_operations.append(operation.target_table)
        else:
            error = {"table": operation.target_table, "reason": response.message or "upsert_failed"}
            if response.error_code:
                error["code"] = response.error_code
            if response.details:
                error["details"] = response.details
            if response.hint:
                error["hint"] = response.hint
            report.failed_operations.append(error)


def _operation_reference(operation: DryRunOperation) -> str | None:
    if operation.target_table == "catalog_vendors":
        return f"vendor:{operation.natural_key['slug']}"
    if operation.target_table == "catalog_vendor_markets":
        return f"market:{operation.natural_key['market_code']}"
    if operation.target_table == "catalog_products":
        return f"product:{operation.natural_key['natural_key']}"
    if operation.target_table == "catalog_product_variants":
        return f"variant:{operation.natural_key['product']}:{operation.natural_key['natural_key']}"
    return None
