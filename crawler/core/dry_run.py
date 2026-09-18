"""Database-ready, no-I/O catalog persistence preflight operations."""

from dataclasses import asdict, dataclass
from typing import Literal

from crawler.core.persistence import CatalogPersistencePlan


@dataclass(frozen=True)
class DryRunOperation:
    target_table: str
    operation: Literal["resolve", "upsert"]
    natural_key: dict[str, str]
    values: dict[str, object]
    dependencies: tuple[str, ...]
    review_reasons: tuple[str, ...] = ()


@dataclass(frozen=True)
class CatalogDryRun:
    write_allowed: bool
    blocking_reasons: tuple[str, ...]
    review_reasons: tuple[str, ...]
    operations: tuple[DryRunOperation, ...]

    def as_dict(self) -> dict[str, object]:
        return {
            "write_allowed": self.write_allowed,
            "blocking_reasons": list(self.blocking_reasons),
            "review_reasons": list(self.review_reasons),
            "operations": [asdict(operation) for operation in self.operations],
        }


def _country_defaults(country_code: str) -> dict[str, str] | None:
    """Known market configuration required by catalog_vendor_markets writes."""
    if country_code == "US":
        return {"default_locale": "en-US"}
    return None


def build_catalog_dry_run(plan: CatalogPersistencePlan) -> CatalogDryRun:
    """Render ordered deployed-table operations without resolving or creating UUIDs."""
    blocking_reasons: list[str] = []
    country_defaults = _country_defaults(plan.vendor_market.country_code)
    if not plan.vendor.slug or not plan.vendor.name:
        blocking_reasons.append("missing_vendor_identity")
    if not plan.vendor_market.market_code or not plan.vendor_market.country_code:
        blocking_reasons.append("missing_vendor_market")
    if country_defaults is None:
        blocking_reasons.append("missing_country_configuration")
    if not plan.product_natural_key or not plan.product.get("source_product_name"):
        blocking_reasons.append("missing_product_identity")
    if not plan.variants:
        blocking_reasons.append("missing_variant_identity")
    if any(
        not variant.natural_key.startswith(("sku:", "vendor_variant_id:"))
        for variant in plan.variants
    ):
        blocking_reasons.append("missing_variant_identity")

    vendor_reference = f"vendor:{plan.vendor.slug}"
    country_reference = f"country:{plan.vendor_market.country_code}"
    market_reference = f"market:{plan.vendor_market.market_code}"
    product_reference = f"product:{plan.product_natural_key}"

    furniture_type_reference = (
        f"furniture_type:{plan.canonical_furniture_type_code}"
        if plan.canonical_furniture_type_code
        else None
    )

    operations: list[DryRunOperation] = [
        DryRunOperation(
            "catalog_vendors", "upsert", {"slug": plan.vendor.slug},
            {"name": plan.vendor.name, "slug": plan.vendor.slug, "website_url": plan.vendor.website_url}, (),
        ),
        DryRunOperation(
            "catalog_countries", "resolve", {"country_code": plan.vendor_market.country_code}, {}, (),
        ),
        DryRunOperation(
            "catalog_vendor_markets", "upsert", {"market_code": plan.vendor_market.market_code},
            {
                "vendor_id": vendor_reference,
                "country_id": country_reference,
                "market_code": plan.vendor_market.market_code,
                "base_url": plan.vendor_market.base_url,
                "currency_code": plan.vendor_market.currency_code,
                "default_locale": country_defaults["default_locale"] if country_defaults else None,
                "supported_locales": [],
            },
            (vendor_reference, country_reference), plan.review_reasons,
        ),
    ]

    if furniture_type_reference is not None:
        operations.append(DryRunOperation(
            "catalog_furniture_types", "resolve",
            {"code": plan.canonical_furniture_type_code}, {}, (),
        ))

    product_values = {"vendor_market_id": market_reference, **plan.product}
    product_dependencies = [market_reference]

    if furniture_type_reference is not None:
        product_values["furniture_type_id"] = furniture_type_reference
        product_dependencies.append(furniture_type_reference)

    operations.append(DryRunOperation(
        "catalog_products", "upsert",
        {"vendor_market": market_reference, "natural_key": plan.product_natural_key},
        product_values, tuple(product_dependencies), plan.review_reasons,
    ))

    for variant in plan.variants:
        variant_reference = f"variant:{product_reference}:{variant.natural_key}"
        operations.append(DryRunOperation(
            "catalog_product_variants", "upsert", {"product": product_reference, "natural_key": variant.natural_key},
            {"product_id": product_reference, **variant.values}, (product_reference,), plan.review_reasons,
        ))
        if variant.dimensions is not None:
            operations.append(DryRunOperation(
                "catalog_product_dimensions", "upsert", {"variant": variant_reference},
                {"variant_id": variant_reference, **variant.dimensions}, (variant_reference,),
            ))
        if variant.offer is not None:
            operations.append(DryRunOperation(
                "catalog_current_offers", "upsert", {"variant": variant_reference},
                {"variant_id": variant_reference, **variant.offer}, (variant_reference,),
            ))
        for image in variant.images:
            operations.append(DryRunOperation(
                "catalog_product_images", "upsert",
                {"product": product_reference, "variant": variant_reference, "source_url": str(image["source_url"])},
                {"product_id": product_reference, "variant_id": variant_reference, **image},
                (product_reference, variant_reference),
            ))
    return CatalogDryRun(
        write_allowed=not blocking_reasons,
        blocking_reasons=tuple(dict.fromkeys(blocking_reasons)),
        review_reasons=plan.review_reasons,
        operations=tuple(operations),
    )
