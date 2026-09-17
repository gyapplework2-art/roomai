"""Safe standard-library logging for crawler jobs."""

import logging
from collections.abc import Mapping

from crawler.core.config import CrawlerSettings


class ContextAdapter(logging.LoggerAdapter[logging.Logger]):
    """Attach future crawl context without requiring every key on every record."""

    def process(self, message: object, kwargs: Mapping[str, object]):
        extra = dict(self.extra)
        extra.update(kwargs.get("extra", {}) if isinstance(kwargs.get("extra"), dict) else {})
        return message, {**kwargs, "extra": extra}


def configure_logging(settings: CrawlerSettings) -> None:
    """Configure a conservative logger without emitting settings or secrets."""
    logging.basicConfig(
        level=getattr(logging, settings.crawler_log_level.upper(), logging.INFO),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )


def get_logger(name: str, **context: str) -> ContextAdapter:
    """Create a logger that may carry vendor_market, crawl_job, URL, and status context."""
    return ContextAdapter(logging.getLogger(name), context)
