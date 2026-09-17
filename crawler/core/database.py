"""Future Supabase persistence boundary; no database calls are implemented yet."""

from crawler.models.product import CatalogProduct


async def save_product(product: CatalogProduct) -> None:
    """Reserve persistence while preventing accidental foundation-stage writes."""
    raise NotImplementedError("Database persistence is not implemented in crawler foundation.")
