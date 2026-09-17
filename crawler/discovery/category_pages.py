"""Generic link extraction for explicitly fetched category or listing pages."""

from html.parser import HTMLParser
from urllib.parse import urljoin


class _LinkParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.links: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() != "a":
            return
        href = dict(attrs).get("href")
        if href:
            self.links.append(href)


def extract_links(html: str, source_page_url: str) -> list[str]:
    """Return absolute href values in source order without making network requests."""
    parser = _LinkParser()
    parser.feed(html)
    parser.close()
    return [urljoin(source_page_url, href) for href in parser.links]
