import asyncio
import json
from datetime import datetime, timezone
from pathlib import Path

import httpx

from crawler.core.config import CrawlerSettings
from crawler.core.persistence import build_persistence_plan
from crawler.core.supabase_repository import HttpxPostgrestTransport, RestResponse, SupabaseCatalogExecutor, _response
from crawler.vendors.article import ArticleVendorAdapter
from crawler.vendors.ikea import IkeaVendorAdapter


FIXTURES = Path(__file__).parent / "fixtures"


def run(coroutine):
    return asyncio.run(coroutine)


class FakeTransport:
    def __init__(
        self,
        missing_country: bool = False,
        missing_furniture_type: bool = False,
        fail_table: str | None = None,
        existing_offers: dict[str, dict[str, object]] | None = None,
        fail_current_offer_read: bool = False,
    ):
        self.missing_country = missing_country
        self.missing_furniture_type = missing_furniture_type
        self.fail_table = fail_table
        self.existing_offers = existing_offers or {}
        self.fail_current_offer_read = fail_current_offer_read
        self.calls: list[tuple[str, dict[str, object], str]] = []
        self._ids: dict[str, str] = {}

    async def resolve_country(self, country_code: str) -> RestResponse:
        self.calls.append(("catalog_countries", {"country_code": country_code}, "resolve"))
        return RestResponse(200, [] if self.missing_country else [{"id": "country-uuid-us"}])
    async def resolve_furniture_type(self, furniture_type_code: str) -> RestResponse:
        self.calls.append(
            ("catalog_furniture_types", {"code": furniture_type_code}, "resolve")
        )
        return RestResponse(
            200,
            []
            if self.missing_furniture_type
            else [{"id": f"furniture-type-uuid-{furniture_type_code}"}],
        )

    async def get_current_offer(self, variant_id: str) -> RestResponse:
        self.calls.append(("catalog_current_offers", {"variant_id": variant_id}, "read"))
        if self.fail_current_offer_read:
            return RestResponse(500, [], "current_offer_read_failed")
        offer = self.existing_offers.get(variant_id)
        return RestResponse(200, [offer] if offer else [])

    async def append_history(self, table: str, values: dict[str, object]) -> RestResponse:
        self.calls.append((table, values, "append"))
        if table == self.fail_table:
            return RestResponse(500, [], "history_insert_failed")
        return RestResponse(201, [{"id": f"{table}-history-id"}])

    async def upsert(self, table: str, values: dict[str, object], conflict_target: str) -> RestResponse:
        self.calls.append((table, values, conflict_target))
        if table == self.fail_table:
            return RestResponse(500, [], "upsert_failed")
        key = f"{table}:{conflict_target}:{values}"
        self._ids.setdefault(key, f"uuid-{len(self._ids) + 1}")
        return RestResponse(201, [{"id": self._ids[key]}])


def settings(allow: bool = False, maximum: int = 1) -> CrawlerSettings:
    return CrawlerSettings(CATALOG_ALLOW_WRITES=allow, CATALOG_MAX_PRODUCTS_PER_EXECUTION=maximum)


def product(vendor: str):
    adapter = ArticleVendorAdapter() if vendor == "article" else IkeaVendorAdapter()
    fixture = "normal_sofa.html" if vendor == "article" else "hyltarp_sofa.html"
    return adapter.parse_product(
        (FIXTURES / vendor / fixture).read_text(),
        f"https://example.com/{vendor}/product",
        datetime(2026, 9, 18, tzinfo=timezone.utc),
    )


def plan(vendor: str):
    persistence_plan = build_persistence_plan(product(vendor))

    if persistence_plan.canonical_furniture_type_code is None:
        persistence_plan = persistence_plan.__class__(
            vendor=persistence_plan.vendor,
            vendor_market=persistence_plan.vendor_market,
            product_natural_key=persistence_plan.product_natural_key,
            canonical_furniture_type_code="sofa",
            product={
                **persistence_plan.product,
                "needs_taxonomy_review": False,
            },
            variants=persistence_plan.variants,
            review_reasons=tuple(
                reason
                for reason in persistence_plan.review_reasons
                if reason != "taxonomy_review"
            ),
        )

    return persistence_plan


def test_default_and_execute_without_environment_guard_make_zero_requests():
    transport = FakeTransport()
    executor = SupabaseCatalogExecutor(transport, settings=settings(False), write_enabled=True)

    default = run(executor.execute(plan("ikea")))
    guarded = run(executor.execute(plan("ikea"), execution_requested=True))

    assert default.write_attempted is False
    assert guarded.writes_enabled is False
    assert transport.calls == []


def test_modern_secret_key_is_an_opaque_apikey_header_without_jwt_bearer_authentication():
    secret = "sb_secret_opaque_not_a_jwt"
    transport = HttpxPostgrestTransport(CrawlerSettings(
        SUPABASE_URL="https://example.supabase.co",
        SUPABASE_SECRET_KEY=secret,
    ))

    headers = transport._headers()

    assert headers["apikey"] == secret
    assert "Authorization" not in headers
    assert "eyJ" not in secret


def test_execution_reports_do_not_include_configured_secret_key():
    secret = "sb_secret_report_safety"
    report = run(SupabaseCatalogExecutor(
        FakeTransport(),
        settings=CrawlerSettings(CATALOG_ALLOW_WRITES=False, SUPABASE_SECRET_KEY=secret),
        write_enabled=True,
    ).execute(plan("ikea"), execution_requested=True))

    assert secret not in str(report.as_dict())


def test_dual_guard_resolves_real_ids_and_uses_deployed_conflict_targets():
    transport = FakeTransport()
    report = run(SupabaseCatalogExecutor(transport, settings=settings(True), write_enabled=True).execute(plan("ikea"), execution_requested=True))

    assert report.write_succeeded
    assert report.resolved_identifiers["country:US"] == "country-uuid-us"
    calls = {table: (values, conflict) for table, values, conflict in transport.calls if table != "catalog_countries"}
    assert calls["catalog_products"][1] == "vendor_market_id,persistence_key"
    assert calls["catalog_product_variants"][1] == "product_id,persistence_key"
    assert calls["catalog_product_dimensions"][1] == "variant_id"
    assert calls["catalog_current_offers"][1] == "variant_id"
    assert calls["catalog_product_images"][1] == "product_id,variant_id,source_url"
    assert not any(isinstance(value, str) and value.startswith(("vendor:", "country:", "market:", "product:", "variant:")) for values, _ in calls.values() for value in values.values())


def test_missing_country_skips_dependent_chain_without_creating_country():
    transport = FakeTransport(missing_country=True)
    report = run(SupabaseCatalogExecutor(transport, settings=settings(True), write_enabled=True).execute(plan("article"), execution_requested=True))

    assert report.failed_operations == [{"table": "catalog_countries", "reason": "country_not_found"}]
    assert {item["table"] for item in report.skipped_operations} >= {"catalog_vendor_markets", "catalog_products"}
    assert [call[0] for call in transport.calls] == [
    "catalog_vendors",
    "catalog_countries",
    "catalog_furniture_types",
]


def test_missing_persistence_key_and_non_staging_plan_block_before_writes():
    source_plan = plan("article")
    blocked = source_plan.__class__(
        vendor=source_plan.vendor, vendor_market=source_plan.vendor_market,
        product_natural_key=source_plan.product_natural_key,
        canonical_furniture_type_code=source_plan.canonical_furniture_type_code,
        product={**source_plan.product, "persistence_key": "", "publication_status": "published"},
        variants=source_plan.variants, review_reasons=source_plan.review_reasons,
    )
    transport = FakeTransport()
    report = run(SupabaseCatalogExecutor(transport, settings=settings(True), write_enabled=True).execute(blocked, execution_requested=True))

    assert "missing_persistence_key:catalog_products" in report.blocking_reasons
    assert "non_staging_publication_status" in report.blocking_reasons
    assert transport.calls == []


def test_parent_failure_skips_children_and_repeated_plan_converges_with_same_transport():
    failed_transport = FakeTransport(fail_table="catalog_products")
    failed = run(SupabaseCatalogExecutor(failed_transport, settings=settings(True), write_enabled=True).execute(plan("article"), execution_requested=True))
    assert any(item["table"] == "catalog_product_variants" for item in failed.skipped_operations)

    transport = FakeTransport()
    executor = SupabaseCatalogExecutor(transport, settings=settings(True), write_enabled=True)
    first = run(executor.execute(plan("article"), execution_requested=True))
    second = run(executor.execute(plan("article"), execution_requested=True))
    assert first.write_succeeded and second.write_succeeded
    assert first.resolved_identifiers == second.resolved_identifiers


def test_variant_response_id_is_used_for_all_variant_children_without_child_overwrite():
    ids = {
        "catalog_vendor_markets": "market-id-existing-or-new",
        "catalog_products": "product-id-existing-or-new",
        "catalog_product_variants": "variant-id-returned-by-postgrest",
        "catalog_product_dimensions": "dimension-row-id-must-not-overwrite-variant",
        "catalog_current_offers": "offer-row-id-must-not-overwrite-variant",
        "catalog_product_images": "image-row-id-must-not-overwrite-variant",
    }

    class StableIdTransport(FakeTransport):
        async def upsert(self, table: str, values: dict[str, object], conflict_target: str) -> RestResponse:
            self.calls.append((table, values, conflict_target))
            return RestResponse(200, [{"id": ids.get(table, f"{table}-id")}])

    transport = StableIdTransport()
    persistence_plan = plan("ikea")
    expected_product_reference = f"product:{persistence_plan.product_natural_key}"
    expected_variant_key = persistence_plan.variants[0].values["persistence_key"]
    expected_variant_reference = f"variant:{expected_product_reference}:{expected_variant_key}"
    report = run(SupabaseCatalogExecutor(transport, settings=settings(True), write_enabled=True).execute(persistence_plan, execution_requested=True))
    calls = [(table, values, conflict) for table, values, conflict in transport.calls if table != "catalog_countries"]
    calls_by_table = {table: values for table, values, _ in calls if table != "catalog_product_images"}
    image_calls = [values for table, values, _ in calls if table == "catalog_product_images"]

    assert report.write_succeeded
    assert None not in report.resolved_identifiers
    assert "null" not in report.resolved_identifiers
    assert calls_by_table["catalog_products"]["vendor_market_id"] == ids["catalog_vendor_markets"]
    assert calls_by_table["catalog_product_variants"]["product_id"] == ids["catalog_products"]
    assert calls_by_table["catalog_product_variants"]["persistence_key"] == expected_variant_key
    assert "id" not in calls_by_table["catalog_product_variants"]
    assert report.resolved_identifiers[expected_variant_reference] == ids["catalog_product_variants"]
    assert report.resolved_identifiers[expected_variant_reference] != ids["catalog_product_dimensions"]
    assert calls_by_table["catalog_product_dimensions"]["variant_id"] == ids["catalog_product_variants"]
    assert calls_by_table["catalog_current_offers"]["variant_id"] == ids["catalog_product_variants"]
    assert all(image["variant_id"] == ids["catalog_product_variants"] for image in image_calls)
    assert all(image["product_id"] == ids["catalog_products"] for image in image_calls)


def test_existing_product_and_variant_retry_use_ids_returned_by_postgrest():
    class ExistingRowTransport(FakeTransport):
        async def upsert(self, table: str, values: dict[str, object], conflict_target: str) -> RestResponse:
            self.calls.append((table, values, conflict_target))
            existing_ids = {
                "catalog_vendor_markets": "market-existing-id",
                "catalog_products": "product-existing-id",
                "catalog_product_variants": "variant-existing-id",
            }
            return RestResponse(200, [{"id": existing_ids.get(table, f"{table}-existing-child-id")}])

    transport = ExistingRowTransport()
    executor = SupabaseCatalogExecutor(transport, settings=settings(True), write_enabled=True)
    first = run(executor.execute(plan("ikea"), execution_requested=True))
    second = run(executor.execute(plan("ikea"), execution_requested=True))
    second_calls = transport.calls[len(transport.calls) // 2:]
    second_by_table = {table: values for table, values, _ in second_calls if table not in {"catalog_countries", "catalog_product_images"}}

    assert first.resolved_identifiers == second.resolved_identifiers
    assert second_by_table["catalog_product_variants"]["product_id"] == "product-existing-id"
    assert second_by_table["catalog_product_dimensions"]["variant_id"] == "variant-existing-id"
    assert second_by_table["catalog_current_offers"]["variant_id"] == "variant-existing-id"


def test_variant_response_without_returned_id_fails_and_skips_dependents():
    class MissingVariantIdTransport(FakeTransport):
        async def upsert(self, table: str, values: dict[str, object], conflict_target: str) -> RestResponse:
            self.calls.append((table, values, conflict_target))
            if table == "catalog_product_variants":
                return RestResponse(200, [])
            return RestResponse(200, [{"id": f"{table}-id"}])

    transport = MissingVariantIdTransport()
    persistence_plan = plan("ikea")
    expected_product_reference = f"product:{persistence_plan.product_natural_key}"
    expected_variant_reference = f"variant:{expected_product_reference}:{persistence_plan.variants[0].natural_key}"
    report = run(SupabaseCatalogExecutor(transport, settings=settings(True), write_enabled=True).execute(persistence_plan, execution_requested=True))

    assert {item["table"] for item in report.failed_operations} == {"catalog_product_variants"}
    assert {item["table"] for item in report.skipped_operations} >= {"catalog_product_dimensions", "catalog_current_offers", "catalog_product_images"}
    assert expected_variant_reference not in report.resolved_identifiers


def test_one_product_guard_blocks_multiple_generic_plans():
    reports = run(SupabaseCatalogExecutor(FakeTransport(), settings=settings(True), write_enabled=True).execute_many((plan("article"), plan("ikea")), execution_requested=True))

    assert all("product_limit_exceeded" in report.blocking_reasons for report in reports)


def test_required_offer_and_image_values_use_schema_compatible_defaults():
    known_availability_plan = plan("ikea")
    known_variant = known_availability_plan.variants[0]

    assert known_variant.offer is not None
    assert known_variant.offer["normalized_availability"] == "in_stock"
    assert all(image["image_role"] == "alternate" for image in known_variant.images)

    source_product = product("ikea")
    source_variant = source_product.variants[0]
    assert source_variant.current_offer is not None
    missing_offer = source_variant.current_offer.model_copy(update={
        "source_availability": None,
        "normalized_availability": None,
    })
    missing_availability_product = source_product.model_copy(update={
        "variants": [source_variant.model_copy(update={"current_offer": missing_offer})],
    })
    missing_availability_plan = build_persistence_plan(missing_availability_product)
    missing_variant = missing_availability_plan.variants[0]

    assert missing_variant.offer is not None
    assert missing_variant.offer["normalized_availability"] == "unknown"


def test_first_offer_has_no_history_and_still_upserts_current_offer():
    transport = FakeTransport()
    report = run(SupabaseCatalogExecutor(transport, settings=settings(True), write_enabled=True).execute(plan("ikea"), execution_requested=True))

    tables = [table for table, _, _ in transport.calls]
    assert report.write_succeeded
    assert "catalog_current_offers" in tables
    assert "catalog_price_history" not in tables
    assert "catalog_availability_history" not in tables


def test_identical_offer_refresh_has_no_history():
    transport = FakeTransport()
    executor = SupabaseCatalogExecutor(transport, settings=settings(True), write_enabled=True)
    first = run(executor.execute(plan("ikea"), execution_requested=True))
    variant_id = next(value for key, value in first.resolved_identifiers.items() if key.startswith("variant:"))
    transport.existing_offers[variant_id] = {
        "variant_id": variant_id,
        "currency": "USD", "vendor_list_price": None, "vendor_sale_price": 1199.0,
        "vendor_shipping_fee": None, "source_availability": "https://schema.org/InStock",
        "normalized_availability": "in_stock", "delivery_text": "US",
    }
    start = len(transport.calls)
    second = run(executor.execute(plan("ikea"), execution_requested=True))

    assert second.write_succeeded
    assert [table for table, _, _ in transport.calls[start:] if table.endswith("history")] == []
    assert any(table == "catalog_current_offers" and mode != "read" for table, _, mode in transport.calls[start:])


def test_price_change_appends_one_price_history_row():
    transport = FakeTransport()
    executor = SupabaseCatalogExecutor(transport, settings=settings(True), write_enabled=True)
    first = run(executor.execute(plan("ikea"), execution_requested=True))
    variant_id = next(value for key, value in first.resolved_identifiers.items() if key.startswith("variant:"))
    transport.existing_offers[variant_id] = {
        "variant_id": variant_id, "currency": "USD", "vendor_list_price": 1000.0,
        "vendor_sale_price": 1000.0, "vendor_shipping_fee": None,
        "source_availability": "https://schema.org/InStock", "normalized_availability": "in_stock", "delivery_text": "US",
    }
    start = len(transport.calls)
    second = run(executor.execute(plan("ikea"), execution_requested=True))
    appended = [(table, values) for table, values, mode in transport.calls[start:] if mode == "append"]

    assert second.write_succeeded
    assert [table for table, _ in appended] == ["catalog_price_history"]
    assert appended[0][1]["variant_id"] == variant_id
    assert appended[0][1]["vendor_sale_price"] == 1199.0


def test_availability_change_appends_one_availability_history_row():
    transport = FakeTransport()
    executor = SupabaseCatalogExecutor(transport, settings=settings(True), write_enabled=True)
    first = run(executor.execute(plan("ikea"), execution_requested=True))
    variant_id = next(value for key, value in first.resolved_identifiers.items() if key.startswith("variant:"))
    transport.existing_offers[variant_id] = {
        "variant_id": variant_id, "currency": "USD", "vendor_list_price": None,
        "vendor_sale_price": 1199.0, "vendor_shipping_fee": None,
        "source_availability": "https://schema.org/OutOfStock", "normalized_availability": "out_of_stock", "delivery_text": "US",
    }
    start = len(transport.calls)
    second = run(executor.execute(plan("ikea"), execution_requested=True))
    appended = [(table, values) for table, values, mode in transport.calls[start:] if mode == "append"]

    assert second.write_succeeded
    assert [table for table, _ in appended] == ["catalog_availability_history"]
    assert appended[0][1]["normalized_availability"] == "in_stock"


def test_simultaneous_price_and_availability_changes_append_one_row_each():
    transport = FakeTransport()
    executor = SupabaseCatalogExecutor(transport, settings=settings(True), write_enabled=True)
    first = run(executor.execute(plan("ikea"), execution_requested=True))
    variant_id = next(value for key, value in first.resolved_identifiers.items() if key.startswith("variant:"))
    transport.existing_offers[variant_id] = {
        "variant_id": variant_id, "currency": "CAD", "vendor_list_price": 1.0,
        "vendor_sale_price": 1.0, "vendor_shipping_fee": 1.0,
        "source_availability": "old", "normalized_availability": "out_of_stock", "delivery_text": "old",
    }
    start = len(transport.calls)
    second = run(executor.execute(plan("ikea"), execution_requested=True))
    appended_tables = [table for table, _, mode in transport.calls[start:] if mode == "append"]

    assert second.write_succeeded
    assert appended_tables == ["catalog_price_history", "catalog_availability_history"]
    assert any(table == "catalog_current_offers" and mode != "read" for table, _, mode in transport.calls[start:])


def test_failed_current_offer_read_is_reported_and_current_offer_is_not_upserted():
    transport = FakeTransport(fail_current_offer_read=True)
    report = run(SupabaseCatalogExecutor(transport, settings=settings(True), write_enabled=True).execute(plan("ikea"), execution_requested=True))

    assert any(item["reason"] == "current_offer_read_failed" for item in report.failed_operations)
    assert not any(table == "catalog_current_offers" and mode != "read" for table, _, mode in transport.calls)


def test_failed_history_insert_is_reported_but_current_offer_still_upserts():
    transport = FakeTransport(fail_table="catalog_price_history")
    executor = SupabaseCatalogExecutor(transport, settings=settings(True), write_enabled=True)
    first = run(executor.execute(plan("ikea"), execution_requested=True))
    variant_id = next(value for key, value in first.resolved_identifiers.items() if key.startswith("variant:"))
    transport.existing_offers[variant_id] = {
        "variant_id": variant_id, "currency": "USD", "vendor_list_price": 1.0,
        "vendor_sale_price": 1.0, "vendor_shipping_fee": None,
        "source_availability": "https://schema.org/InStock", "normalized_availability": "in_stock", "delivery_text": "US",
    }
    start = len(transport.calls)
    report = run(executor.execute(plan("ikea"), execution_requested=True))

    assert any(item["table"] == "catalog_price_history" for item in report.failed_operations)
    assert any(table == "catalog_current_offers" and mode != "read" for table, _, mode in transport.calls[start:])


def test_postgrest_errors_preserve_safe_database_diagnostics_without_secret():
    secret = "sb_secret_not_in_error_report"
    response = _response(httpx.Response(
        409,
        json={"code": "23502", "message": "null value violates not-null constraint", "details": "Row contains null.", "hint": "Provide a value."},
    ))
    transport = FakeTransport(fail_table="catalog_current_offers")
    transport.upsert = lambda table, values, conflict: asyncio.sleep(0, result=response) if table == "catalog_current_offers" else FakeTransport.upsert(transport, table, values, conflict)
    report = run(SupabaseCatalogExecutor(
        transport,
        settings=CrawlerSettings(CATALOG_ALLOW_WRITES=True, SUPABASE_SECRET_KEY=secret),
        write_enabled=True,
    ).execute(plan("ikea"), execution_requested=True))

    failure = next(item for item in report.failed_operations if item["table"] == "catalog_current_offers")
    assert failure["code"] == "23502"
    assert failure["details"] == "Row contains null."
    assert secret not in json.dumps(report.as_dict())


def test_canonical_furniture_type_resolves_to_uuid_for_product_write():
    transport = FakeTransport()
    persistence_plan = plan("article")

    assert persistence_plan.canonical_furniture_type_code == "sofa"

    report = run(
        SupabaseCatalogExecutor(
            transport,
            settings=settings(True),
            write_enabled=True,
        ).execute(
            persistence_plan,
            execution_requested=True,
        )
    )

    assert report.write_succeeded

    furniture_type_reference = "furniture_type:sofa"
    expected_furniture_type_id = "furniture-type-uuid-sofa"

    assert (
        report.resolved_identifiers[furniture_type_reference]
        == expected_furniture_type_id
    )

    product_call = next(
        call
        for call in transport.calls
        if call[0] == "catalog_products"
    )

    product_values = product_call[1]

    assert (
        product_values["furniture_type_id"]
        == expected_furniture_type_id
    )

    assert (
        product_values["furniture_type_id"]
        != furniture_type_reference
    )
