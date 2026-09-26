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
