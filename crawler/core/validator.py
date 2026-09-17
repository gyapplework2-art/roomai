"""Future source-fact validation boundary."""

from crawler.models.product import CatalogProduct


def validate_product(product: CatalogProduct) -> CatalogProduct:
    """Return an already-validated Pydantic product contract."""
    return product
