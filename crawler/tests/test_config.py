from crawler.core.config import CrawlerSettings, get_settings


def test_default_configuration_loads_without_supabase_credentials(monkeypatch):
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.delenv("SUPABASE_SERVICE_ROLE_KEY", raising=False)

    settings = get_settings()

    assert settings.crawler_env == "development"
    assert settings.supabase_url is None


def test_credentials_fail_only_when_database_access_is_requested(monkeypatch):
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.delenv("SUPABASE_SERVICE_ROLE_KEY", raising=False)

    settings = CrawlerSettings()

    try:
        settings.require_supabase_credentials()
    except RuntimeError as error:
        assert "SUPABASE_URL" in str(error)
    else:
        raise AssertionError("Expected missing database credentials to raise.")


def test_credentials_are_available_when_both_values_are_configured():
    settings = CrawlerSettings(
        SUPABASE_URL="https://example.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY="worker-only-key",
    )

    assert settings.require_supabase_credentials() == (
        "https://example.supabase.co",
        "worker-only-key",
    )
