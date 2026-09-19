"""Generic parsing of explicitly supplied source measurement text."""

from decimal import Decimal, InvalidOperation
import re

_MEASUREMENT = re.compile(
    r"^\s*(?:(\d+)\s+)?(\d+(?:\.\d+)?)(?:/(\d+))?\s*(?:\"|([a-zA-Z]+))\s*$"
)
_COMPOUND_FEET_INCHES = re.compile(
    r"^\s*(\d+(?:\.\d+)?)\s*(?:'|ft|feet)\s+(\d+(?:\.\d+)?)\s*(?:\"|in|inches)\s*$",
    re.IGNORECASE,
)


def parse_measurement_text(value: str) -> dict[str, float | str] | None:
    """Parse explicit whole, decimal, or mixed-number measurements without conversion."""
    compound = _COMPOUND_FEET_INCHES.fullmatch(value)
    if compound is not None:
        try:
            feet = Decimal(compound.group(1))
            inches = Decimal(compound.group(2))
        except (InvalidOperation, ValueError):
            return None
        if inches >= 12:
            return None
        return {"value": float(feet * 12 + inches), "unit": "in"}

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
