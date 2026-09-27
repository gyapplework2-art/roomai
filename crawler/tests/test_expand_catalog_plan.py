import argparse
import asyncio
import json

import pytest

from crawler.jobs import expand_catalog


def run(coroutine):
    return asyncio.run(coroutine)


def make_args(**overrides):
    values = {
        "stage": "plan",
        "vendor": "article",
        "market": "US",
        "category": "sofas",
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
    return argparse.Namespace(**values)


def coverage_row(document, furniture_type_code):
    return next(
        row
        for row in document["coverage"]["rows"]
        if row["furniture_type_code"] == furniture_type_code
    )


def test_plan_without_inventory_preserves_empty_offline_behavior():
    document = run(expand_catalog.run(make_args()))

    sofa = coverage_row(document, "sofa")
    sectional = coverage_row(document, "sectional_sofa")

    assert sofa["actual_product_count"] == 0
    assert sectional["actual_product_count"] == 0


def test_plan_with_inventory_file_preserves_manual_behavior(tmp_path):
    inventory = tmp_path / "inventory.json"
    inventory.write_text(
        json.dumps(
            {
                "US:sofa": 7,
                "US:sectional_sofa": 3,
            }
        )
    )

    document = run(
        expand_catalog.run(
            make_args(inventory=inventory)
        )
    )

    assert coverage_row(document, "sofa")["actual_product_count"] == 7
    assert coverage_row(document, "sectional_sofa")["actual_product_count"] == 3


def test_plan_with_live_inventory_uses_supabase_counts(monkeypatch):
    class FakeInventoryTransport:
        pass

    async def fake_load_inventory_counts(transport):
        assert isinstance(transport, FakeInventoryTransport)
        return {
            ("US", "sofa"): 3,
            ("US", "sectional_sofa"): 1,
        }

    monkeypatch.setattr(
        expand_catalog,
        "HttpxCatalogInventoryTransport",
        FakeInventoryTransport,
        raising=False,
    )
    monkeypatch.setattr(
        expand_catalog,
        "load_inventory_counts",
        fake_load_inventory_counts,
        raising=False,
    )

    document = run(
        expand_catalog.run(
            make_args(live_inventory=True)
        )
    )

    assert coverage_row(document, "sofa")["actual_product_count"] == 3
    assert coverage_row(document, "sectional_sofa")["actual_product_count"] == 1


def test_plan_rejects_manual_and_live_inventory_together(tmp_path):
    inventory = tmp_path / "inventory.json"
    inventory.write_text('{"US:sofa": 1}')

    with pytest.raises(
        ValueError,
        match="--inventory and --live-inventory cannot be used together",
    ):
        run(
            expand_catalog.run(
                make_args(
                    inventory=inventory,
                    live_inventory=True,
                )
            )
        )


def test_parse_args_accepts_live_inventory(monkeypatch):
    monkeypatch.setattr(
        "sys.argv",
        [
            "expand_catalog",
            "plan",
            "--market",
            "US",
            "--live-inventory",
        ],
    )

    args = expand_catalog.parse_args()

    assert args.stage == "plan"
    assert args.market == "US"
    assert args.live_inventory is True
    assert args.inventory is None


def test_plan_exposes_bounded_expansion_targets():
    document = run(
        expand_catalog.run(
            make_args(limit=3)
        )
    )

    targets = document["coverage"]["expansion_targets"]

    assert len(targets) == 3
    assert [
        target["furniture_type_code"]
        for target in targets
    ] == [
        "accent_chair",
        "area_rug",
        "bed_frame",
    ]
    assert all(target["priority"] == "critical" for target in targets)
    assert all(target["status"] == "empty" for target in targets)


def test_live_inventory_expansion_targets_reflect_current_counts(monkeypatch):
    class FakeInventoryTransport:
        pass

    async def fake_load_inventory_counts(transport):
        assert isinstance(transport, FakeInventoryTransport)
        return {
            ("US", "sofa"): 3,
            ("US", "sectional_sofa"): 1,
            ("US", "area_rug"): 1,
        }

    monkeypatch.setattr(
        expand_catalog,
        "HttpxCatalogInventoryTransport",
        FakeInventoryTransport,
        raising=False,
    )
    monkeypatch.setattr(
        expand_catalog,
        "load_inventory_counts",
        fake_load_inventory_counts,
        raising=False,
    )

    document = run(
        expand_catalog.run(
            make_args(
                live_inventory=True,
                limit=11,
            )
        )
    )

    targets = document["coverage"]["expansion_targets"]

    assert [
        target["furniture_type_code"]
        for target in targets
    ] == [
        "accent_chair",
        "bed_frame",
        "coffee_table",
        "desk",
        "dining_chair",
        "dining_table",
        "office_chair",
        "sofa_with_chaise",
        "area_rug",
        "sectional_sofa",
        "sofa",
    ]

    assert targets[8]["actual_product_count"] == 1
    assert targets[8]["status"] == "under_target"
    assert targets[9]["actual_product_count"] == 1
    assert targets[9]["status"] == "under_target"
    assert targets[10]["actual_product_count"] == 3
    assert targets[10]["status"] == "under_target"


def test_plan_reports_approved_source_availability_for_expansion_targets():
    document = run(
        expand_catalog.run(
            make_args(limit=30)
        )
    )

    statuses = document["coverage"]["expansion_source_status"]
    by_type = {
        item["furniture_type_code"]: item
        for item in statuses
    }

    assert by_type["sofa"] == {
        "market_code": "US",
        "furniture_type_code": "sofa",
        "source_available": True,
        "approved_sources": [
            {
                "market_code": "US",
                "furniture_type_code": "sofa",
                "vendor": "article",
                "vendor_market_code": "US",
                "source_category": "sofas",
                "source_type": "category",
                "source_url": "https://www.article.com/browse/1/sofas?collectionId=603",
            }
        ],
    }

    assert by_type["accent_chair"] == {
        "market_code": "US",
        "furniture_type_code": "accent_chair",
        "source_available": False,
        "approved_sources": [],
    }


def test_expansion_source_status_is_bounded_with_expansion_targets():
    document = run(
        expand_catalog.run(
            make_args(limit=3)
        )
    )

    targets = document["coverage"]["expansion_targets"]
    statuses = document["coverage"]["expansion_source_status"]

    assert len(targets) == 3
    assert len(statuses) == 3

    assert [
        item["furniture_type_code"]
        for item in statuses
    ] == [
        item["furniture_type_code"]
        for item in targets
    ]
