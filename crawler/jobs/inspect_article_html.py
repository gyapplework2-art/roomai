"""Inspect a manually downloaded Article HTML file without any network access."""

import argparse
import json
from dataclasses import asdict
from html.parser import HTMLParser
from pathlib import Path

from crawler.core.json_diagnostics import find_json_paths
from crawler.core.structured_data import extract_json_ld

KEYWORDS = ["color", "colour", "material", "upholstery", "leather", "fabric", "finish", "specification", "attribute", "gallery", "images", "variants", "sku2128"]


class ScriptInventoryParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.scripts: list[dict[str, str | None]] = []
        self._current: dict[str, str | None] | None = None
        self._parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() != "script":
            return
        values = dict(attrs)
        self._current = {"type": values.get("type"), "id": values.get("id"), "name": values.get("name"), "data_product": values.get("data-product")}
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


def inspect_html(html: str) -> dict[str, object]:
    """Produce a compact local diagnostic report; never fetches or executes source content."""
    inventory = ScriptInventoryParser()
    inventory.feed(html)
    inventory.close()
    json_ld = extract_json_ld(html)
    application_json = [script for script in inventory.scripts if script["type"] == "application/json"]
    structured_matches = []
    for extraction in json_ld:
        if extraction.data is not None:
            structured_matches.extend(asdict(match) for match in find_json_paths(extraction.data, KEYWORDS))
    for script in application_json:
        try:
            data = json.loads(script["content"] or "")
        except json.JSONDecodeError:
            continue
        structured_matches.extend(asdict(match) for match in find_json_paths(data, KEYWORDS))
    image_candidates = [match for match in structured_matches if "image" in match["path"].lower() or "gallery" in match["path"].lower()]
    text_matches = [keyword for keyword in KEYWORDS if keyword in html.lower()]
    return {
        "json_ld_scripts": len(json_ld),
        "malformed_json_ld_scripts": sum(extraction.error is not None for extraction in json_ld),
        "application_json_scripts": [{key: value for key, value in script.items() if key != "content"} for script in application_json],
        "script_inventory": [{key: value for key, value in script.items() if key != "content"} for script in inventory.scripts],
        "structured_matches": structured_matches,
        "candidate_image_paths": image_candidates,
        "unstructured_text_evidence": text_matches,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Inspect a local Article HTML source file without network access.")
    parser.add_argument("html_file", type=Path)
    args = parser.parse_args()
    print(json.dumps(inspect_html(args.html_file.read_text()), indent=2))


if __name__ == "__main__":
    main()
