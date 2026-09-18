"""Generic parsing of explicitly supplied source measurement text."""

from decimal import Decimal, InvalidOperation
import re

_MEASUREMENT = re.compile(
    r"^\s*(?:(\d+)\s+)?(\d+(?:\.\d+)?)(?:/(\d+))?\s*(?:\"|([a-zA-Z]+))\s*$"
)


def parse_measurement_text(value: str) -> dict[str, float | str] | None:
    """Parse explicit whole, decimal, or mixed-number measurements without conversion."""
    match = _MEASUREMENT.fullmatch(value)
    if match is None:
        return None
    whole, numerator, denominator, unit = match.groups()
    try:
        number = Decimal(whole or "0") + Decimal(numerator)
        if denominator:
            number += Decimal(numerator) / Decimal(denominator) - Decimal(numerator)
    except (InvalidOperation, ZeroDivisionError):
        return None
    return {"value": float(number), "unit": "in" if value.strip().endswith('"') else unit.lower()}
