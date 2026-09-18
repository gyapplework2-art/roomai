"""Generic local HTML evidence inventory for vendor-source investigation."""

import json
from dataclasses import asdict
from html.parser import HTMLParser

from crawler.core.html_attributes import extract_labeled_attributes
from crawler.core.json_diagnostics import find_json_paths
from crawler.core.structured_data import extract_json_ld


class ScriptInventoryParser(HTMLParser):
    """Inventory script metadata and bodies from already-saved HTML only."""

    def __init__(self) -> None:
        super().__init__()
        self.scripts: list[dict[str, str | None]] = []
        self._current: dict[str, str | None] | None = None
        self._parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() != "script":
            return
        values = dict(attrs)
        self._current = {
            "type": values.get("type"),
            "id": values.get("id"),
            "name": values.get("name"),
            "data_product": values.get("data-product"),
        }
        self._parts = []

    def handle_data(self, data: str) -> None:
        if self._current is not None:
            self._parts.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() == "script" and self._current is not None:
            self._current["content"] = "".join(self._parts)
            self.scripts.append(self._current)
            self._current = None
            self._parts = []


def inspect_local_html(html: str, keywords: list[str]) -> dict[str, object]:
    """Report compact explicit source evidence without fetching or executing HTML."""
    inventory = ScriptInventoryParser()
    inventory.feed(html)
    inventory.close()
    json_ld = extract_json_ld(html)
    application_json = [script for script in inventory.scripts if script["type"] == "application/json"]
    structured_matches = []
    for extraction in json_ld:
        if extraction.data is not None:
            structured_matches.extend(asdict(match) | {"source": "json_ld"} for match in find_json_paths(extraction.data, keywords))
    for script in application_json:
        try:
            data = json.loads(script["content"] or "")
        except json.JSONDecodeError:
            continue
        structured_matches.extend(asdict(match) | {"source": "embedded_json"} for match in find_json_paths(data, keywords))
    labeled_attributes = [asdict(attribute) for attribute in extract_labeled_attributes(html)]
    image_candidates = [match for match in structured_matches if "image" in match["path"].lower() or "gallery" in match["path"].lower()]
    return {
        "json_ld_scripts": len(json_ld),
        "malformed_json_ld_scripts": sum(extraction.error is not None for extraction in json_ld),
        "application_json_scripts": [_metadata(script) for script in application_json],
        "script_inventory": [_metadata(script) for script in inventory.scripts],
        "structured_matches": structured_matches,
        "labeled_html_attributes": labeled_attributes,
        "candidate_image_paths": image_candidates,
        "unstructured_text_evidence": [keyword for keyword in keywords if keyword.lower() in html.lower()],
    }


def _metadata(script: dict[str, str | None]) -> dict[str, str | None]:
    return {key: value for key, value in script.items() if key != "content"}
