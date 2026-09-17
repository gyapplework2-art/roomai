"""Future sitemap discovery boundary; no sitemap fetching is implemented yet."""

from collections.abc import Iterable


def discover_from_sitemap(sitemap_url: str) -> Iterable[str]:
    """Reserve sitemap URL discovery without issuing network requests."""
    raise NotImplementedError("Sitemap discovery is not implemented yet.")
