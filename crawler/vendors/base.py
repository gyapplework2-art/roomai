"""Abstract interface for country-specific vendor-market adapters."""

from abc import ABC, abstractmethod
from collections.abc import Iterable

from crawler.models.product import CatalogProduct


class BaseVendorAdapter(ABC):
    """Discover and parse source facts for exactly one vendor market."""

    vendor_market_code: str

    def __init__(self, vendor_market_code: str) -> None:
        if not vendor_market_code.strip():
            raise ValueError("vendor_market_code cannot be blank.")
        self.vendor_market_code = vendor_market_code

    @abstractmethod
    def discover_product_urls(self) -> Iterable[str]:
        """Yield product URLs for this adapter's single vendor market."""

    @abstractmethod
    def parse_product(self, source: str) -> CatalogProduct:
        """Parse source content into a CatalogProduct for this vendor market."""
