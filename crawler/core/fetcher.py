"""Generic, rate-limited HTTP acquisition for background crawler jobs.

Vendor adapters remain responsible for terms, robots policies, and any
vendor-market-specific access restrictions. This module contains no bypassing
or retailer-specific behavior.
"""

import asyncio
from dataclasses import dataclass
from datetime import datetime, timezone
from time import monotonic
from typing import Awaitable, Callable
from urllib.parse import urlparse

import httpx

from crawler.core.config import CrawlerSettings, get_settings

TRANSIENT_STATUS_CODES = frozenset({429, 500, 502, 503, 504})

__all__ = ["FetchError", "FetchResult", "HttpFetcher", "fetch_url"]


@dataclass(frozen=True)
class FetchError:
    """Non-secret diagnostic information for an unsuccessful request."""

    message: str
    retryable: bool


@dataclass(frozen=True)
class FetchResult:
    """The final response state after redirects and any bounded retries."""

    requested_url: str
    final_url: str
    status_code: int | None
    response_text: str | None
    content_type: str | None
    fetched_at: datetime
    attempts: int
    error: FetchError | None = None

    @property
    def succeeded(self) -> bool:
        return self.error is None and self.status_code is not None and 200 <= self.status_code < 400


def _validate_http_url(url: str) -> None:
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError("URL must use HTTP or HTTPS.")


class HttpFetcher:
    """A sequential fetcher with configurable throttling and bounded retries."""

    def __init__(
        self,
        settings: CrawlerSettings | None = None,
        *,
        transport: httpx.AsyncBaseTransport | None = None,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
        clock: Callable[[], float] = monotonic,
    ) -> None:
        self._settings = settings or get_settings()
        self._transport = transport
        self._sleep = sleep
        self._clock = clock
        self._last_request_at: float | None = None

    async def fetch(self, url: str) -> FetchResult:
        """Fetch one HTTP(S) URL, returning structured failures instead of raising transport errors."""
        _validate_http_url(url)

        async with httpx.AsyncClient(
            follow_redirects=True,
            headers={"User-Agent": self._settings.crawler_user_agent},
            timeout=self._settings.crawler_request_timeout_seconds,
            transport=self._transport,
        ) as client:
            for attempt in range(1, self._settings.crawler_max_retries + 2):
                await self._respect_request_interval()
                try:
                    self._last_request_at = self._clock()
                    response = await client.get(url)
                except (httpx.ConnectError, httpx.TimeoutException, httpx.TransportError) as error:
                    if attempt <= self._settings.crawler_max_retries:
                        await self._backoff(attempt)
                        continue
                    return self._failure(url, attempt, str(error), retryable=True)

                if response.status_code in TRANSIENT_STATUS_CODES and attempt <= self._settings.crawler_max_retries:
                    await self._backoff(attempt)
                    continue

                error = None
                if response.status_code >= 400:
                    error = FetchError(
                        message=f"HTTP {response.status_code}",
                        retryable=response.status_code in TRANSIENT_STATUS_CODES,
                    )
                return FetchResult(
                    requested_url=url,
                    final_url=str(response.url),
                    status_code=response.status_code,
                    response_text=response.text,
                    content_type=response.headers.get("content-type"),
                    fetched_at=datetime.now(timezone.utc),
                    attempts=attempt,
                    error=error,
                )

        return self._failure(url, 0, "Request did not complete.", retryable=False)

    async def _respect_request_interval(self) -> None:
        if self._last_request_at is None:
            return
        elapsed = self._clock() - self._last_request_at
        remaining = self._settings.crawler_min_request_interval_seconds - elapsed
        if remaining > 0:
            await self._sleep(remaining)

    async def _backoff(self, attempt: int) -> None:
        await self._sleep(self._settings.crawler_retry_backoff_seconds * (2 ** (attempt - 1)))

    @staticmethod
    def _failure(url: str, attempts: int, message: str, *, retryable: bool) -> FetchResult:
        return FetchResult(
            requested_url=url,
            final_url=url,
            status_code=None,
            response_text=None,
            content_type=None,
            fetched_at=datetime.now(timezone.utc),
            attempts=attempts,
            error=FetchError(message=message, retryable=retryable),
        )


async def fetch_url(url: str, settings: CrawlerSettings | None = None) -> FetchResult:
    """Convenience function for one generic fetch operation."""
    return await HttpFetcher(settings).fetch(url)
