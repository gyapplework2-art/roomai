"""Environment-backed configuration for background crawler processes.

Settings are import-safe: Supabase credentials are only required by callers that
explicitly request database configuration.
"""

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class CrawlerSettings(BaseSettings):
    """Non-secret crawler settings with optional background-worker credentials."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    supabase_url: str | None = Field(default=None, validation_alias="SUPABASE_URL")
    supabase_service_role_key: str | None = Field(
        default=None,
        validation_alias="SUPABASE_SERVICE_ROLE_KEY",
        repr=False,
    )
    crawler_env: str = Field(default="development", validation_alias="CRAWLER_ENV")
    crawler_log_level: str = Field(default="INFO", validation_alias="CRAWLER_LOG_LEVEL")
    crawler_user_agent: str = Field(
        default="RoomAI-CatalogCrawler/0.1 (+https://example.com)",
        validation_alias="CRAWLER_USER_AGENT",
    )
    crawler_request_timeout_seconds: float = Field(
        default=20.0,
        gt=0,
        validation_alias="CRAWLER_REQUEST_TIMEOUT_SECONDS",
    )
    crawler_min_request_interval_seconds: float = Field(
        default=1.0,
        ge=0,
        validation_alias="CRAWLER_MIN_REQUEST_INTERVAL_SECONDS",
    )
    crawler_max_retries: int = Field(
        default=2,
        ge=0,
        le=5,
        validation_alias="CRAWLER_MAX_RETRIES",
    )
    crawler_retry_backoff_seconds: float = Field(
        default=0.5,
        ge=0,
        validation_alias="CRAWLER_RETRY_BACKOFF_SECONDS",
    )

    def require_supabase_credentials(self) -> tuple[str, str]:
        """Return worker-only Supabase credentials or raise a clear error."""
        if not self.supabase_url or not self.supabase_service_role_key:
            raise RuntimeError(
                "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for database operations."
            )
        return self.supabase_url, self.supabase_service_role_key


def get_settings() -> CrawlerSettings:
    """Load crawler settings without requiring database credentials."""
    return CrawlerSettings()
