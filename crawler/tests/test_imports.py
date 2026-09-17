from abc import ABC

import pytest

from crawler.core import database, fetcher, normalizer, pricing, structured_data, validator
from crawler.discovery import category_pages, sitemap
from crawler.jobs import discover_products, refresh_products, reprice_products
from crawler.vendors.base import BaseVendorAdapter


def test_placeholder_modules_import_cleanly():
    assert all(
        [
            database,
            fetcher,
            normalizer,
            pricing,
            structured_data,
            validator,
            category_pages,
            sitemap,
            discover_products,
            refresh_products,
            reprice_products,
        ]
    )


def test_base_vendor_adapter_is_abstract():
    assert issubclass(BaseVendorAdapter, ABC)
    with pytest.raises(TypeError):
        BaseVendorAdapter("mock-us")
