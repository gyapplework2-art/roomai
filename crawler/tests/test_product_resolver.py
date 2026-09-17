from crawler.core.product_resolver import propose_resolution
from crawler.models.product import CatalogProduct


def product(name: str, sku: str, page_id: str, related_ids: list[str], market: str = "US") -> CatalogProduct:
    return CatalogProduct(vendor_market_code=market, vendor_product_id=sku, source_product_name=name, product_url=f"https://example.com/article/product/{page_id}/sofa", source_payload={"vendor": "Article", "article_page_id": page_id, "related_article_page_ids": related_ids})


def test_article_identity_remains_distinct_from_sku():
    record = product("Timber 90 Leather Sofa - Charme Black", "SKU16852", "24155", ["24154", "30332", "30333"])
    assert record.source_payload["article_page_id"] != record.vendor_product_id


def test_related_evidence_is_conservative_and_records_are_not_mutated():
    left = product("Timber 90 Leather Sofa - Charme Black", "SKU16852", "24155", ["24154", "30332", "30333"])
    right = product("Timber 90 Leather Sofa - Charme Tan", "SKU2128", "30333", [])
    proposal = propose_resolution(left, right)
    assert proposal.relationship_type == "related_only"
    assert proposal.requires_review
    assert any(item.code == "vendor_related_product" for item in proposal.evidence)
    assert left.source_payload["related_article_page_ids"] == ["24154", "30332", "30333"]


def test_similar_names_and_different_markets_do_not_merge():
    left = product("Timber 90 Sofa - Rain Cloud Gray", "SKU343", "22570", ["22557", "22571"], "US")
    right = product("Timber 90 Sofa - Rain Cloud Gray", "SKU999", "22570", [], "CA")
    proposal = propose_resolution(left, right)
    assert proposal.relationship_type == "insufficient_evidence"
    assert proposal.requires_review
    assert all("family" not in item.code for item in proposal.evidence)
