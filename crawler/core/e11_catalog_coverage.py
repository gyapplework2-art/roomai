"""Persisted-catalog coverage against the E.11 P0 minimum inventory contract."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import asdict, dataclass
from decimal import Decimal, InvalidOperation
import json
from typing import Literal, Protocol

from crawler.core.catalog_coverage import E11_P0_MINIMUM_VIABLE_COVERAGE_PLAN
from crawler.core.catalog_quality_audit import (
    CatalogQualityAuditTransport,
    HttpxCatalogQualityAuditTransport,
    audit_quality_rows,
)
from crawler.core.supabase_repository import RestResponse

CoverageStatus = Literal["empty", "under_target", "target_met"]


class E11CatalogCoverageError(RuntimeError):
    """Raised when persisted catalog evidence cannot support a reliable report."""


class E11CatalogCoverageTransport(Protocol):
    async def get_quality_rows(self) -> RestResponse: ...


@dataclass(frozen=True)
class E11P0CoverageRow:
    market_code: str
    furniture_type_code: str
    minimum_distinct_products: int
    minimum_ready_variants: int
    actual_distinct_product_count: int
    actual_ready_variant_count: int
    product_target_met: bool
    ready_variant_target_met: bool
    coverage_status: CoverageStatus


@dataclass(frozen=True)
class E11P0CoverageReport:
    rows: tuple[E11P0CoverageRow, ...]

    def as_dict(self) -> dict[str, object]:
        return {"rows": [asdict(row) for row in self.rows]}


def _related_rows(value: object) -> list[dict[str, object]]:
    if isinstance(value, dict):
        return [value]
    if isinstance(value, list):
        return [row for row in value if isinstance(row, dict)]
    return []


def _related_row(value: object) -> dict[str, object] | None:
    rows = _related_rows(value)
    return rows[0] if rows else None


def _price_is_usable(value: object) -> bool:
    if isinstance(value, bool) or value is None:
        return False
    try:
        return Decimal(str(value)).is_finite() and Decimal(str(value)) >= 0
    except (InvalidOperation, ValueError):
        return False


def _customer_price_exists(variant: Mapping[str, object], expected_currency: object) -> bool:
    if not isinstance(expected_currency, str) or not expected_currency.strip():
        return False
    return any(
        isinstance(price.get("currency"), str)
        and price["currency"].strip().upper() == expected_currency.strip().upper()
        and _price_is_usable(price.get("roomai_selling_price"))
        for price in _related_rows(variant.get("catalog_customer_prices"))
    )


def _product_scope(row: Mapping[str, object]) -> tuple[str, str, str] | None:
    market = _related_row(row.get("catalog_vendor_markets"))
    country = _related_row(market.get("catalog_countries")) if market else None
    furniture_type = _related_row(row.get("catalog_furniture_types"))
    product_id = row.get("id")
    country_code = country.get("country_code") if country else None
    type_code = furniture_type.get("code") if furniture_type else None
    if not all(isinstance(value, str) and value.strip() for value in (product_id, country_code, type_code)):
        return None
    return product_id, country_code.upper(), type_code


def _canonical_product_row(row: dict[str, object]) -> dict[str, object]:
    canonical = dict(row)
    variants_by_id: dict[str, dict[str, object]] = {}
    variants_without_id: list[dict[str, object]] = []
    for variant in _related_rows(row.get("catalog_product_variants")):
        variant_id = variant.get("id")
        if not isinstance(variant_id, str) or not variant_id.strip():
            variants_without_id.append(variant)
            continue
        previous = variants_by_id.get(variant_id)
        if previous is not None and previous != variant:
            raise E11CatalogCoverageError("E11_CATALOG_VARIANT_RECORD_CONFLICT")
        variants_by_id[variant_id] = variant
    canonical["catalog_product_variants"] = [
        variants_by_id[key] for key in sorted(variants_by_id)
    ] + sorted(variants_without_id, key=lambda variant: json.dumps(variant, sort_keys=True, default=str))
    return canonical


def _canonical_product_rows(rows: Sequence[dict[str, object]]) -> list[dict[str, object]]:
    products_by_id: dict[str, dict[str, object]] = {}
    product_scopes: dict[str, tuple[str, str]] = {}
    for row in rows:
        if row.get("is_active") is not True:
            continue
        scope = _product_scope(row)
        if scope is None:
            continue
        product_id, country_code, type_code = scope
        previous_scope = product_scopes.get(product_id)
        if previous_scope is not None and previous_scope != (country_code, type_code):
            raise E11CatalogCoverageError("E11_CATALOG_PRODUCT_ID_CONFLICT")
        product_scopes[product_id] = (country_code, type_code)
        canonical_row = _canonical_product_row(row)
        previous = products_by_id.get(product_id)
        if previous is not None and previous != canonical_row:
            raise E11CatalogCoverageError("E11_CATALOG_PRODUCT_RECORD_CONFLICT")
        products_by_id[product_id] = canonical_row
    return [products_by_id[key] for key in sorted(products_by_id)]


def build_e11_p0_coverage_report(rows: Sequence[dict[str, object]]) -> E11P0CoverageReport:
    """Evaluate active product counts and queryable, design-ready variant counts.

    Product counts intentionally include active staging inventory, matching the
    legacy inventory notion. A ready variant additionally passes the existing
    persisted design-quality audit and the customer candidate publication gates.
    """
    products = _canonical_product_rows(rows)
    quality_by_product_id = {
        product.product_id: product
        for product in audit_quality_rows(products).products
        if product.product_id is not None
    }
    targets = E11_P0_MINIMUM_VIABLE_COVERAGE_PLAN.targets
    product_ids_by_type: dict[str, set[str]] = {target.furniture_type_code: set() for target in targets}
    ready_variant_ids_by_type: dict[str, set[str]] = {target.furniture_type_code: set() for target in targets}
    variant_owners: dict[str, tuple[str, str]] = {}

    for row in products:
        scope = _product_scope(row)
        if scope is None:
            continue
        product_id, country_code, type_code = scope
        if country_code != "US" or type_code not in product_ids_by_type:
            continue
        product_ids_by_type[type_code].add(product_id)

        if row.get("publication_status") != "published" or row.get("needs_taxonomy_review") is True:
            continue
        market = _related_row(row.get("catalog_vendor_markets"))
        country = _related_row(market.get("catalog_countries")) if market else None
        if market is None or market.get("is_active") is not True or country is None or country.get("is_supported") is not True:
            continue
        default_currency = country.get("default_currency")

        quality_product = quality_by_product_id.get(product_id)
        quality_by_variant_id = {
            variant.variant_id: variant
            for variant in quality_product.variants
            if variant.variant_id is not None
        } if quality_product else {}
        for variant in _related_rows(row.get("catalog_product_variants")):
            variant_id = variant.get("id")
            if not isinstance(variant_id, str) or not variant_id.strip():
                continue
            owner = (product_id, type_code)
            previous_owner = variant_owners.get(variant_id)
            if previous_owner is not None and previous_owner != owner:
                raise E11CatalogCoverageError("E11_CATALOG_VARIANT_ID_CONFLICT")
            variant_owners[variant_id] = owner
            if variant.get("is_active") is not True or variant.get("publication_status") != "published":
                continue
            offer = _related_row(variant.get("catalog_current_offers"))
            if offer is None or offer.get("normalized_availability") != "in_stock":
                continue
            if not _customer_price_exists(variant, default_currency):
                continue
            quality = quality_by_variant_id.get(variant_id)
            if quality is None or not quality.design_ready:
                continue
            ready_variant_ids_by_type[type_code].add(variant_id)

    report_rows: list[E11P0CoverageRow] = []
    for target in targets:
        if target.minimum_ready_variants is None:
            raise E11CatalogCoverageError("E11_P0_READY_VARIANT_TARGET_MISSING")
        actual_products = len(product_ids_by_type[target.furniture_type_code])
        actual_ready_variants = len(ready_variant_ids_by_type[target.furniture_type_code])
        product_met = actual_products >= target.minimum_distinct_products
        variants_met = actual_ready_variants >= target.minimum_ready_variants
        status: CoverageStatus = "empty" if actual_products == 0 else "target_met" if product_met and variants_met else "under_target"
        report_rows.append(E11P0CoverageRow(
            market_code=target.market_code,
            furniture_type_code=target.furniture_type_code,
            minimum_distinct_products=target.minimum_distinct_products,
            minimum_ready_variants=target.minimum_ready_variants,
            actual_distinct_product_count=actual_products,
            actual_ready_variant_count=actual_ready_variants,
            product_target_met=product_met,
            ready_variant_target_met=variants_met,
            coverage_status=status,
        ))
    return E11P0CoverageReport(tuple(report_rows))


async def load_e11_p0_coverage_report(
    transport: E11CatalogCoverageTransport | None = None,
) -> E11P0CoverageReport:
    """Read persisted catalog rows and evaluate E.11 P0 coverage without writes."""
    transport = transport or HttpxCatalogQualityAuditTransport()
    response = await transport.get_quality_rows()
    if response.status_code >= 300:
        raise E11CatalogCoverageError(f"e11_catalog_coverage_read_failed:{response.message or response.status_code}")
    return build_e11_p0_coverage_report(response.data)