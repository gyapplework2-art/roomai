from pathlib import Path

from crawler.jobs.inspect_ikea_html import inspect_ikea_html


FIXTURE = Path(__file__).parent / "fixtures" / "ikea" / "diagnostic_sofa.html"


def test_ikea_diagnostic_inspects_local_html_with_generic_evidence_sources():
    report = inspect_ikea_html(FIXTURE.read_text(), "https://example.com/us/en/p/fake-sofa-10512345/")

    assert report["vendor"] == "IKEA"
    assert report["vendor_market_code"] == "US"
    assert report["json_ld_scripts"] == 1
    assert report["application_json_scripts"][0]["id"] == "ikea-product-state"
    assert report["url_evidence"]["source"] == "vendor_url_slug"


def test_ikea_diagnostic_preserves_labeled_html_and_structured_json_provenance():
    report = inspect_ikea_html(FIXTURE.read_text())

    assert {item["label"]: item["value"] for item in report["labeled_html_attributes"]} == {
        "Material": "Full-grain leather", "Color": "Forest Green", "Weight": "45 kg", "Assembly": "Required"
    }
    assert any(item["source"] == "json_ld" and "sku" in item["path"] for item in report["structured_matches"])
    assert any(item["source"] == "embedded_json" and "gallery" in item["path"] for item in report["structured_matches"])


def test_ikea_diagnostic_keeps_missing_attributes_missing_and_prose_noncanonical():
    report = inspect_ikea_html('<script type="application/ld+json">{"@type":"Product","name":"Leather Sofa"}</script>')

    assert report["labeled_html_attributes"] == []
    assert "leather" in report["unstructured_text_evidence"]
    assert report["url_evidence"]["tokens"] == []
