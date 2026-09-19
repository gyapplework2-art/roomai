from pathlib import Path

from crawler.core.html_attributes import extract_labeled_attributes, map_labeled_attributes
from crawler.core.evidence_resolution import resolve_attribute, variant_attribute_candidates
from crawler.core.url_semantics import configured_slug_evidence, product_slug, slug_tokens


FIXTURE = Path(__file__).parent / "fixtures" / "labeled_attributes.html"


def test_labeled_html_preserves_table_and_definition_list_labels_and_values():
    attributes = extract_labeled_attributes(FIXTURE.read_text())

    assert [(attribute.label, attribute.value, attribute.source) for attribute in attributes] == [
        ("Material", "Full-grain leather", "labeled_html"),
        ("Color", "Forest Green", "labeled_html"),
        ("Upholstery", "Performance Velvet", "labeled_html"),
        ("Frame Material", "Solid wood", "labeled_html"),
    ]


def test_vendor_configuration_maps_explicit_labels_without_prose_inference():
    attributes = extract_labeled_attributes(FIXTURE.read_text())
    mapped = map_labeled_attributes(attributes, {"material": "material", "color": "color", "upholstery": "material"})

    assert [attribute.value for attribute in mapped["material"]] == ["Full-grain leather", "Performance Velvet"]
    assert [attribute.value for attribute in mapped["color"]] == ["Forest Green"]
    assert "comfortable" not in mapped


def test_configured_url_evidence_preserves_slug_and_only_matches_known_vendor_terms():
    url = "https://example.com/product/30333/timber-90-leather-sofa-charme-tan"
    evidence = configured_slug_evidence(url, material_tokens={"leather"}, color_phrases={("charme", "tan")})

    assert product_slug(url) == "timber-90-leather-sofa-charme-tan"
    assert slug_tokens(url) == ("timber", "90", "leather", "sofa", "charme", "tan")
    assert evidence == {
        "material": [{"value": "leather", "source": "vendor_url_slug", "method": "deterministic"}],
        "color": [{"value": "charme tan", "source": "vendor_url_slug", "method": "deterministic"}],
    }


def test_unconfigured_url_tokens_do_not_become_attribute_evidence():
    assert configured_slug_evidence(
        "https://example.com/product/1/mystery-sofa-sunset",
        material_tokens={"leather"},
        color_phrases={("charme", "tan")},
    ) == {}


def test_upholstery_color_is_labeled_html_color_evidence():
    candidates = variant_attribute_candidates(
        None,
        None,
        {"article_html_specifications": {"Upholstery Color": "Charme Tan"}},
        {},
    )

    assert len(candidates["color"]) == 1
    candidate = candidates["color"][0]
    assert candidate.value == "Charme Tan"
    assert candidate.source == "labeled_html"
    assert candidate.priority == 3


def test_labeled_upholstery_color_beats_matching_url_evidence_and_preserves_both_candidates():
    candidates = variant_attribute_candidates(
        None,
        None,
        {"article_html_specifications": {"Upholstery Color": "Charme Tan"}},
        {"color": [{"value": "charme tan", "source": "vendor_url_slug", "method": "deterministic"}]},
    )
    resolved = resolve_attribute(candidates["color"])

    assert resolved.selected is not None
    assert resolved.selected.value == "Charme Tan"
    assert resolved.selected.source == "labeled_html"
    assert [candidate.value for candidate in resolved.candidates] == ["Charme Tan", "charme tan"]
    assert [candidate.source for candidate in resolved.candidates] == ["labeled_html", "vendor_url_slug"]
