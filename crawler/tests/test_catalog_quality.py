from datetime import datetime, timezone

from crawler.core.catalog_quality import evaluate_catalog_quality
from crawler.models.product import (
    CatalogProduct,
    CatalogVariant,
    CurrentOffer,
    ProductDimensions,
    ProductImage,
)


NOW = datetime(2026, 9, 27, tzinfo=timezone.utc)


def _product(
    *,
    furniture_type: str | None = "sofa",
    needs_taxonomy_review: bool = False,
    variants: list[CatalogVariant] | None = None,
) -> CatalogProduct:
    return CatalogProduct(
        vendor_market_code="US",
        vendor_product_id="quality-test-product",
        source_product_name="Quality Test Sofa",
        source_category="Sofas",
        product_url="https://example.com/products/quality-test-sofa",
        source_payload={"vendor": "Test Vendor"},
        canonical_furniture_type_code=furniture_type,
        needs_taxonomy_review=needs_taxonomy_review,
        variants=variants if variants is not None else [_complete_variant()],
    )


def _complete_variant() -> CatalogVariant:
    return CatalogVariant(
        vendor_sku="SKU-QUALITY-1",
        variant_name="Ivory Wool",
        source_color="Ivory",
        normalized_color="ivory",
        source_material="Wool",
        normalized_material="wool",
        dimensions=ProductDimensions(
            width_cm=200,
            depth_cm=90,
            height_cm=80,
        ),
        images=[
            ProductImage(
                source_url="https://example.com/images/quality-sofa.jpg",
            )
        ],
        current_offer=CurrentOffer(
            currency="USD",
            vendor_list_price=1000,
            normalized_availability="in_stock",
            checked_at=NOW,
        ),
    )


def test_complete_product_passes_quality_gate_and_is_design_ready():
    result = evaluate_catalog_quality(_product())

    assert result.passes_blocking_gate is True
    assert result.design_ready is True
    assert result.blocking_reasons == ()
    assert result.incomplete_reasons == ()
    assert result.design_gaps == ()
    assert len(result.variants) == 1
    assert result.variants[0].design_ready is True


def test_complete_composition_satisfies_material_quality_without_scalar():
    variant = _complete_variant().model_copy(update={
        "source_material": "Solid beech, MDF, walnut veneer", "normalized_material": None,
    })
    result = evaluate_catalog_quality(_product(variants=[variant]))
    assert result.design_ready is True
    assert "normalized_material_missing" not in result.variants[0].design_gaps


def test_unresolved_taxonomy_is_blocking():
    product = _product(
        furniture_type=None,
        needs_taxonomy_review=True,
    ).model_copy(
        update={
            "source_product_name": "Unclassified Product",
            "source_category": None,
            "source_subcategory": None,
            "source_product_type": None,
        }
    )

    result = evaluate_catalog_quality(product)

    assert result.passes_blocking_gate is False
    assert result.canonical_furniture_type_code is None
    assert "taxonomy_unresolved" in result.blocking_reasons


def test_product_without_variants_is_blocking():
    result = evaluate_catalog_quality(_product(variants=[]))

    assert result.passes_blocking_gate is False
    assert "variant_missing" in result.blocking_reasons


def test_variant_without_identity_is_blocking():
    variant = _complete_variant().model_copy(
        update={
            "vendor_sku": None,
            "vendor_variant_id": None,
            "variant_name": None,
        }
    )

    result = evaluate_catalog_quality(_product(variants=[variant]))

    assert result.passes_blocking_gate is False
    assert "variant_identity_missing" in result.variants[0].blocking_reasons


def test_missing_offer_is_incomplete_not_structurally_blocking():
    variant = _complete_variant().model_copy(update={"current_offer": None})

    result = evaluate_catalog_quality(_product(variants=[variant]))

    assert result.passes_blocking_gate is True
    assert result.design_ready is False
    assert "current_offer_missing" in result.variants[0].incomplete_reasons


def test_offer_without_price_is_incomplete():
    variant = _complete_variant().model_copy(
        update={
            "current_offer": CurrentOffer(
                currency="USD",
                normalized_availability="in_stock",
                checked_at=NOW,
            )
        }
    )

    result = evaluate_catalog_quality(_product(variants=[variant]))

    assert "usable_source_price_missing" in result.variants[0].incomplete_reasons


def test_missing_image_is_incomplete():
    variant = _complete_variant().model_copy(update={"images": []})

    result = evaluate_catalog_quality(_product(variants=[variant]))

    assert "product_image_missing" in result.variants[0].incomplete_reasons
    assert result.design_ready is False


def test_incomplete_dimensions_are_design_gap():
    variant = _complete_variant().model_copy(
        update={
            "dimensions": ProductDimensions(
                width_cm=200,
                depth_cm=None,
                height_cm=80,
            )
        }
    )

    result = evaluate_catalog_quality(_product(variants=[variant]))

    assert "complete_dimensions_missing" in result.variants[0].design_gaps
    assert result.passes_blocking_gate is True
    assert result.design_ready is False


def test_unresolved_source_color_is_design_gap():
    variant = _complete_variant().model_copy(
        update={
            "source_color": "Mystery Fleck",
            "normalized_color": None,
        }
    )

    result = evaluate_catalog_quality(_product(variants=[variant]))

    assert "normalized_color_missing" in result.variants[0].design_gaps


def test_unresolved_source_material_is_design_gap():
    variant = _complete_variant().model_copy(
        update={
            "source_material": "Oak, unknown resin",
            "normalized_material": None,
        }
    )

    result = evaluate_catalog_quality(_product(variants=[variant]))

    assert "normalized_material_missing" in result.variants[0].design_gaps


def test_explicit_steel_hardware_composition_is_no_longer_unresolved():
    variant = _complete_variant().model_copy(update={
        "source_material": "Oak, steel hardware", "normalized_material": None,
    })
    result = evaluate_catalog_quality(_product(variants=[variant]))
    assert result.design_ready is True


def test_quality_evaluation_does_not_mutate_source_product():
    product = _product()
    before = product.model_dump(mode="json")

    evaluate_catalog_quality(product)

    assert product.model_dump(mode="json") == before
