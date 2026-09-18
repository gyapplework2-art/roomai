"""Thin IKEA US source-fact adapter built on generic crawler utilities."""

from datetime import datetime, timezone
from typing import cast

from crawler.core.html_attributes import extract_labeled_attributes
from crawler.core.measurements import parse_measurement_text
from crawler.core.product_media import extract_source_images
from crawler.core.structured_data import StructuredProductFacts, extract_products
from crawler.core.url_semantics import product_slug, slug_tokens
from crawler.models.product import CatalogProduct, CatalogVariant, CurrentOffer, ProductDimensions
from crawler.vendors.base import BaseVendorAdapter

IKEA_VENDOR = "IKEA"
IKEA_US_MARKET = "US"
ProductSourceRecord = CatalogProduct


class IkeaExtractionError(ValueError):
    """Raised when explicit IKEA source facts cannot form a product record."""


def _text(value: object) -> str | None:
    return value.strip() if isinstance(value, str) and value.strip() else None


def _dicts(value: object) -> list[dict[str, object]]:
    if isinstance(value, dict):
        return [cast(dict[str, object], value)]
    if isinstance(value, list):
        return [cast(dict[str, object], item) for item in value if isinstance(item, dict)]
    return []


def _number(value: object) -> float | None:
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value)
        except ValueError:
            return None
    return None


def _offer(value: object, checked_at: datetime) -> CurrentOffer | None:
    offers = _dicts(value)
    if not offers:
        return None
    offer = offers[0]
    currency = _text(offer.get("priceCurrency"))
    if currency is None:
        return None
    return CurrentOffer(
        currency=currency,
        vendor_sale_price=_number(offer.get("price")) or _number(offer.get("lowPrice")),
        vendor_list_price=_number(offer.get("listPrice") or offer.get("highPrice")),
        source_availability=_text(offer.get("availability")),
        delivery_text=_text(offer.get("shippingDestination") or offer.get("shippingDetails") or offer.get("deliveryLeadTime")),
        checked_at=checked_at,
    )


def _dimensions(source: dict[str, object]) -> ProductDimensions | None:
    details: dict[str, object] = {}
    source_values: list[str] = []
    for key in ("width", "depth", "height", "weight"):
        raw = source.get(key)
        if isinstance(raw, str):
            parsed = parse_measurement_text(raw)
            if parsed:
                details[key] = parsed
            source_values.append(f"{key}: {raw}")
    if not details and not source_values:
        return None
    return ProductDimensions(
        source_dimension_text="; ".join(source_values) or None,
        dimension_details=details,
    )


class IkeaVendorAdapter(BaseVendorAdapter):
    """Map explicit IKEA US JSON-LD and labeled HTML facts to CatalogProduct."""

    def __init__(self, vendor_market_code: str = IKEA_US_MARKET) -> None:
        super().__init__(vendor_market_code)

    def discover_product_urls(self) -> tuple[str, ...]:
        """Discovery is intentionally outside this thin extraction adapter."""
        return ()

    def parse_product(
        self,
        source: str,
        product_url: str | None = None,
        fetched_at: datetime | None = None,
    ) -> ProductSourceRecord:
        """Parse explicit source facts only; no name, prose, or URL attribute inference."""
        products = extract_products(source)
        if not products:
            raise IkeaExtractionError("No IKEA Product JSON-LD was found.")
        return self._from_json_ld(products[0], source, product_url, fetched_at or datetime.now(timezone.utc))

    def _from_json_ld(
        self, facts: StructuredProductFacts, html: str, requested_url: str | None, checked_at: datetime,
    ) -> ProductSourceRecord:
        product_url = facts.url or requested_url
        if not facts.name or not product_url:
            raise IkeaExtractionError("IKEA Product JSON-LD must include name and URL.")
        source = facts.source
        labeled_attributes = extract_labeled_attributes(html)
        attributes = {attribute.label: attribute.value for attribute in labeled_attributes}
        variant = CatalogVariant(
            vendor_sku=facts.sku or facts.mpn,
            vendor_variant_id=_text(source.get("productID") or source.get("@id")),
            variant_name=facts.name,
            source_color=facts.color,
            source_material=facts.material,
            variant_attributes={"ikea_labeled_attributes": attributes},
            dimensions=_dimensions(source),
            images=extract_source_images(facts.image),
            current_offer=_offer(source.get("offers"), checked_at),
        )
        return CatalogProduct(
            vendor_market_code=self.vendor_market_code,
            vendor_product_id=facts.sku or facts.mpn,
            source_product_name=facts.name,
            source_category=facts.category,
            source_description=facts.description,
            product_url=product_url,
            source_payload={
                "vendor": IKEA_VENDOR,
                "brand": facts.brand,
                "json_ld": source,
                "url_evidence": {
                    "source_url": product_url,
                    "slug": product_slug(product_url),
                    "tokens": list(slug_tokens(product_url)),
                    "source": "vendor_url_slug",
                    "method": "deterministic",
                },
            },
            variants=[variant],
        )
