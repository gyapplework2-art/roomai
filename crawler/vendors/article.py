"""Article.com source-fact extraction pilot.

This adapter parses already-fetched public HTML. It is intentionally limited to
one supplied URL at a time and does not discover pages, bypass restrictions, or
normalize source values.
"""

from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from html.parser import HTMLParser
import json
import re
from typing import cast

from crawler.core.fetcher import FetchResult, HttpFetcher
from crawler.core.structured_data import StructuredProductFacts, extract_products
from crawler.core.url_semantics import configured_slug_evidence
from crawler.models.product import CatalogProduct, CatalogVariant, CurrentOffer, ProductDimensions, ProductImage
from crawler.vendors.base import BaseVendorAdapter

ARTICLE_VENDOR = "Article"
ARTICLE_US_MARKET = "US"
ProductSourceRecord = CatalogProduct
_ARTICLE_PRODUCT_PATH = re.compile(r"/product/(\d+)(?:/|$)")
_MEASUREMENT_TEXT = re.compile(r"^\s*(\d+(?:\.\d+)?)\s*([a-zA-Z]+)\s*$")
_COLOR_ATTRIBUTE_NAMES = frozenset({"color", "colour", "finish", "upholstery color", "fabric color", "leather color"})
_MATERIAL_ATTRIBUTE_NAMES = frozenset({"material", "upholstery", "upholstery material", "fabric", "leather"})
_NON_PRODUCT_IMAGE_ROLES = frozenset({"logo", "recommendation", "thumbnail"})
_URL_MATERIAL_TOKENS = {"leather", "fabric", "velvet"}
_URL_COLOR_PHRASES = {("charme", "tan"), ("cloud", "gray"), ("rain", "cloud", "gray")}
_ARTICLE_HTML_COLOR_LABELS = _COLOR_ATTRIBUTE_NAMES
_ARTICLE_HTML_MATERIAL_LABELS = _MATERIAL_ATTRIBUTE_NAMES | {"materials"}


class ArticleExtractionError(ValueError):
    """Raised when public source data cannot form a valid source product record."""


class _MetaParser(HTMLParser):
    """Minimal structured HTML fallback, deliberately independent of CSS classes."""

    def __init__(self) -> None:
        super().__init__()
        self.title: str | None = None
        self.description: str | None = None
        self.image: str | None = None
        self._in_title = False
        self._title_parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attributes = dict(attrs)
        if tag == "title":
            self._in_title = True
        if tag == "meta":
            key = attributes.get("property") or attributes.get("name")
            content = attributes.get("content")
            if key == "og:description" and content:
                self.description = content
            elif key == "description" and content and self.description is None:
                self.description = content
            elif key == "og:image" and content:
                self.image = content

    def handle_data(self, data: str) -> None:
        if self._in_title:
            self._title_parts.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag == "title":
            self._in_title = False
            title = "".join(self._title_parts).strip()
            self.title = title or None


class _ProductStateParser(HTMLParser):
    """Collect only scripts explicitly identified as product data."""

    def __init__(self) -> None:
        super().__init__()
        self.blocks: list[str] = []
        self._collecting = False
        self._parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attributes = dict(attrs)
        script_id = (attributes.get("id") or "").lower()
        data_product = (attributes.get("data-product") or "").lower()
        if tag == "script" and ("product" in script_id or data_product in {"true", "product"}):
            self._collecting = True
            self._parts = []

    def handle_data(self, data: str) -> None:
        if self._collecting:
            self._parts.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag == "script" and self._collecting:
            self.blocks.append("".join(self._parts))
            self._collecting = False
            self._parts = []


class _ArticleSpecificationsParser(HTMLParser):
    """Extract explicit Article specs-title/specs-value row pairs only."""

    def __init__(self) -> None:
        super().__init__()
        self.specifications: dict[str, str] = {}
        self._div_depth = 0
        self._row_depth: int | None = None
        self._title_depth: int | None = None
        self._value_depth: int | None = None
        self._title_parts: list[str] = []
        self._value_parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag != "div":
            return
        self._div_depth += 1
        classes = set((dict(attrs).get("class") or "").split())
        if self._row_depth is None and "specs-rows" in classes:
            self._row_depth = self._div_depth
            return
        if self._row_depth is not None and self._title_depth is None and "specs-title" in classes:
            self._title_depth = self._div_depth
            self._title_parts = []
        elif self._row_depth is not None and self._value_depth is None and "specs-value" in classes:
            self._value_depth = self._div_depth
            self._value_parts = []

    def handle_data(self, data: str) -> None:
        if self._title_depth is not None:
            self._title_parts.append(data)
        elif self._value_depth is not None:
            self._value_parts.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag != "div":
            return
        if self._title_depth == self._div_depth:
            self._title_depth = None
        if self._value_depth == self._div_depth:
            self._value_depth = None
        if self._row_depth == self._div_depth:
            label = " ".join("".join(self._title_parts).split())
            value = " ".join("".join(self._value_parts).split())
            if label and value:
                self.specifications[label] = value
            self._row_depth = None
            self._title_parts = []
            self._value_parts = []
        self._div_depth -= 1


def _article_html_specifications(html: str) -> dict[str, object]:
    parser = _ArticleSpecificationsParser()
    parser.feed(html)
    parser.close()
    return parser.specifications


def _text(value: object) -> str | None:
    return value.strip() if isinstance(value, str) and value.strip() else None


def _as_dicts(value: object) -> list[dict[str, object]]:
    if isinstance(value, dict):
        return [cast(dict[str, object], value)]
    if isinstance(value, list):
        return [cast(dict[str, object], item) for item in value if isinstance(item, dict)]
    return []


def _embedded_product_state(html: str) -> dict[str, object] | None:
    parser = _ProductStateParser()
    parser.feed(html)
    parser.close()
    for raw in parser.blocks:
        try:
            value = json.loads(raw)
        except json.JSONDecodeError:
            continue
        if not isinstance(value, dict):
            continue
        product = value.get("product")
        if isinstance(product, dict):
            return cast(dict[str, object], product)
        if any(key in value for key in ("attributes", "gallery", "images")):
            return cast(dict[str, object], value)
    return None


def _attribute_values(state: dict[str, object] | None) -> tuple[str | None, str | None, dict[str, object]]:
    if state is None:
        return None, None, {}
    color = None
    material = None
    preserved: dict[str, object] = {}
    for attribute in _as_dicts(state.get("attributes") or state.get("specifications")):
        label = _text(attribute.get("label") or attribute.get("name"))
        value = _text(attribute.get("value"))
        if not label or not value:
            continue
        preserved[label] = value
        normalized_label = label.lower()
        if normalized_label in _COLOR_ATTRIBUTE_NAMES and color is None:
            color = value
        if normalized_label in _MATERIAL_ATTRIBUTE_NAMES and material is None:
            material = value
    return color, material, preserved


def _html_attribute_values(specifications: dict[str, object]) -> tuple[str | None, str | None]:
    color = None
    material = None
    for label, value in specifications.items():
        if not isinstance(label, str) or not isinstance(value, str):
            continue
        normalized_label = label.strip().casefold().rstrip(":").strip()
        if normalized_label in _ARTICLE_HTML_COLOR_LABELS and color is None:
            color = value
        if normalized_label in _ARTICLE_HTML_MATERIAL_LABELS and material is None:
            material = value
    return color, material


def _article_page_id(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    match = _ARTICLE_PRODUCT_PATH.search(value)
    return match.group(1) if match else None


def _related_article_page_ids(value: object) -> list[str]:
    related_ids: list[str] = []
    for relationship in _as_dicts(value):
        page_id = _article_page_id(relationship.get("url"))
        if page_id:
            related_ids.append(page_id)
    return related_ids


def _images(value: object) -> list[ProductImage]:
    raw_images = value if isinstance(value, list) else [value]
    images: list[ProductImage] = []
    for sort_order, raw_image in enumerate(raw_images):
        if isinstance(raw_image, str) and raw_image.startswith(("http://", "https://")):
            images.append(ProductImage(source_url=raw_image, sort_order=sort_order))
        elif isinstance(raw_image, dict):
            url = _text(raw_image.get("url") or raw_image.get("contentUrl"))
            image_role = _text(raw_image.get("role") or raw_image.get("imageRole"))
            if url and url.startswith(("http://", "https://")) and image_role not in _NON_PRODUCT_IMAGE_ROLES:
                images.append(
                    ProductImage(
                        source_url=url,
                        image_role=image_role,
                        alt_text=_text(raw_image.get("caption") or raw_image.get("name")),
                        width_px=_integer(raw_image.get("width")),
                        height_px=_integer(raw_image.get("height")),
                        sort_order=sort_order,
                    )
                )
    return images


def _gallery_images(state: dict[str, object] | None) -> list[ProductImage]:
    if state is None:
        return []
    return _images(state.get("gallery") or state.get("images"))


def _unique_images(*image_groups: list[ProductImage]) -> list[ProductImage]:
    unique: list[ProductImage] = []
    seen_urls: set[str] = set()
    for image in (image for group in image_groups for image in group):
        if image.source_url in seen_urls:
            continue
        seen_urls.add(image.source_url)
        unique.append(image.model_copy(update={"sort_order": len(unique)}))
    return unique


def _integer(value: object) -> int | None:
    if isinstance(value, int) and not isinstance(value, bool):
        return value
    if isinstance(value, str) and value.isdigit():
        return int(value)
    return None


def _number(value: object) -> float | None:
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return float(value)
    if isinstance(value, str):
        try:
            return float(Decimal(value))
        except InvalidOperation:
            return None
    if isinstance(value, dict):
        return _number(value.get("value"))
    return None


def _unit(value: object) -> str | None:
    if isinstance(value, dict):
        return _text(value.get("unitText") or value.get("unitCode"))
    return None


def _dimension_detail(value: object) -> dict[str, float | str] | None:
    if isinstance(value, dict):
        numeric_value = _number(value)
        unit = _unit(value)
        if numeric_value is not None and unit:
            return {"value": numeric_value, "unit": unit}
    if isinstance(value, str):
        match = _MEASUREMENT_TEXT.fullmatch(value)
        if match:
            return {"value": float(Decimal(match.group(1))), "unit": match.group(2)}
    return None


def _dimension_text(node: dict[str, object]) -> str | None:
    parts: list[str] = []
    for name in ("width", "depth", "height", "weight"):
        value = node.get(name)
        if value is not None:
            parts.append(f"{name}: {value}")
    additional = _as_dicts(node.get("additionalProperty"))
    for property_value in additional:
        name = _text(property_value.get("name"))
        value = property_value.get("value")
        if name and value is not None:
            parts.append(f"{name}: {value}")
    return "; ".join(parts) or None


def _dimensions(node: dict[str, object]) -> ProductDimensions | None:
    values: dict[str, float | None] = {"width_cm": None, "depth_cm": None, "height_cm": None, "weight_kg": None}
    details: dict[str, object] = {}
    for source_name, target_name, accepted_units in (
        ("width", "width_cm", {"cm", "centimeter", "centimeters", "CMT"}),
        ("depth", "depth_cm", {"cm", "centimeter", "centimeters", "CMT"}),
        ("height", "height_cm", {"cm", "centimeter", "centimeters", "CMT"}),
        ("weight", "weight_kg", {"kg", "kilogram", "kilograms", "KGM"}),
    ):
        raw = node.get(source_name)
        detail = _dimension_detail(raw)
        if detail:
            details[source_name] = detail
        if raw is not None and _unit(raw) in accepted_units:
            values[target_name] = _number(raw)
    source_text = _dimension_text(node)
    if source_text is None and not details and not any(value is not None for value in values.values()):
        return None
    return ProductDimensions(source_dimension_text=source_text, dimension_details=details, **values)


def _offer(value: object, checked_at: datetime) -> CurrentOffer | None:
    offers = _as_dicts(value)
    if not offers:
        return None
    source = offers[0]
    currency = _text(source.get("priceCurrency"))
    if not currency:
        return None
    price = _number(source.get("price"))
    return CurrentOffer(
        currency=currency,
        vendor_list_price=_number(source.get("listPrice") or source.get("highPrice")),
        vendor_sale_price=price if price is not None else _number(source.get("lowPrice")),
        source_availability=_text(source.get("availability")),
        delivery_text=_text(source.get("deliveryLeadTime") or source.get("shippingDetails")),
        checked_at=checked_at,
    )


def _variant(
    node: dict[str, object],
    checked_at: datetime,
    state: dict[str, object] | None = None,
    html_specifications: dict[str, object] | None = None,
) -> CatalogVariant:
    state_color, state_material, state_attributes = _attribute_values(state)
    html_color, html_material = _html_attribute_values(html_specifications or {})
    return CatalogVariant(
        vendor_sku=_text(node.get("sku")),
        vendor_variant_id=_text(node.get("@id") or node.get("productID")),
        variant_name=_text(node.get("name")),
        source_color=_text(node.get("color")) or state_color or html_color,
        source_material=_text(node.get("material")) or state_material or html_material,
        configuration=_text(node.get("model") or node.get("additionalType")),
        seating_capacity=_integer(node.get("seatingCapacity")),
        variant_attributes={
            "source": node,
            "article_attributes": state_attributes,
            "article_html_specifications": html_specifications or {},
        },
        dimensions=_dimensions(node),
        images=_unique_images(_gallery_images(state), _images(node.get("image"))),
        current_offer=_offer(node.get("offers"), checked_at),
    )


class ArticleVendorAdapter(BaseVendorAdapter):
    """Parse publicly exposed Article source facts for the explicit US market."""

    def __init__(self, vendor_market_code: str = ARTICLE_US_MARKET) -> None:
        super().__init__(vendor_market_code)

    def discover_product_urls(self) -> tuple[str, ...]:
        """This pilot does not implement Article discovery."""
        return ()

    async def fetch_product(self, product_url: str, fetcher: HttpFetcher) -> ProductSourceRecord:
        """Fetch one explicitly supplied product URL using the generic fetcher."""
        result = await fetcher.fetch(product_url)
        if not result.succeeded or result.response_text is None:
            message = result.error.message if result.error else "No product HTML returned."
            raise ArticleExtractionError(f"Could not fetch product: {message}")
        return self.parse_product(result.response_text, result.final_url, result.fetched_at)

    def parse_product(
        self,
        source: str,
        product_url: str | None = None,
        fetched_at: datetime | None = None,
    ) -> ProductSourceRecord:
        """Map JSON-LD source facts to CatalogProduct without semantic normalization."""
        checked_at = fetched_at or datetime.now(timezone.utc)
        state = _embedded_product_state(source)
        products = extract_products(source)
        if products:
            return self._from_structured_product(products[0], product_url, checked_at, state, source)
        return self._from_html_fallback(source, product_url)

    def _from_structured_product(
        self,
        facts: StructuredProductFacts,
        requested_url: str | None,
        checked_at: datetime,
        state: dict[str, object] | None,
        html: str,
    ) -> ProductSourceRecord:
        source = facts.source
        name = facts.name
        product_url = facts.url or requested_url
        if not name or not product_url:
            raise ArticleExtractionError("Product structured data must include a name and URL.")
        html_specifications = _article_html_specifications(html)
        variant_nodes = _as_dicts(source.get("hasVariant"))
        variants = [_variant(node, checked_at, state, html_specifications) for node in variant_nodes]
        if not variants:
            variants = [_variant(source, checked_at, state, html_specifications)]
        url_evidence = configured_slug_evidence(
            product_url,
            material_tokens=_URL_MATERIAL_TOKENS,
            color_phrases=_URL_COLOR_PHRASES,
        )
        return CatalogProduct(
            vendor_market_code=self.vendor_market_code,
            vendor_product_id=facts.sku or facts.mpn,
            source_product_name=name,
            source_category=facts.category,
            source_product_type=_text(source.get("additionalType")),
            source_description=facts.description,
            source_features=[_text(item) for item in source.get("featureList", []) if _text(item)] if isinstance(source.get("featureList"), list) else [],
            product_url=product_url,
            source_payload={
                "vendor": ARTICLE_VENDOR,
                "json_ld": source,
                "brand": facts.brand,
                "article_page_id": _article_page_id(product_url),
                "related_products": source.get("isRelatedTo"),
                "related_article_page_ids": _related_article_page_ids(source.get("isRelatedTo")),
                "article_product_attributes": _attribute_values(state)[2],
                "article_html_specifications": html_specifications,
                "attribute_evidence": url_evidence,
            },
            variants=variants,
        )

    def _from_html_fallback(self, html: str, product_url: str | None) -> ProductSourceRecord:
        if not product_url:
            raise ArticleExtractionError("A product URL is required when structured data is unavailable.")
        parser = _MetaParser()
        parser.feed(html)
        parser.close()
        if not parser.title:
            raise ArticleExtractionError("No product JSON-LD or stable HTML title was found.")
        images = _images(parser.image)
        return CatalogProduct(
            vendor_market_code=self.vendor_market_code,
            source_product_name=parser.title,
            source_description=parser.description,
            product_url=product_url,
            source_payload={"vendor": ARTICLE_VENDOR, "html_fallback": True},
            variants=[CatalogVariant(images=images)] if images else [],
        )
