"""Future category-page discovery boundary; no browser or HTTP work occurs here."""

from collections.abc import Iterable


def discover_from_category_page(category_url: str) -> Iterable[str]:
    """Reserve category URL discovery without issuing network requests."""
    raise NotImplementedError("Category-page discovery is not implemented yet.")
