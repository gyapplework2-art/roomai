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
