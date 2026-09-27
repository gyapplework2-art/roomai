"""Approved discovery sources for canonical catalog expansion targets."""

from dataclasses import dataclass
from typing import Literal


SourceType = Literal["category", "sitemap"]


@dataclass(frozen=True)
class ApprovedDiscoverySource:
    """One explicitly approved source for a canonical expansion target."""

    market_code: str
    furniture_type_code: str
    vendor: str
    vendor_market_code: str
    source_category: str
    source_type: SourceType
    source_url: str


_APPROVED_DISCOVERY_SOURCES: tuple[ApprovedDiscoverySource, ...] = (
    ApprovedDiscoverySource(
        market_code="US",
        furniture_type_code="sofa",
        vendor="article",
        vendor_market_code="US",
        source_category="sofas",
        source_type="category",
        source_url="https://www.article.com/browse/1/sofas?collectionId=603",
    ),
    ApprovedDiscoverySource(
        market_code="US",
        furniture_type_code="sectional_sofa",
        vendor="article",
        vendor_market_code="US",
        source_category="sectionals",
        source_type="category",
        source_url="https://www.article.com/browse/27/sofas-sectionals",
    ),
    ApprovedDiscoverySource(
        market_code="US",
        furniture_type_code="coffee_table",
        vendor="article",
        vendor_market_code="US",
        source_category="coffee_tables",
        source_type="category",
        source_url="https://www.article.com/browse/21/tables-coffee-tables",
    ),
    ApprovedDiscoverySource(
        market_code="US",
        furniture_type_code="dining_chair",
        vendor="article",
        vendor_market_code="US",
        source_category="dining_chairs",
        source_type="category",
        source_url="https://www.article.com/browse/7/chairs-dining-chairs",
    ),
    ApprovedDiscoverySource(
        market_code="US",
        furniture_type_code="bed_frame",
        vendor="article",
        vendor_market_code="US",
        source_category="beds",
        source_type="category",
        source_url="https://www.article.com/browse/14/bedroom-beds",
    ),
    ApprovedDiscoverySource(
        market_code="US",
        furniture_type_code="desk",
        vendor="article",
        vendor_market_code="US",
        source_category="desks",
        source_type="category",
        source_url="https://www.article.com/browse/37/tables-desks",
    ),
    ApprovedDiscoverySource(
        market_code="US",
        furniture_type_code="dining_table",
        vendor="article",
        vendor_market_code="US",
        source_category="dining_tables",
        source_type="category",
        source_url="https://www.article.com/browse/10/tables-dining-tables",
    ),
    ApprovedDiscoverySource(
        market_code="US",
        furniture_type_code="area_rug",
        vendor="article",
        vendor_market_code="US",
        source_category="rugs",
        source_type="category",
        source_url="https://www.article.com/browse/50/decor-rugs",
    ),
    ApprovedDiscoverySource(
        market_code="US",
        furniture_type_code="office_chair",
        vendor="article",
        vendor_market_code="US",
        source_category="office_chairs",
        source_type="category",
        source_url="https://www.article.com/browse/82/chairs-office-chairs",
    ),
)


def approved_sources_for_target(
    market_code: str,
    furniture_type_code: str,
) -> tuple[ApprovedDiscoverySource, ...]:
    """Return approved sources for one exact canonical coverage target."""

    if not market_code.strip():
        raise ValueError("market_code is required.")
    if not furniture_type_code.strip():
        raise ValueError("furniture_type_code is required.")

    return tuple(
        source
        for source in _APPROVED_DISCOVERY_SOURCES
        if source.market_code == market_code
        and source.furniture_type_code == furniture_type_code
    )


def select_approved_source(
    market_code: str,
    furniture_type_code: str,
) -> ApprovedDiscoverySource:
    """Return the first approved source for a target or fail explicitly."""

    sources = approved_sources_for_target(
        market_code,
        furniture_type_code,
    )

    if not sources:
        raise ValueError(
            "No approved discovery source for "
            f"{market_code}:{furniture_type_code}"
        )

    return sources[0]
