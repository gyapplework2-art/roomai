"""Generic source-image extraction for JSON-LD string and ImageObject values."""

from typing import cast

from crawler.models.product import ProductImage


def extract_source_images(value: object) -> list[ProductImage]:
    """Extract HTTP(S) image metadata in source order without URL heuristics."""
    raw_images = value if isinstance(value, list) else [value]
    images: list[ProductImage] = []
    seen_urls: set[str] = set()
    for item in raw_images:
        if isinstance(item, str):
            url = item
            details: dict[str, object] = {}
        elif isinstance(item, dict):
            details = cast(dict[str, object], item)
            url = details.get("url") or details.get("contentUrl")
        else:
            continue
        if not isinstance(url, str) or not url.startswith(("http://", "https://")) or url in seen_urls:
            continue
        seen_urls.add(url)
        images.append(ProductImage(
            source_url=url,
            image_role=details.get("role") if isinstance(details.get("role"), str) else None,
            alt_text=details.get("caption") if isinstance(details.get("caption"), str) else details.get("name") if isinstance(details.get("name"), str) else None,
            width_px=_integer(details.get("width")),
            height_px=_integer(details.get("height")),
            sort_order=len(images),
        ))
    return images


def _integer(value: object) -> int | None:
    if isinstance(value, int) and not isinstance(value, bool):
        return value
    if isinstance(value, str) and value.isdigit():
        return int(value)
    return None
