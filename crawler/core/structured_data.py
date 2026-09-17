"""Future structured-data extraction boundary."""

from collections.abc import Mapping


def extract_product_data(document: str) -> Mapping[str, object]:
    """Reserve structured-data extraction without interpreting retailer pages."""
    raise NotImplementedError("Structured-data extraction is not implemented yet.")
