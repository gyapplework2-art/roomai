"""Guarded one-variant catalog promotion and customer-price calculation."""

from dataclasses import dataclass, field
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Protocol

import httpx

from crawler.core.config import CrawlerSettings, get_settings
from crawler.core.supabase_repository import RestResponse, _response


class CatalogPromotionTransport(Protocol):
    async def get_variant(self, variant_id: str) -> RestResponse: ...
    async def get_product(self, product_id: str) -> RestResponse: ...
    async def get_vendor_market(self, market_id: str) -> RestResponse: ...
    async def get_furniture_type(self, furniture_type_id: str) -> RestResponse: ...
    async def get_offer(self, variant_id: str) -> RestResponse: ...
    async def get_pricing_rules(self) -> RestResponse: ...
    async def upsert_customer_price(self, values: dict[str, object]) -> RestResponse: ...
    async def publish_product(self, product_id: str) -> RestResponse: ...
    async def publish_variant(self, variant_id: str) -> RestResponse: ...


class CatalogPromotionError(RuntimeError):
    """Stable promotion failure without exposing credentials or raw responses."""


class HttpxCatalogPromotionTransport:
    """Fixed-table PostgREST operations for one controlled promotion."""

    def __init__(self, settings: CrawlerSettings | None = None) -> None:
        self._settings = settings or get_settings()

    def _headers(self) -> dict[str, str]:
        _, key = self._settings.require_supabase_credentials()
        return {
            "apikey": key,
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        }

    async def _get(self, table: str, params: dict[str, str]) -> RestResponse:
        url, _ = self._settings.require_supabase_credentials()
        async with httpx.AsyncClient(base_url=f"{url}/rest/v1", headers=self._headers()) as client:
            response = await client.get(f"/{table}", params=params)
        return _response(response)

    async def _patch(self, table: str, row_id: str, values: dict[str, object]) -> RestResponse:
        url, _ = self._settings.require_supabase_credentials()
        async with httpx.AsyncClient(base_url=f"{url}/rest/v1", headers=self._headers()) as client:
            response = await client.patch(f"/{table}", params={"id": f"eq.{row_id}"}, json=values)
        return _response(response)

    async def get_variant(self, variant_id: str) -> RestResponse:
        return await self._get("catalog_product_variants", {"id": f"eq.{variant_id}", "select": "*"})

    async def get_product(self, product_id: str) -> RestResponse:
        return await self._get("catalog_products", {"id": f"eq.{product_id}", "select": "*"})

    async def get_vendor_market(self, market_id: str) -> RestResponse:
        return await self._get("catalog_vendor_markets", {"id": f"eq.{market_id}", "select": "*"})

    async def get_furniture_type(self, furniture_type_id: str) -> RestResponse:
        return await self._get("catalog_furniture_types", {"id": f"eq.{furniture_type_id}", "select": "*"})

    async def get_offer(self, variant_id: str) -> RestResponse:
        return await self._get("catalog_current_offers", {"variant_id": f"eq.{variant_id}", "select": "*"})

    async def get_pricing_rules(self) -> RestResponse:
        return await self._get("catalog_pricing_rules", {"is_active": "eq.true", "select": "*"})

    async def upsert_customer_price(self, values: dict[str, object]) -> RestResponse:
        url, _ = self._settings.require_supabase_credentials()
        headers = {**self._headers(), "Prefer": "resolution=merge-duplicates,return=representation"}
        async with httpx.AsyncClient(base_url=f"{url}/rest/v1", headers=headers) as client:
            response = await client.post(
                "/catalog_customer_prices",
                params={"on_conflict": "variant_id"},
                json=values,
            )
        return _response(response)

    async def publish_product(self, product_id: str) -> RestResponse:
        return await self._patch("catalog_products", product_id, {"publication_status": "published"})

    async def publish_variant(self, variant_id: str) -> RestResponse:
        return await self._patch("catalog_product_variants", variant_id, {"publication_status": "published"})


@dataclass
class PromotionReport:
    execution_requested: bool
    writes_enabled: bool
    variant_id: str
    write_attempted: bool = False
    write_succeeded: bool = False
    product_id: str | None = None
    source_price_basis: float | None = None
    currency: str | None = None
    selected_pricing_rule_id: str | None = None
    selected_markup_type: str | None = None
    selected_markup_value: float | None = None
    calculated_markup_amount: float | None = None
    roomai_selling_price: float | None = None
    current_product_publication_status: str | None = None
    current_variant_publication_status: str | None = None
    resulting_product_publication_status: str | None = None
    resulting_variant_publication_status: str | None = None
    blocking_reasons: list[str] = field(default_factory=list)
    failed_operations: list[dict[str, str]] = field(default_factory=list)
    warnings: list[str] = field(default_factory=lambda: ["sequential_non_transactional_writes"])

    def as_dict(self) -> dict[str, object]:
        return {
            "execution_requested": self.execution_requested,
            "writes_enabled": self.writes_enabled,
            "write_attempted": self.write_attempted,
            "write_succeeded": self.write_succeeded,
            "variant_id": self.variant_id,
            "product_id": self.product_id,
            "source_price_basis": self.source_price_basis,
            "currency": self.currency,
            "selected_pricing_rule_id": self.selected_pricing_rule_id,
            "selected_markup_type": self.selected_markup_type,
            "selected_markup_value": self.selected_markup_value,
            "calculated_markup_amount": self.calculated_markup_amount,
            "roomai_selling_price": self.roomai_selling_price,
            "current_product_publication_status": self.current_product_publication_status,
            "current_variant_publication_status": self.current_variant_publication_status,
            "resulting_product_publication_status": self.resulting_product_publication_status,
            "resulting_variant_publication_status": self.resulting_variant_publication_status,
            "blocking_reasons": self.blocking_reasons,
            "failed_operations": self.failed_operations,
            "warnings": self.warnings,
        }


def _failure(table: str, response: RestResponse, fallback: str) -> dict[str, str]:
    result = {"table": table, "reason": response.message or fallback}
    if response.error_code:
        result["code"] = response.error_code
    if response.details:
        result["details"] = response.details
    if response.hint:
        result["hint"] = response.hint
    return result


def _row(response: RestResponse, table: str, report: PromotionReport) -> dict[str, object] | None:
    if response.status_code >= 300:
        report.failed_operations.append(_failure(table, response, f"{table}_read_failed"))
        return None
    return response.data[0] if response.data else None


def _decimal(value: object) -> Decimal | None:
    if value is None:
        return None
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError):
        return None


def _money(value: Decimal) -> Decimal:
    return value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _effective_rule(rule: dict[str, object], now: datetime) -> bool:
    if rule.get("is_active") is not True:
        return False
    try:
        start = datetime.fromisoformat(str(rule["effective_from"]).replace("Z", "+00:00"))
    except (KeyError, ValueError):
        return False
    end_value = rule.get("effective_to")
    if end_value is None:
        end = None
    else:
        try:
            end = datetime.fromisoformat(str(end_value).replace("Z", "+00:00"))
        except ValueError:
            return False
    return start <= now and (end is None or now < end)


def _select_rule(
    rules: list[dict[str, object]],
    target: dict[str, str],
    now: datetime,
    report: PromotionReport,
) -> dict[str, object] | None:
    applicable = []
    scope_fields = ("country_id", "vendor_market_id", "category_id", "furniture_type_id", "product_id", "variant_id")
    for rule in rules:
        if not _effective_rule(rule, now):
            continue
        if all(rule.get(field) is None or rule.get(field) == target[field] for field in scope_fields):
            specificity = sum(rule.get(field) is not None for field in scope_fields)
            priority = _decimal(rule.get("priority"))
            if priority is None:
                continue
            applicable.append((specificity, priority, rule))
    if not applicable:
        report.blocking_reasons.append("no_applicable_pricing_rule")
        return None
    best_specificity = max(item[0] for item in applicable)
    best_priority = min(item[1] for item in applicable if item[0] == best_specificity)
    best = [item[2] for item in applicable if item[0] == best_specificity and item[1] == best_priority]
    if len(best) != 1:
        report.blocking_reasons.append("ambiguous_pricing_rule")
        return None
    return best[0]


async def promote_catalog_variant(
    variant_id: str,
    *,
    execution_requested: bool,
    transport: CatalogPromotionTransport,
    settings: CrawlerSettings | None = None,
    now: datetime | None = None,
) -> PromotionReport:
    settings = settings or get_settings()
    report = PromotionReport(execution_requested, settings.catalog_allow_writes, variant_id)
    variant = _row(await transport.get_variant(variant_id), "catalog_product_variants", report)
    if variant is None:
        report.blocking_reasons.append("variant_not_found")
        return report
    product_id = variant.get("product_id")
    if not isinstance(product_id, str):
        report.blocking_reasons.append("variant_product_id_missing")
        return report
    report.product_id = product_id
    product = _row(await transport.get_product(product_id), "catalog_products", report)
    if product is None:
        report.blocking_reasons.append("product_not_found")
        return report
    report.current_product_publication_status = str(product.get("publication_status"))
    report.current_variant_publication_status = str(variant.get("publication_status"))
    if product.get("is_active") is not True or variant.get("is_active") is not True:
        report.blocking_reasons.append("inactive_product_or_variant")
    if product.get("publication_status") not in {"staging", "published"} or variant.get("publication_status") not in {"staging", "published"}:
        report.blocking_reasons.append("invalid_publication_status")
    furniture_type_id = product.get("furniture_type_id")
    market_id = product.get("vendor_market_id")
    if not isinstance(furniture_type_id, str):
        report.blocking_reasons.append("unresolved_furniture_type")
    if not isinstance(market_id, str):
        report.blocking_reasons.append("vendor_market_missing")
    market = _row(await transport.get_vendor_market(market_id), "catalog_vendor_markets", report) if isinstance(market_id, str) else None
    furniture_type = _row(await transport.get_furniture_type(furniture_type_id), "catalog_furniture_types", report) if isinstance(furniture_type_id, str) else None
    if furniture_type is None and isinstance(furniture_type_id, str):
        report.blocking_reasons.append("unresolved_furniture_type")
    if product.get("needs_taxonomy_review") is True:
        report.blocking_reasons.append("taxonomy_review_required")
    offer = _row(await transport.get_offer(variant_id), "catalog_current_offers", report)
    offer = offer if offer is not None else None
    if offer is None:
        report.blocking_reasons.append("current_offer_missing")
    currency = offer.get("currency") if offer else None
    source_price = offer.get("vendor_sale_price") if offer and offer.get("vendor_sale_price") is not None else offer.get("vendor_list_price") if offer else None
    source_decimal = _decimal(source_price)
    if not isinstance(currency, str) or not currency:
        report.blocking_reasons.append("offer_currency_missing")
    if source_decimal is None or source_decimal < 0:
        report.blocking_reasons.append("usable_source_price_missing")
    report.currency = currency if isinstance(currency, str) else None
    report.source_price_basis = float(source_decimal) if source_decimal is not None else None
    rules_response = await transport.get_pricing_rules()
    if rules_response.status_code >= 300:
        report.failed_operations.append(_failure("catalog_pricing_rules", rules_response, "pricing_rules_read_failed"))
        return report
    target = {
        "country_id": str(market.get("country_id")) if market else "",
        "vendor_market_id": str(market_id),
        "category_id": str(furniture_type.get("category_id")) if furniture_type else "",
        "furniture_type_id": str(furniture_type_id) if isinstance(furniture_type_id, str) else "",
        "product_id": product_id,
        "variant_id": variant_id,
    }
    rule = _select_rule(rules_response.data, target, now or datetime.now(timezone.utc), report)
    if rule is None:
        return report
    markup_value = _decimal(rule.get("markup_value"))
    if markup_value is None or markup_value < 0 or source_decimal is None:
        report.blocking_reasons.append("invalid_pricing_rule_or_price")
        return report
    markup_type = rule.get("markup_type")
    if markup_type == "percentage":
        markup = _money(source_decimal * markup_value / Decimal("100"))
    elif markup_type == "fixed_amount":
        markup = _money(markup_value)
    else:
        report.blocking_reasons.append("unsupported_markup_type")
        return report
    selling_price = _money(source_decimal + markup)
    report.selected_pricing_rule_id = str(rule.get("id")) if rule.get("id") is not None else None
    report.selected_markup_type = str(markup_type)
    report.selected_markup_value = float(markup_value)
    report.calculated_markup_amount = float(markup)
    report.roomai_selling_price = float(selling_price)
    if report.blocking_reasons or report.failed_operations or not execution_requested or not report.writes_enabled:
        return report
    report.write_attempted = True
    customer_price = {
        "variant_id": variant_id,
        "pricing_rule_id": rule.get("id"),
        "currency": currency,
        "source_price_basis": float(_money(source_decimal)),
        "markup_type": markup_type,
        "markup_value": float(markup_value),
        "calculated_markup_amount": float(markup),
        "roomai_selling_price": float(selling_price),
    }
    response = await transport.upsert_customer_price(customer_price)
    if response.status_code >= 300:
        report.failed_operations.append(_failure("catalog_customer_prices", response, "customer_price_write_failed"))
        return report
    response = await transport.publish_product(product_id)
    if response.status_code >= 300:
        report.failed_operations.append(_failure("catalog_products", response, "product_publication_failed"))
        return report
    report.resulting_product_publication_status = "published"
    response = await transport.publish_variant(variant_id)
    if response.status_code >= 300:
        report.failed_operations.append(_failure("catalog_product_variants", response, "variant_publication_failed"))
        return report
    report.resulting_variant_publication_status = "published"
    report.write_succeeded = True
    return report
