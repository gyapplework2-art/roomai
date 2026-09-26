"""Vendor-neutral, bounded discovery contracts for explicitly approved sources."""

from collections.abc import Callable, Iterable
from dataclasses import dataclass
from datetime import datetime, timezone
from urllib.parse import urlsplit, urlunsplit


@dataclass(frozen=True)
class CatalogDiscoveryCandidate:
    vendor: str
    vendor_market_code: str
    source_category: str
    product_url: str
    vendor_product_key: str | None
    discovered_from: str
    discovered_at: datetime
    source_page_url: str
    source_product_name: str | None = None


@dataclass(frozen=True)
class CatalogDiscoveryResult:
    candidates: tuple[CatalogDiscoveryCandidate, ...]
    requested_limit: int
    duplicates_skipped: int
    invalid_urls_skipped: int


def canonicalize_http_url(url: str) -> str | None:
    parsed = urlsplit(url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc or not parsed.path:
        return None
    return urlunsplit((parsed.scheme, parsed.netloc.lower(), parsed.path.rstrip("/"), "", ""))


def discover_catalog_candidates(
    urls: Iterable[str],
    *,
    vendor: str,
    vendor_market_code: str,
    source_category: str,
    source_page_url: str,
    discovered_from: str = "approved_source",
    limit: int = 30,
    discovered_at: datetime | None = None,
    canonicalize: Callable[[str], tuple[str, str | None] | None] | None = None,
    is_product_url: Callable[[str], bool] | None = None,
) -> CatalogDiscoveryResult:
    """Build bounded candidates from explicit source URLs without fetching or extracting products."""
    if not vendor.strip() or not vendor_market_code.strip() or not source_category.strip():
        raise ValueError("vendor, vendor_market_code, and source_category are required.")
    if not source_page_url.strip():
        raise ValueError("source_page_url is required.")
    if limit < 1:
        raise ValueError("Discovery limit must be at least 1.")

    timestamp = discovered_at or datetime.now(timezone.utc)
    if canonicalize is None and is_product_url is None:
        raise ValueError("An approved canonicalizer or product URL predicate is required.")
    canonicalizer = canonicalize or (lambda url: (canonicalize_http_url(url), None) if canonicalize_http_url(url) else None)
    candidates: list[CatalogDiscoveryCandidate] = []
    seen: set[tuple[str, str | None]] = set()
    duplicates_skipped = 0
    invalid_urls_skipped = 0
    for raw_url in urls:
        canonical = canonicalizer(raw_url)
        if canonical is None:
            invalid_urls_skipped += 1
            continue
        product_url, vendor_product_key = canonical
        if is_product_url is not None and not is_product_url(product_url):
            invalid_urls_skipped += 1
            continue
        identity = (product_url, vendor_product_key)
        if identity in seen:
            duplicates_skipped += 1
            continue
        seen.add(identity)
        candidates.append(CatalogDiscoveryCandidate(
            vendor=vendor.strip(),
            vendor_market_code=vendor_market_code.strip(),
            source_category=source_category.strip(),
            product_url=product_url,
            vendor_product_key=vendor_product_key,
            discovered_from=discovered_from,
            discovered_at=timestamp,
            source_page_url=source_page_url,
        ))
        if len(candidates) == limit:
            break
    return CatalogDiscoveryResult(tuple(candidates), limit, duplicates_skipped, invalid_urls_skipped)
