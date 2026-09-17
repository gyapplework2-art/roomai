import asyncio

import httpx
import pytest

from crawler.core.config import CrawlerSettings
from crawler.core.fetcher import HttpFetcher


def run(coroutine):
    return asyncio.run(coroutine)


def settings(**overrides):
    values = {
        "CRAWLER_MIN_REQUEST_INTERVAL_SECONDS": 0,
        "CRAWLER_RETRY_BACKOFF_SECONDS": 0,
    }
    values.update(overrides)
    return CrawlerSettings(**values)


def test_successful_html_fetch_uses_configured_user_agent():
    observed_headers = []

    def handler(request: httpx.Request) -> httpx.Response:
        observed_headers.append(request.headers["user-agent"])
        return httpx.Response(200, text="<html>ok</html>", headers={"content-type": "text/html"}, request=request)

    result = run(HttpFetcher(settings(CRAWLER_USER_AGENT="TestCrawler/1.0"), transport=httpx.MockTransport(handler)).fetch("https://example.com/product"))

    assert result.succeeded
    assert result.response_text == "<html>ok</html>"
    assert result.content_type == "text/html"
    assert observed_headers == ["TestCrawler/1.0"]


def test_successful_fetch_uses_default_user_agent():
    observed_headers = []

    def handler(request: httpx.Request) -> httpx.Response:
        observed_headers.append(request.headers["user-agent"])
        return httpx.Response(200, request=request)

    result = run(HttpFetcher(settings(), transport=httpx.MockTransport(handler)).fetch("https://example.com/product"))

    assert result.succeeded
    assert observed_headers == ["RoomAI-CatalogCrawler/0.1 (+https://example.com)"]


def test_redirect_reports_final_url():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/start":
            return httpx.Response(302, headers={"location": "/final"}, request=request)
        return httpx.Response(200, text="done", request=request)

    result = run(HttpFetcher(settings(), transport=httpx.MockTransport(handler)).fetch("https://example.com/start"))

    assert result.succeeded
    assert result.final_url == "https://example.com/final"


def test_transport_failure_retries_then_returns_error():
    calls = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        raise httpx.ConnectError("offline", request=request)

    result = run(HttpFetcher(settings(CRAWLER_MAX_RETRIES=2), transport=httpx.MockTransport(handler)).fetch("https://example.com/product"))

    assert calls == 3
    assert result.error is not None
    assert result.error.retryable


@pytest.mark.parametrize("status_code", [429, 503])
def test_transient_statuses_retry(status_code: int):
    calls = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(200 if calls == 2 else status_code, text="ok", request=request)

    result = run(HttpFetcher(settings(CRAWLER_MAX_RETRIES=1), transport=httpx.MockTransport(handler)).fetch("https://example.com/product"))

    assert result.succeeded
    assert result.attempts == 2


def test_not_found_does_not_retry():
    calls = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(404, request=request)

    result = run(HttpFetcher(settings(CRAWLER_MAX_RETRIES=2), transport=httpx.MockTransport(handler)).fetch("https://example.com/missing"))

    assert calls == 1
    assert result.status_code == 404
    assert result.error is not None
    assert not result.error.retryable


def test_non_http_url_is_rejected():
    with pytest.raises(ValueError, match="HTTP or HTTPS"):
        run(HttpFetcher(settings()).fetch("ftp://example.com/product"))


def test_request_interval_is_respected_without_waiting():
    delays = []
    clock_values = iter([0.0, 0.25, 1.0])

    async def record_sleep(delay: float) -> None:
        delays.append(delay)

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, request=request)

    fetcher = HttpFetcher(
        settings(CRAWLER_MIN_REQUEST_INTERVAL_SECONDS=1),
        transport=httpx.MockTransport(handler),
        sleep=record_sleep,
        clock=lambda: next(clock_values),
    )
    run(fetcher.fetch("https://example.com/one"))
    run(fetcher.fetch("https://example.com/two"))

    assert delays == [0.75]
