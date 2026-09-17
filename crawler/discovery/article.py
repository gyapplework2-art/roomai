"""Conservative Article US sofa candidate discovery from public listing HTML."""

from dataclasses import dataclass
from datetime import datetime, timezone
import re
from urllib.parse import urlsplit, urlunsplit

from crawler.discovery.category_pages import extract_links

ARTICLE_VENDOR = "Article"
ARTICLE_US_MARKET = "US"
ARTICLE_SOFA_CATEGORY = "sofas"
_PRODUCT_PATH = re.compile(r"^/product/(\d+)/[^/]+/?$")


@dataclass(frozen=True)
class DiscoveryCandidate:
    vendor: str
    vendor_market_code: str
    source_category: str
    product_url: str
    article_page_id: str
    discovered_from: str
    discovered_at: datetime
    source_page_url: str
    source_product_name: str | None = None


@dataclass(frozen=True)
class DiscoveryResult:
    candidates: tuple[DiscoveryCandidate, ...]
    requested_limit: int
    duplicates_skipped: int
    invalid_urls_skipped: int


def canonicalize_article_product_url(url: str) -> tuple[str, str] | None:
    """Return a fragment/query-free Article-style product URL and its explicit page ID."""
    parsed = urlsplit(url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        return None
    match = _PRODUCT_PATH.fullmatch(parsed.path)
    if not match:
        return None
    canonical_path = parsed.path.rstrip("/")
    return urlunsplit((parsed.scheme, parsed.netloc.lower(), canonical_path, "", "")), match.group(1)


def discover_article_sofas(
    html: str,
    source_page_url: str,
    *,
    limit: int = 30,
    discovered_at: datetime | None = None,
) -> DiscoveryResult:
    """Discover at most ``limit`` unique Article-style product links from one supplied page."""
    if limit < 1:
        raise ValueError("Discovery limit must be at least 1.")
    timestamp = discovered_at or datetime.now(timezone.utc)
    candidates: list[DiscoveryCandidate] = []
    seen_page_ids: set[str] = set()
    duplicates_skipped = 0
    invalid_urls_skipped = 0
    for link in extract_links(html, source_page_url):
        canonical = canonicalize_article_product_url(link)
        if canonical is None:
            invalid_urls_skipped += 1
            continue
        product_url, page_id = canonical
        if page_id in seen_page_ids:
            duplicates_skipped += 1
            continue
        seen_page_ids.add(page_id)
        candidates.append(DiscoveryCandidate(
            vendor=ARTICLE_VENDOR,
            vendor_market_code=ARTICLE_US_MARKET,
            source_category=ARTICLE_SOFA_CATEGORY,
            product_url=product_url,
            article_page_id=page_id,
            discovered_from="category_page",
            discovered_at=timestamp,
            source_page_url=source_page_url,
        ))
        if len(candidates) == limit:
            break
    return DiscoveryResult(tuple(candidates), limit, duplicates_skipped, invalid_urls_skipped)


def discover_article_sofa_urls(
    urls: list[str],
    source_page_url: str,
    *,
    limit: int = 30,
    discovered_at: datetime | None = None,
) -> DiscoveryResult:
    """Build candidates from explicit sitemap URLs using the same canonicalization rules."""
    return discover_article_sofas(
        "".join(f'<a href="{url}"></a>' for url in urls),
        source_page_url,
        limit=limit,
        discovered_at=discovered_at,
    )