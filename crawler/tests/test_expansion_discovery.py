import asyncio
from argparse import Namespace

import pytest

from crawler.discovery.article import (
    canonicalize_article_product_url,
    discover_article_category,
)
from crawler.discovery.source_map import select_approved_source
from crawler.jobs import expand_catalog


def run(coro):
    return asyncio.run(coro)


def make_args(**overrides):
    values = {
        "stage": "discover",
        "vendor": "article",
        "market": "US",
        "category": "sofas",
        "furniture_type": None,
        "source_url": None,
        "source_type": "category",
        "input": None,
        "output": None,
        "inventory": None,
        "live_inventory": False,
        "variant_id": [],
        "limit": 10,
        "execute": False,
    }
    values.update(overrides)
    return Namespace(**values)


def test_article_category_discovery_is_not_sofa_specific():
    html = """
    <html>
      <body>
        <a href="/product/101/lenia-white-oak-bed">Bed</a>
        <a href="/product/202/svelti-black-dining-chair">Chair</a>
      </body>
    </html>
    """

    result = discover_article_category(
        html,
        "https://www.article.com/browse/example",
        source_category="example-category",
        limit=10,
    )

    assert [candidate.article_page_id for candidate in result.candidates] == [
        "101",
        "202",
    ]
    assert all(
        candidate.source_category == "example-category"
        for candidate in result.candidates
    )


def test_article_category_discovery_reuses_article_product_canonicalizer():
    assert canonicalize_article_product_url(
        "https://www.article.com/product/101/example-chair?ref=category"
    ) == (
        "https://www.article.com/product/101/example-chair",
        "101",
    )


def test_existing_sofa_target_has_approved_source():
    source = select_approved_source("US", "sofa")

    assert source.vendor == "article"
    assert source.source_category == "sofas"
    assert source.source_type == "category"


def test_unapproved_target_fails_instead_of_guessing():
    with pytest.raises(
        ValueError,
        match="No approved discovery source for US:accent_chair",
    ):
        select_approved_source("US", "accent_chair")


def test_discover_target_requires_furniture_type_when_source_is_not_manual():
    args = make_args(
        furniture_type=None,
        source_url=None,
    )

    with pytest.raises(ValueError):
        run(expand_catalog.run(args))


@pytest.mark.parametrize(
    ("furniture_type", "source_category", "source_path"),
    [
        ("sectional_sofa", "sectionals", "/browse/27/sofas-sectionals"),
        ("coffee_table", "coffee_tables", "/browse/21/tables-coffee-tables"),
        ("dining_chair", "dining_chairs", "/browse/7/chairs-dining-chairs"),
        ("bed_frame", "beds", "/browse/14/bedroom-beds"),
        ("desk", "desks", "/browse/37/tables-desks"),
    ],
)
def test_verified_article_sources_are_registered(
    furniture_type,
    source_category,
    source_path,
):
    source = select_approved_source("US", furniture_type)

    assert source.vendor == "article"
    assert source.vendor_market_code == "US"
    assert source.source_category == source_category
    assert source.source_type == "category"
    assert source.source_url.startswith("https://www.article.com")
    assert source_path in source.source_url
