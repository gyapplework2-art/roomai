"""Read-only quality audit for persisted RoomAI catalog records."""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation
from typing import Protocol

import httpx

from crawler.core.attribute_normalizer import has_normalized_material_composition
from crawler.core.config import CrawlerSettings, get_settings
from crawler.core.supabase_repository import RestResponse, _response


class CatalogQualityAuditError(RuntimeError):
    """Raised when persisted catalog quality cannot be audited safely."""


class CatalogQualityAuditTransport(Protocol):
    async def get_quality_rows(self) -> RestResponse:
        """Read active products and their active persisted catalog relationships."""


class HttpxCatalogQualityAuditTransport:
    """Read-only PostgREST transport for catalog quality auditing."""

    def __init__(self, settings: CrawlerSettings | None = None) -> None:
        self._settings = settings or get_settings()

    def _headers(self) -> dict[str, str]:
        _, key = self._settings.require_supabase_credentials()
        return {
            "apikey": key,
            "Content-Type": "application/json",
        }

    async def get_quality_rows(self) -> RestResponse:
        url, _ = self._settings.require_supabase_credentials()

        select = ",".join(
            [
                "id",
                "source_product_name",
                "publication_status",
                "is_active",
                "needs_taxonomy_review",
                "catalog_furniture_types(code)",
                (
                    "catalog_vendor_markets!inner(is_active,"
                    "catalog_countries!inner(country_code,default_currency,is_supported))"
                ),
                (
                    "catalog_product_variants("
                    "id,vendor_sku,vendor_variant_id,variant_name,"
                    "source_color,normalized_color,"
                    "source_material,normalized_material,variant_attributes,"
                    "publication_status,is_active,"
                    "catalog_product_dimensions(width_cm,depth_cm,height_cm),"
                    "catalog_current_offers("
                    "currency,vendor_list_price,vendor_sale_price,"
                    "normalized_availability,checked_at"
                    "),"
                    "catalog_customer_prices(currency,roomai_selling_price),"
                    "catalog_product_images(id,source_url)"
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
                    "select": select,
                    "order": "source_product_name.asc",
                },
            )

        return _response(response)


@dataclass(frozen=True)
class PersistedVariantQuality:
    variant_id: str | None
    blocking_reasons: tuple[str, ...]
    incomplete_reasons: tuple[str, ...]
    design_gaps: tuple[str, ...]

    @property
    def passes_blocking_gate(self) -> bool:
        return not self.blocking_reasons

    @property
    def commercially_complete(self) -> bool:
        return self.passes_blocking_gate and not self.incomplete_reasons

    @property
    def design_ready(self) -> bool:
        return self.commercially_complete and not self.design_gaps

    def as_dict(self) -> dict[str, object]:
        return {
            "variant_id": self.variant_id,
            "passes_blocking_gate": self.passes_blocking_gate,
            "commercially_complete": self.commercially_complete,
            "design_ready": self.design_ready,
            "blocking_reasons": list(self.blocking_reasons),
            "incomplete_reasons": list(self.incomplete_reasons),
            "design_gaps": list(self.design_gaps),
        }


@dataclass(frozen=True)
class PersistedProductQuality:
    product_id: str | None
    product_name: str
    furniture_type_code: str | None
    publication_status: str | None
    blocking_reasons: tuple[str, ...]
    incomplete_reasons: tuple[str, ...]
    design_gaps: tuple[str, ...]
    variants: tuple[PersistedVariantQuality, ...]

    @property
    def passes_blocking_gate(self) -> bool:
        return (
            not self.blocking_reasons
            and bool(self.variants)
            and all(variant.passes_blocking_gate for variant in self.variants)
        )

    @property
    def commercially_complete(self) -> bool:
        return (
            self.passes_blocking_gate
            and not self.incomplete_reasons
            and all(variant.commercially_complete for variant in self.variants)
        )

    @property
    def design_ready(self) -> bool:
        return (
            self.commercially_complete
            and not self.design_gaps
            and all(variant.design_ready for variant in self.variants)
        )

    def as_dict(self) -> dict[str, object]:
        return {
            "product_id": self.product_id,
            "product_name": self.product_name,
            "furniture_type_code": self.furniture_type_code,
            "publication_status": self.publication_status,
            "passes_blocking_gate": self.passes_blocking_gate,
            "commercially_complete": self.commercially_complete,
            "design_ready": self.design_ready,
            "blocking_reasons": list(self.blocking_reasons),
            "incomplete_reasons": list(self.incomplete_reasons),
            "design_gaps": list(self.design_gaps),
            "variants": [variant.as_dict() for variant in self.variants],
        }


@dataclass
class CatalogQualityAuditReport:
    products: list[PersistedProductQuality] = field(default_factory=list)

    @property
    def variants_total(self) -> int:
        return sum(len(product.variants) for product in self.products)

    @property
    def products_blocking_pass(self) -> int:
        return sum(product.passes_blocking_gate for product in self.products)

    @property
    def products_commercially_complete(self) -> int:
        return sum(product.commercially_complete for product in self.products)

    @property
    def products_design_ready(self) -> int:
        return sum(product.design_ready for product in self.products)

    def _reason_counts(self, attribute: str) -> dict[str, int]:
        counts: Counter[str] = Counter()

        for product in self.products:
            counts.update(getattr(product, attribute))
            for variant in product.variants:
                counts.update(getattr(variant, attribute))

        return dict(sorted(counts.items()))

    def as_dict(self) -> dict[str, object]:
        return {
            "summary": {
                "products_total": len(self.products),
                "variants_total": self.variants_total,
                "products_blocking_pass": self.products_blocking_pass,
                "products_commercially_complete": self.products_commercially_complete,
                "products_design_ready": self.products_design_ready,
            },
            "quality_gap_counts": {
                "blocking": self._reason_counts("blocking_reasons"),
                "incomplete": self._reason_counts("incomplete_reasons"),
                "design": self._reason_counts("design_gaps"),
            },
            "products": [product.as_dict() for product in self.products],
        }


def _related_rows(value: object) -> list[dict[str, object]]:
    if isinstance(value, list):
        return [row for row in value if isinstance(row, dict)]
    if isinstance(value, dict):
        return [value]
    return []


def _related_row(value: object) -> dict[str, object] | None:
    rows = _related_rows(value)
    return rows[0] if rows else None


def _non_blank(value: object) -> bool:
    return isinstance(value, str) and bool(value.strip())


def _usable_price(offer: dict[str, object] | None) -> bool:
    if offer is None:
        return False

    raw = (
        offer.get("vendor_sale_price")
        if offer.get("vendor_sale_price") is not None
        else offer.get("vendor_list_price")
    )

    if raw is None:
        return False

    try:
        return Decimal(str(raw)) >= 0
    except (InvalidOperation, ValueError):
        return False


def _complete_dimensions(dimensions: dict[str, object] | None) -> bool:
    if dimensions is None:
        return False

    for key in ("width_cm", "depth_cm", "height_cm"):
        value = dimensions.get(key)
        if value is None:
            return False
        try:
            if Decimal(str(value)) <= 0:
                return False
        except (InvalidOperation, ValueError):
            return False

    return True


def _audit_variant(row: dict[str, object]) -> PersistedVariantQuality:
    blocking: list[str] = []
    incomplete: list[str] = []
    design: list[str] = []

    variant_id = row.get("id")
    variant_id = variant_id if isinstance(variant_id, str) else None

    if row.get("is_active") is not True:
        blocking.append("inactive_variant")

    if row.get("publication_status") not in {"staging", "published"}:
        blocking.append("invalid_variant_publication_status")

    if not any(
        _non_blank(row.get(field))
        for field in ("vendor_sku", "vendor_variant_id", "variant_name")
    ):
        blocking.append("variant_identity_missing")

    offer = _related_row(row.get("catalog_current_offers"))
    if offer is None:
        incomplete.append("current_offer_missing")
    else:
        if not _non_blank(offer.get("currency")):
            incomplete.append("offer_currency_missing")
        if not _usable_price(offer):
            incomplete.append("usable_source_price_missing")

    images = _related_rows(row.get("catalog_product_images"))
    if not any(_non_blank(image.get("source_url")) for image in images):
        incomplete.append("product_image_missing")

    dimensions = _related_row(row.get("catalog_product_dimensions"))
    if not _complete_dimensions(dimensions):
        design.append("complete_dimensions_missing")

    if _non_blank(row.get("source_color")) and not _non_blank(
        row.get("normalized_color")
    ):
        design.append("normalized_color_missing")

    source_material = row.get("source_material")
    if _non_blank(source_material) and not _non_blank(row.get("normalized_material")) and not has_normalized_material_composition(
        source_material if isinstance(source_material, str) else None, row.get("variant_attributes"),
    ):
        design.append("normalized_material_missing")

    return PersistedVariantQuality(
        variant_id=variant_id,
        blocking_reasons=tuple(dict.fromkeys(blocking)),
        incomplete_reasons=tuple(dict.fromkeys(incomplete)),
        design_gaps=tuple(dict.fromkeys(design)),
    )


def audit_quality_rows(
    rows: list[dict[str, object]],
) -> CatalogQualityAuditReport:
    products: list[PersistedProductQuality] = []

    for row in rows:
        blocking: list[str] = []
        incomplete: list[str] = []
        design: list[str] = []

        product_id = row.get("id")
        product_id = product_id if isinstance(product_id, str) else None

        if row.get("is_active") is not True:
            blocking.append("inactive_product")

        publication_status = row.get("publication_status")
        if publication_status not in {"staging", "published"}:
            blocking.append("invalid_product_publication_status")

        furniture_type = _related_row(row.get("catalog_furniture_types"))
        furniture_type_code = (
            furniture_type.get("code") if furniture_type is not None else None
        )

        if not _non_blank(furniture_type_code):
            blocking.append("unresolved_furniture_type")

        if row.get("needs_taxonomy_review") is True:
            blocking.append("taxonomy_review_required")

        variant_rows = [
            variant
            for variant in _related_rows(row.get("catalog_product_variants"))
            if variant.get("is_active") is True
        ]

        if not variant_rows:
            blocking.append("active_variant_missing")

        variants = tuple(_audit_variant(variant) for variant in variant_rows)

        product_name = row.get("source_product_name")
        product_name = (
            product_name.strip()
            if isinstance(product_name, str) and product_name.strip()
            else "<unnamed>"
        )

        products.append(
            PersistedProductQuality(
                product_id=product_id,
                product_name=product_name,
                furniture_type_code=(
                    furniture_type_code
                    if isinstance(furniture_type_code, str)
                    else None
                ),
                publication_status=(
                    publication_status
                    if isinstance(publication_status, str)
                    else None
                ),
                blocking_reasons=tuple(dict.fromkeys(blocking)),
                incomplete_reasons=tuple(dict.fromkeys(incomplete)),
                design_gaps=tuple(dict.fromkeys(design)),
                variants=variants,
            )
        )

    return CatalogQualityAuditReport(products=products)


async def load_catalog_quality_audit(
    transport: CatalogQualityAuditTransport | None = None,
) -> CatalogQualityAuditReport:
    transport = transport or HttpxCatalogQualityAuditTransport()
    response = await transport.get_quality_rows()

    if response.status_code >= 300:
        raise CatalogQualityAuditError(
            f"catalog_quality_read_failed: {response.message or response.status_code}"
        )

    return audit_quality_rows(response.data)
