"""Read-only catalog inventory aggregation for coverage planning."""

from collections import Counter
from collections.abc import Iterable, Mapping
from typing import Any, Protocol

import httpx

from crawler.core.config import CrawlerSettings, get_settings
from crawler.core.supabase_repository import RestResponse, _response


class CatalogInventoryError(ValueError):
    """Raised when a catalog inventory row lacks required relationships."""


def _mapping(value: Any, field_name: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise CatalogInventoryError(f"missing_or_invalid_relationship:{field_name}")
    return value


def _required_text(value: Any, field_name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise CatalogInventoryError(f"missing_or_invalid_value:{field_name}")
    return value.strip()


def build_inventory_counts(
    rows: Iterable[Mapping[str, Any]],
) -> dict[tuple[str, str], int]:
    """Aggregate active catalog products by country and furniture type.

    Publication status is intentionally ignored. Active staging products count
    toward catalog inventory even though they are not customer-visible yet.
    """

    counts: Counter[tuple[str, str]] = Counter()

    for row in rows:
        if row.get("is_active") is False:
            continue

        vendor_market = _mapping(
            row.get("catalog_vendor_markets"),
            "catalog_vendor_markets",
        )
        country = _mapping(
            vendor_market.get("catalog_countries"),
            "catalog_vendor_markets.catalog_countries",
        )
        furniture_type = _mapping(
            row.get("catalog_furniture_types"),
            "catalog_furniture_types",
        )

        country_code = _required_text(
            country.get("country_code"),
            "country_code",
        ).upper()
        furniture_type_code = _required_text(
            furniture_type.get("code"),
            "furniture_type_code",
        )

        counts[(country_code, furniture_type_code)] += 1

    return dict(counts)


class CatalogInventoryTransport(Protocol):
    """Minimal read-only transport contract for catalog inventory."""

    async def get_inventory_products(self) -> RestResponse: ...


async def load_inventory_counts(
    transport: CatalogInventoryTransport,
) -> dict[tuple[str, str], int]:
    """Read catalog inventory and aggregate it for coverage planning."""

    response = await transport.get_inventory_products()

    if response.status_code >= 300:
        raise CatalogInventoryError(
            f"inventory_read_failed:{response.message or response.status_code}"
        )

    return build_inventory_counts(response.data)


class HttpxCatalogInventoryTransport:
    """Read-only PostgREST transport for coverage inventory."""

    def __init__(self, settings: CrawlerSettings | None = None) -> None:
        self._settings = settings or get_settings()

    def _headers(self) -> dict[str, str]:
        _, key = self._settings.require_supabase_credentials()
        return {
            "apikey": key,
            "Content-Type": "application/json",
        }

    async def get_inventory_products(self) -> RestResponse:
        url, _ = self._settings.require_supabase_credentials()

        params = {
            "is_active": "eq.true",
            "select": (
                "is_active,publication_status,"
                "catalog_vendor_markets("
                "catalog_countries(country_code)"
                "),"
                "catalog_furniture_types!inner(code)"
            ),
        }

        async with httpx.AsyncClient(
            base_url=f"{url}/rest/v1",
            headers=self._headers(),
        ) as client:
            response = await client.get(
                "/catalog_products",
                params=params,
            )

        return _response(response)
