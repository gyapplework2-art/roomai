"""Inspect a manually saved IKEA US HTML file without network access."""

import argparse
import json
from pathlib import Path

from crawler.core.html_diagnostics import inspect_local_html
from crawler.core.url_semantics import product_slug, slug_tokens

IKEA_KEYWORDS = [
    "product", "article", "sku", "name", "category", "description", "price",
    "currency", "availability", "color", "colour", "material", "upholstery",
    "leather", "fabric", "finish", "width", "depth", "height", "weight",
    "gallery", "images", "variant", "delivery", "shipping", "specification",
    "attribute", "assembly", "care", "cushion", "frame", "leg",
]


def inspect_ikea_html(html: str, source_url: str | None = None) -> dict[str, object]:
    """Produce local diagnostic evidence only; this is not IKEA extraction."""
    report = inspect_local_html(html, IKEA_KEYWORDS)
    report["vendor"] = "IKEA"
    report["vendor_market_code"] = "US"
    report["url_evidence"] = {
        "source_url": source_url,
        "slug": product_slug(source_url) if source_url else None,
        "tokens": list(slug_tokens(source_url)) if source_url else [],
        "source": "vendor_url_slug" if source_url else None,
        "method": "deterministic" if source_url else None,
        "note": "URL tokens are evidence only and are not canonical product attributes.",
    }
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description="Inspect a local IKEA HTML file without network access.")
    parser.add_argument("html_file", type=Path)
    parser.add_argument("--source-url", help="Optional original IKEA URL for lower-priority URL evidence.")
    args = parser.parse_args()
    print(json.dumps(inspect_ikea_html(args.html_file.read_text(), args.source_url), indent=2))


if __name__ == "__main__":
    main()
