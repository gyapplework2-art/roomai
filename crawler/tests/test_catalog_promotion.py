from datetime import datetime, timezone
from decimal import Decimal

from crawler.core.catalog_promotion import PromotionReport, promote_catalog_variant
from crawler.core.config import CrawlerSettings
from crawler.core.supabase_repository import RestResponse


NOW = datetime(2026, 9, 19, tzinfo=timezone.utc)
VARIANT_ID = "variant-1"
PRODUCT_ID = "product-1"
MARKET_ID = "market-1"
TYPE_ID = "type-1"


class FakePromotionTransport:
    def __init__(self, *, offer=None, rules=None, fail=None, variant=None, product=None):
        self.variant = variant or {"id": VARIANT_ID, "product_id": PRODUCT_ID, "is_active": True, "publication_status": "staging"}
        self.product = product or {
            "id": PRODUCT_ID, "vendor_market_id": MARKET_ID, "furniture_type_id": TYPE_ID,
            "is_active": True, "needs_taxonomy_review": False, "publication_status": "staging",
        }
        self.market = {"id": MARKET_ID, "country_id": "country-1"}
        self.furniture_type = {"id": TYPE_ID, "category_id": "category-1"}
        self.offer = offer
        self.rules = rules if rules is not None else [self.rule()]
        self.fail = fail
        self.calls: list[tuple[str, dict[str, object]]] = []
        self.customer_prices: list[dict[str, object]] = []

    @staticmethod
    def rule(**overrides):
        return {
            "id": "rule-1", "country_id": None, "vendor_market_id": None,
            "category_id": None, "furniture_type_id": None, "product_id": None,
            "variant_id": None, "markup_type": "percentage", "markup_value": 10,
            "priority": 100, "is_active": True,
            "effective_from": "2026-01-01T00:00:00+00:00", "effective_to": None,
            **overrides,
        }

    def response(self, operation: str, data=None) -> RestResponse:
        if self.fail == operation:
            return RestResponse(500, [], f"{operation}_failed")
        return RestResponse(200, data or [])

    async def get_variant(self, variant_id: str) -> RestResponse:
        self.calls.append(("get_variant", {"id": variant_id}))
        return self.response("get_variant", [self.variant] if self.variant.get("id") == variant_id else [])

    async def get_product(self, product_id: str) -> RestResponse:
        self.calls.append(("get_product", {"id": product_id}))
        return self.response("get_product", [self.product] if self.product.get("id") == product_id else [])

    async def get_vendor_market(self, market_id: str) -> RestResponse:
        self.calls.append(("get_vendor_market", {"id": market_id}))
        return self.response("get_vendor_market", [self.market])

    async def get_furniture_type(self, furniture_type_id: str) -> RestResponse:
        self.calls.append(("get_furniture_type", {"id": furniture_type_id}))
        return self.response("get_furniture_type", [self.furniture_type])

    async def get_offer(self, variant_id: str) -> RestResponse:
        self.calls.append(("get_offer", {"variant_id": variant_id}))
        return self.response("get_offer", [self.offer] if self.offer else [])

    async def get_pricing_rules(self) -> RestResponse:
        self.calls.append(("get_pricing_rules", {}))
        return self.response("get_pricing_rules", self.rules)

    async def upsert_customer_price(self, values: dict[str, object]) -> RestResponse:
        self.calls.append(("upsert_customer_price", values))
        if self.fail == "upsert_customer_price":
            return RestResponse(500, [], "customer_price_failed")
        self.customer_prices.append(values)
        return RestResponse(200, [{"variant_id": VARIANT_ID}])

    async def publish_product(self, product_id: str) -> RestResponse:
        self.calls.append(("publish_product", {"id": product_id}))
        if self.fail == "publish_product":
            return RestResponse(500, [], "publish_product_failed")
        self.product["publication_status"] = "published"
        return RestResponse(200, [{"id": product_id}])

    async def publish_variant(self, variant_id: str) -> RestResponse:
        self.calls.append(("publish_variant", {"id": variant_id}))
        if self.fail == "publish_variant":
            return RestResponse(500, [], "publish_variant_failed")
        self.variant["publication_status"] = "published"
        return RestResponse(200, [{"id": variant_id}])


def run(coroutine):
    import asyncio
    return asyncio.run(coroutine)


def settings(allow: bool):
    return CrawlerSettings(CATALOG_ALLOW_WRITES=allow)


def offer(sale=90, listing=100, availability="in_stock"):
    return {
        "currency": "USD", "vendor_sale_price": sale, "vendor_list_price": listing,
        "vendor_shipping_fee": 8, "source_availability": availability,
        "normalized_availability": availability, "delivery_text": "US",
    }


def execute(transport, execute=True, allow=True):
    return run(promote_catalog_variant(
        VARIANT_ID, execution_requested=execute, transport=transport, settings=settings(allow), now=NOW,
    ))


def test_dry_run_and_write_guard_make_no_writes():
    transport = FakePromotionTransport(offer=offer())
    report = execute(transport, execute=False, allow=True)
    guarded = execute(FakePromotionTransport(offer=offer()), execute=True, allow=False)

    assert report.write_attempted is False
    assert report.write_succeeded is False
    assert not any(name.startswith(("upsert", "publish")) for name, _ in transport.calls)
    assert guarded.write_attempted is False


def test_sale_price_is_preferred_and_percentage_markup_is_calculated():
    transport = FakePromotionTransport(offer=offer(sale=90, listing=100))
    report = execute(transport)

    assert report.source_price_basis == 90
    assert report.calculated_markup_amount == 9
    assert report.roomai_selling_price == 99
    assert transport.customer_prices[0]["source_price_basis"] == 90.0


def test_list_price_fallback_fixed_amount_markup():
    transport = FakePromotionTransport(offer=offer(sale=None, listing=100), rules=[FakePromotionTransport.rule(markup_type="fixed_amount", markup_value=15)])
    report = execute(transport)

    assert report.source_price_basis == 100
    assert report.calculated_markup_amount == 15
    assert report.roomai_selling_price == 115


def test_zero_percent_rule_is_valid():
    report = execute(FakePromotionTransport(offer=offer(), rules=[FakePromotionTransport.rule(markup_value=0)]))

    assert report.calculated_markup_amount == 0
    assert report.roomai_selling_price == 90


def test_missing_offer_or_usable_source_price_blocks_publication():
    missing_offer = FakePromotionTransport(offer=None)
    no_price = FakePromotionTransport(offer=offer(sale=None, listing=None))

    missing_report = execute(missing_offer)
    no_price_report = execute(no_price)

    assert "current_offer_missing" in missing_report.blocking_reasons
    assert "usable_source_price_missing" in no_price_report.blocking_reasons
    assert not missing_offer.customer_prices
    assert not no_price.customer_prices


def test_taxonomy_review_unresolved_type_and_inactive_records_block():
    cases = (
        FakePromotionTransport(offer=offer(), product={"id": PRODUCT_ID, "vendor_market_id": MARKET_ID, "furniture_type_id": TYPE_ID, "is_active": True, "needs_taxonomy_review": True, "publication_status": "staging"}),
        FakePromotionTransport(offer=offer(), product={"id": PRODUCT_ID, "vendor_market_id": MARKET_ID, "furniture_type_id": None, "is_active": True, "needs_taxonomy_review": False, "publication_status": "staging"}),
        FakePromotionTransport(offer=offer(), product={"id": PRODUCT_ID, "vendor_market_id": MARKET_ID, "furniture_type_id": TYPE_ID, "is_active": False, "needs_taxonomy_review": False, "publication_status": "staging"}),
    )

    reports = [execute(case) for case in cases]
    assert "taxonomy_review_required" in reports[0].blocking_reasons
    assert "unresolved_furniture_type" in reports[1].blocking_reasons
    assert "inactive_product_or_variant" in reports[2].blocking_reasons
    assert all(not case.customer_prices for case in cases)


def test_no_applicable_rule_and_ambiguous_rule_fail_safely():
    no_rule = FakePromotionTransport(offer=offer(), rules=[])
    ambiguous = FakePromotionTransport(offer=offer(), rules=[FakePromotionTransport.rule(id="a"), FakePromotionTransport.rule(id="b")])

    no_rule_report = execute(no_rule)
    ambiguous_report = execute(ambiguous)

    assert "no_applicable_pricing_rule" in no_rule_report.blocking_reasons
    assert "ambiguous_pricing_rule" in ambiguous_report.blocking_reasons
    assert not no_rule.customer_prices
    assert not ambiguous.customer_prices


def test_specificity_then_lowest_priority_selects_deterministically():
    rules = [
        FakePromotionTransport.rule(id="generic", markup_value=1, priority=1),
        FakePromotionTransport.rule(id="specific", variant_id=VARIANT_ID, markup_value=20, priority=99),
        FakePromotionTransport.rule(id="specific-low-priority", variant_id=VARIANT_ID, markup_value=10, priority=5),
    ]
    transport = FakePromotionTransport(offer=offer(), rules=rules)
    report = execute(transport)

    assert report.selected_pricing_rule_id == "specific-low-priority"
    assert report.selected_markup_value == 10


def test_successful_execution_upserts_customer_price_then_publishes_both_rows():
    transport = FakePromotionTransport(offer=offer())
    report = execute(transport)
    names = [name for name, _ in transport.calls]

    assert report.write_succeeded
    assert names.index("upsert_customer_price") < names.index("publish_product") < names.index("publish_variant")
    assert report.resulting_product_publication_status == "published"
    assert report.resulting_variant_publication_status == "published"


def test_customer_price_or_publication_failure_is_reported_without_false_success():
    price_failure = FakePromotionTransport(offer=offer(), fail="upsert_customer_price")
    product_failure = FakePromotionTransport(offer=offer(), fail="publish_product")
    variant_failure = FakePromotionTransport(offer=offer(), fail="publish_variant")

    reports = [execute(item) for item in (price_failure, product_failure, variant_failure)]

    assert all(not report.write_succeeded for report in reports)
    assert any(item["table"] == "catalog_customer_prices" for item in reports[0].failed_operations)
    assert any(item["table"] == "catalog_products" for item in reports[1].failed_operations)
    assert any(item["table"] == "catalog_product_variants" for item in reports[2].failed_operations)
    assert not any(name == "publish_product" for name, _ in price_failure.calls)


def test_published_rerun_is_idempotent_and_source_rows_are_not_modified():
    transport = FakePromotionTransport(
        offer=offer(),
        variant={"id": VARIANT_ID, "product_id": PRODUCT_ID, "is_active": True, "publication_status": "published", "vendor_sku": "SKU"},
        product={"id": PRODUCT_ID, "vendor_market_id": MARKET_ID, "furniture_type_id": TYPE_ID, "is_active": True, "needs_taxonomy_review": False, "publication_status": "published", "source_product_name": "Source"},
    )
    original_variant = dict(transport.variant)
    original_product = dict(transport.product)
    report = execute(transport)

    assert report.write_succeeded
    assert transport.variant["vendor_sku"] == original_variant["vendor_sku"]
    assert transport.product["source_product_name"] == original_product["source_product_name"]
