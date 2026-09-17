from pathlib import Path

from crawler.core.structured_data import extract_json_ld, extract_products


FIXTURE = Path(__file__).parent / "fixtures" / "product_json_ld.html"


def test_extracts_single_product_and_preserves_source_description():
    products = extract_products(FIXTURE.read_text())

    product = products[0]
    assert product.name == "Fictional Harbor Sofa"
    assert product.description == "Original source description. Keep every sentence exactly as supplied."
    assert product.source["color"] == "Oatmeal"
    assert product.source["material"] == "Performance Basketweave"


def test_extracts_multiple_blocks_graph_and_type_array():
    products = extract_products(FIXTURE.read_text())

    assert [product.name for product in products] == ["Fictional Harbor Sofa", "Graph Chair"]
    assert products[1].brand == "Mock Brand"
    assert products[1].image == "https://example.com/images/chair.jpg"


def test_malformed_json_ld_does_not_discard_valid_blocks():
    extractions = extract_json_ld(FIXTURE.read_text())

    assert len(extractions) == 3
    assert extractions[2].data is None
    assert extractions[2].error is not None
    assert len(extract_products(FIXTURE.read_text())) == 2


def test_product_offer_facts_are_preserved_without_customer_pricing():
    product = extract_products(FIXTURE.read_text())[0]

    offer = product.offers[0]
    assert offer["price"] == "1299.00"
    assert offer["priceCurrency"] == "USD"
    assert offer["seller"] == {"@type": "Organization", "name": "Mock Home"}
    assert "roomai_markup" not in offer
    assert "customer_price" not in offer


def test_aggregate_offer_and_array_images_are_preserved():
    products = extract_products(FIXTURE.read_text())

    assert products[0].image == ["https://example.com/images/harbor-1.jpg", "https://example.com/images/harbor-2.jpg"]
    assert products[1].offers[0]["lowPrice"] == "200"
    assert products[1].offers[0]["highPrice"] == "300"


def test_missing_optional_product_facts_are_allowed():
    products = extract_products('<script type="application/ld+json">{"@type":"Product","name":"Bare Product"}</script>')

    assert products[0].description is None
    assert products[0].offers == []
    assert products[0].brand is None
