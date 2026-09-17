"""Generic sitemap URL extraction for explicitly fetched XML documents."""

from xml.etree import ElementTree


def extract_sitemap_urls(xml: str) -> list[str]:
    """Extract ``<loc>`` values without fetching a sitemap or following nested maps."""
    try:
        root = ElementTree.fromstring(xml)
    except ElementTree.ParseError:
        return []
    return [element.text.strip() for element in root.iter() if element.tag.rsplit("}", 1)[-1] == "loc" and element.text and element.text.strip()]
