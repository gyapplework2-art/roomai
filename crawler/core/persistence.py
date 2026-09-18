"""Pure mapping from normalized crawler facts to catalog write intent."""

from dataclasses import dataclass
from urllib.parse import urlparse

from crawler.core.normalizer import normalize_product
from crawler.models.product import CatalogProduct


@dataclass(frozen=True)
class VendorPlan:
    slug: str
    name: str
    website_url: str


@dataclass(frozen=True)
class VendorMarketPlan:
    vendor_slug: str
    country_code: str
    market_code: str
    base_url: str
    currency_code: str
    default_locale: str


@dataclass(frozen=True)
class VariantPlan:
    natural_key: str
    values: dict[str, object]
    dimensions: dict[str, object] | None
    offer: dict[str, object] | None
    images: tuple[dict[str, object], ...]


@dataclass(frozen=True)
class CatalogPersistencePlan:
    vendor: VendorPlan
    vendor_market: VendorMarketPlan
    product_natural_key: str
    canonical_furniture_type_code: str | None
    product: dict[str, object]
    variants: tuple[VariantPlan, ...]
    review_reasons: tuple[str, ...]


def _slug(value: str) -> str:
    return "-".join("".join(character.lower() if character.isalnum() else " " for character in value).split())


def _vendor(product: CatalogProduct) -> tuple[str, str]:
    source_vendor = product.source_payload.get("vendor")
    if not isinstance(source_vendor, str) or not source_vendor.strip():
        raise ValueError("Catalog persistence requires an explicit source vendor.")
    name = source_vendor.strip()
    return name, _slug(name)


def _country_code(product: CatalogProduct) -> str:
    code = product.vendor_market_code.strip().upper()
    if len(code) != 2 or not code.isalpha():
        raise ValueError("Catalog persistence requires a two-letter vendor market country code.")
    return code


def _base_url(product: CatalogProduct) -> str:
    parsed = urlparse(product.product_url)
    if not parsed.scheme or not parsed.netloc:
        raise ValueError("Catalog persistence requires an HTTP(S) product URL.")
    return f"{parsed.scheme}://{parsed.netloc}"


def _variant_key(index: int, variant_id: str | None, sku: str | None, name: str | None) -> str:
    if sku:
        return f"sku:{sku}"
    if variant_id:
        return f"vendor_variant_id:{variant_id}"
    if name:
        return f"name:{name}"
    return f"source_index:{index}"


def build_persistence_plan(product: CatalogProduct) -> CatalogPersistencePlan:
    """Build deterministic staging/upsert intent; this function performs no I/O."""
    normalized = normalize_product(product)
    source_product = normalized.product
    vendor_name, vendor_slug = _vendor(source_product)
    country_code = _country_code(source_product)
    base_url = _base_url(source_product)
    currency = next((variant.current_offer.currency for variant in source_product.variants if variant.current_offer), "USD")
    review_reasons = list(normalized.review_reasons)
    if source_product.needs_taxonomy_review or not source_product.canonical_furniture_type_code:
        review_reasons.append("taxonomy_review")
    product_key = f"vendor_product_id:{source_product.vendor_product_id}" if source_product.vendor_product_id else f"url:{source_product.product_url}"
    variants: list[VariantPlan] = []
    for index, variant in enumerate(source_product.variants):
        dimensions = None
        if variant.dimensions:
            dimensions = variant.dimensions.model_dump(mode="json")
        offer = variant.current_offer.model_dump(mode="json") if variant.current_offer else None
        if offer is not None and offer["normalized_availability"] is None:
            offer["normalized_availability"] = "unknown"
        images = tuple(
            image.model_dump(mode="json") | {"image_role": image.image_role or "alternate"}
            for image in variant.images
        )
        variants.append(VariantPlan(
            natural_key=_variant_key(index, variant.vendor_variant_id, variant.vendor_sku, variant.variant_name),
            values={
                "vendor_sku": variant.vendor_sku,
                "vendor_variant_id": variant.vendor_variant_id,
                "persistence_key": _variant_key(index, variant.vendor_variant_id, variant.vendor_sku, variant.variant_name),
                "variant_name": variant.variant_name,
                "source_color": variant.source_color,
                "normalized_color": variant.normalized_color,
                "source_material": variant.source_material,
                "normalized_material": variant.normalized_material,
                "source_style": variant.source_style,
                "normalized_style": variant.normalized_style,
                "configuration": variant.configuration,
                "seating_capacity": variant.seating_capacity,
                "source_dimension_text": variant.dimensions.source_dimension_text if variant.dimensions else None,
                "variant_attributes": variant.variant_attributes,
                "publication_status": "staging",
            },
            dimensions=dimensions,
            offer=offer,
            images=images,
        ))
    return CatalogPersistencePlan(
        vendor=VendorPlan(vendor_slug, vendor_name, base_url),
        vendor_market=VendorMarketPlan(
            vendor_slug,
            country_code,
            f"{vendor_slug}-{country_code.lower()}",
            base_url,
            currency,
            "en-US" if country_code == "US" else "",
        ),
        product_natural_key=product_key,
        canonical_furniture_type_code=source_product.canonical_furniture_type_code,
        product={
            "vendor_product_id": source_product.vendor_product_id,
            "persistence_key": product_key,
            "source_product_name": source_product.source_product_name,
            "source_category": source_product.source_category,
            "source_subcategory": source_product.source_subcategory,
            "source_product_type": source_product.source_product_type,
            "source_description": source_product.source_description,
            "source_features": source_product.source_features,
            "product_url": source_product.product_url,
            "normalized_style": None,
            "source_payload": source_product.source_payload,
            "source_hash": source_product.source_hash,
            "needs_taxonomy_review": source_product.needs_taxonomy_review,
            "publication_status": "staging",
        },
        variants=tuple(variants),
        review_reasons=tuple(dict.fromkeys(review_reasons)),
    )
