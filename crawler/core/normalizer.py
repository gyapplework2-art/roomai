"""Future source-to-RoomAI terminology normalization boundary."""

from crawler.models.product import CatalogProduct


def normalize_product(product: CatalogProduct) -> CatalogProduct:
    """Reserve normalization without applying aesthetic or taxonomy judgments."""
    return product
