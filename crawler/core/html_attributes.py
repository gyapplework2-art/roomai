"""Generic extraction of explicit labeled HTML attributes without prose inference."""

from dataclasses import dataclass
from html.parser import HTMLParser


@dataclass(frozen=True)
class LabeledHtmlAttribute:
    label: str
    value: str
    source: str = "labeled_html"
    method: str = "deterministic"


class _AttributeParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.rows: list[tuple[str, str]] = []
        self._tag: str | None = None
        self._parts: list[str] = []
        self._pending_label: str | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in {"th", "td", "dt", "dd"}:
            self._tag = tag
            self._parts = []

    def handle_data(self, data: str) -> None:
        if self._tag:
            self._parts.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag != self._tag:
            return
        text = " ".join("".join(self._parts).split())
        if tag in {"th", "dt"}:
            self._pending_label = text or None
        elif tag in {"td", "dd"} and self._pending_label and text:
            self.rows.append((self._pending_label, text))
            self._pending_label = None
        self._tag = None
        self._parts = []


def extract_labeled_attributes(html: str) -> list[LabeledHtmlAttribute]:
    """Extract table and definition-list label/value pairs only."""
    parser = _AttributeParser()
    parser.feed(html)
    parser.close()
    return [LabeledHtmlAttribute(label, value) for label, value in parser.rows]


def map_labeled_attributes(
    attributes: list[LabeledHtmlAttribute], label_map: dict[str, str],
) -> dict[str, list[LabeledHtmlAttribute]]:
    """Map vendor-configured labels to concepts while retaining original labels and values."""
    mapped: dict[str, list[LabeledHtmlAttribute]] = {}
    for attribute in attributes:
        concept = label_map.get(attribute.label.strip().lower())
        if concept:
            mapped.setdefault(concept, []).append(attribute)
    return mapped
