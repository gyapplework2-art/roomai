"""Deterministic catalog quality evaluation for RoomAI staging records.

This module evaluates normalized crawler products without performing I/O,
changing persistence behavior, or making aesthetic judgments.
"""

from dataclasses import dataclass

from crawler.core.normalizer import normalize_product
from crawler.models.product import CatalogProduct, CatalogVariant


@dataclass(frozen=True)
class VariantQualityResult:
    variant_index: int
    blocking_reasons: tuple[str, ...]
    incomplete_reasons: tuple[str, ...]
    design_gaps: tuple[str, ...]

    @property
    def passes_blocking_gate(self) -> bool:
        return not self.blocking_reasons

    @property
    def design_ready(self) -> bool:
        return (
            not self.blocking_reasons
            and not self.incomplete_reasons
            and not self.design_gaps
        )

    def as_dict(self) -> dict[str, object]:
        return {
            "variant_index": self.variant_index,
            "passes_blocking_gate": self.passes_blocking_gate,
            "design_ready": self.design_ready,
            "blocking_reasons": list(self.blocking_reasons),
            "incomplete_reasons": list(self.incomplete_reasons),
            "design_gaps": list(self.design_gaps),
        }


@dataclass(frozen=True)
class CatalogQualityResult:
    product_name: str
    canonical_furniture_type_code: str | None
    blocking_reasons: tuple[str, ...]
    incomplete_reasons: tuple[str, ...]
    design_gaps: tuple[str, ...]
    variants: tuple[VariantQualityResult, ...]

    @property
    def passes_blocking_gate(self) -> bool:
        return not self.blocking_reasons and all(
            variant.passes_blocking_gate for variant in self.variants
        )

    @property
    def design_ready(self) -> bool:
        return (
            self.passes_blocking_gate
            and not self.incomplete_reasons
            and not self.design_gaps
            and bool(self.variants)
            and all(variant.design_ready for variant in self.variants)
        )

    def as_dict(self) -> dict[str, object]:
        return {
            "product_name": self.product_name,
            "canonical_furniture_type_code": self.canonical_furniture_type_code,
            "passes_blocking_gate": self.passes_blocking_gate,
            "design_ready": self.design_ready,
            "blocking_reasons": list(self.blocking_reasons),
            "incomplete_reasons": list(self.incomplete_reasons),
            "design_gaps": list(self.design_gaps),
            "variants": [variant.as_dict() for variant in self.variants],
        }


def _usable_price(variant: CatalogVariant) -> bool:
    offer = variant.current_offer
    if offer is None:
        return False

    price = (
        offer.vendor_sale_price
        if offer.vendor_sale_price is not None
        else offer.vendor_list_price
    )

    return price is not None and price >= 0


def _complete_dimensions(variant: CatalogVariant) -> bool:
    dimensions = variant.dimensions
    if dimensions is None:
        return False

    return all(
        value is not None and value > 0
        for value in (
            dimensions.width_cm,
            dimensions.depth_cm,
            dimensions.height_cm,
        )
    )


def _evaluate_variant(
    variant: CatalogVariant,
    *,
    variant_index: int,
) -> VariantQualityResult:
    blocking: list[str] = []
    incomplete: list[str] = []
    design_gaps: list[str] = []

    if not (
        variant.vendor_sku
        or variant.vendor_variant_id
        or variant.variant_name
    ):
        blocking.append("variant_identity_missing")

    if variant.current_offer is None:
        incomplete.append("current_offer_missing")
    elif not _usable_price(variant):
        incomplete.append("usable_source_price_missing")

    if not variant.images:
        incomplete.append("product_image_missing")

    if not _complete_dimensions(variant):
        design_gaps.append("complete_dimensions_missing")

    if variant.source_color and not variant.normalized_color:
        design_gaps.append("normalized_color_missing")

    if variant.source_material and not variant.normalized_material:
        design_gaps.append("normalized_material_missing")

    return VariantQualityResult(
        variant_index=variant_index,
        blocking_reasons=tuple(dict.fromkeys(blocking)),
        incomplete_reasons=tuple(dict.fromkeys(incomplete)),
        design_gaps=tuple(dict.fromkeys(design_gaps)),
    )


def evaluate_catalog_quality(product: CatalogProduct) -> CatalogQualityResult:
    """Evaluate normalized catalog quality without I/O or mutation."""
    normalized = normalize_product(product)
    source_product = normalized.product

    blocking: list[str] = []
    incomplete: list[str] = []
    design_gaps: list[str] = list(normalized.review_reasons)

    if (
        source_product.needs_taxonomy_review
        or not source_product.canonical_furniture_type_code
    ):
        blocking.append("taxonomy_unresolved")

    if not source_product.variants:
        blocking.append("variant_missing")

    variants = tuple(
        _evaluate_variant(variant, variant_index=index)
        for index, variant in enumerate(source_product.variants)
    )

    return CatalogQualityResult(
        product_name=source_product.source_product_name,
        canonical_furniture_type_code=source_product.canonical_furniture_type_code,
        blocking_reasons=tuple(dict.fromkeys(blocking)),
        incomplete_reasons=tuple(dict.fromkeys(incomplete)),
        design_gaps=tuple(dict.fromkeys(design_gaps)),
        variants=variants,
    )
