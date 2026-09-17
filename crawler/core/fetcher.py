"""Future rate-limited HTTP fetching boundary; no network calls are implemented yet."""

from dataclasses import dataclass


@dataclass(frozen=True)
class FetchResult:
    url: str
    status_code: int
    body: str


async def fetch_url(url: str) -> FetchResult:
    """Reserve the future fetcher interface without performing a request."""
    raise NotImplementedError("HTTP fetching is not implemented in crawler foundation.")
