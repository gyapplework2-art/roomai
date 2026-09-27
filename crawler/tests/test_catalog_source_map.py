import pytest

from crawler.discovery.source_map import (
    ApprovedDiscoverySource,
    approved_sources_for_target,
    select_approved_source,
)


def test_article_us_sofa_source_is_explicitly_registered():
    sources = approved_sources_for_target("US", "sofa")

    assert sources == (
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


def test_unregistered_target_returns_no_sources():
    assert approved_sources_for_target("US", "accent_chair") == ()


def test_source_lookup_is_exact_by_market_and_canonical_type():
    assert approved_sources_for_target("CA", "sofa") == ()
    assert approved_sources_for_target("US", "sofas") == ()


def test_select_approved_source_returns_first_registered_source():
    source = select_approved_source("US", "sofa")

    assert source.vendor == "article"
    assert source.source_category == "sofas"
    assert source.source_type == "category"


def test_select_approved_source_rejects_unmapped_target():
    with pytest.raises(
        ValueError,
        match="No approved discovery source for US:accent_chair",
    ):
        select_approved_source("US", "accent_chair")


@pytest.mark.parametrize(
    ("market_code", "furniture_type_code"),
    [
        ("", "sofa"),
        ("US", ""),
        (" ", "sofa"),
        ("US", " "),
    ],
)
def test_source_lookup_rejects_blank_target_keys(
    market_code,
    furniture_type_code,
):
    with pytest.raises(ValueError):
        approved_sources_for_target(
            market_code,
            furniture_type_code,
        )


def test_new_d3a19_article_sources_are_explicitly_mapped():
    expected = {
        "dining_table": ("dining_tables", "10/tables-dining-tables"),
        "area_rug": ("rugs", "50/decor-rugs"),
        "office_chair": ("office_chairs", "82/chairs-office-chairs"),
    }

    for furniture_type, (category, url_fragment) in expected.items():
        sources = approved_sources_for_target("US", furniture_type)

        assert len(sources) == 1

        source = sources[0]
        assert source.vendor == "article"
        assert source.vendor_market_code == "US"
        assert source.source_category == category
        assert url_fragment in source.source_url
