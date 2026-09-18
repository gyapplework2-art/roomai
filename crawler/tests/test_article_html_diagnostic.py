from pathlib import Path

from crawler.core.json_diagnostics import compact_preview, find_json_paths
from crawler.jobs.inspect_article_html import inspect_html


FIXTURE = Path(__file__).parent / "fixtures" / "article" / "diagnostic_source.html"


def test_local_diagnostic_reports_json_ld_and_application_json_without_network():
    report = inspect_html(FIXTURE.read_text())
    assert report["json_ld_scripts"] == 1
    assert report["application_json_scripts"][0]["id"] == "article-product-data"


def test_recursive_json_paths_find_structured_attributes_and_images():
    report = inspect_html(FIXTURE.read_text())
    paths = [match["path"] for match in report["structured_matches"]]
    assert any("image" in path for path in paths)
    assert any("sku" in path for path in paths)


def test_diagnostic_marks_description_keyword_as_unstructured_text_evidence():
    report = inspect_html(FIXTURE.read_text())
    assert "leather" in report["unstructured_text_evidence"]
    assert all("leather" not in match["path"].lower() for match in report["structured_matches"])


def test_preview_is_compact_and_json_walker_is_reusable():
    matches = find_json_paths({"product": {"gallery": ["https://example.com/image.jpg"]}}, ["gallery"])
    assert matches[0].path == "$.product.gallery"
    assert len(compact_preview("x" * 200)) == 160
