import pytest

from crawler.core.measurements import parse_measurement_text


@pytest.mark.parametrize(
    ("source", "expected"),
    [
        ("7' 3\"", {"value": 87.0, "unit": "in"}),
        ("7 ' 3 \"", {"value": 87.0, "unit": "in"}),
        ("9' 2\"", {"value": 110.0, "unit": "in"}),
        ("7 ft 3 in", {"value": 87.0, "unit": "in"}),
        ("7 feet 3 inches", {"value": 87.0, "unit": "in"}),
    ],
)
def test_compound_feet_and_inches_return_total_inches(source: str, expected: dict[str, float | str]):
    assert parse_measurement_text(source) == expected


@pytest.mark.parametrize(
    ("source", "expected"),
    [
        ('90 in', {"value": 90.0, "unit": "in"}),
        ('3"', {"value": 3.0, "unit": "in"}),
        ("7 ft", {"value": 7.0, "unit": "ft"}),
        ('91 3/8 "', {"value": 91.375, "unit": "in"}),
        ("2.5 ft", {"value": 2.5, "unit": "ft"}),
    ],
)
def test_existing_single_unit_and_mixed_number_parsing_remains_supported(source: str, expected: dict[str, float | str]):
    assert parse_measurement_text(source) == expected


@pytest.mark.parametrize(
    "source",
    [
        "7'",
        "7 ft 12 in",
        "7 ft -3 in",
        "seven feet 3 inches",
        "7 feet 3 inches wide",
        "7 feet and 3 inches",
    ],
)
def test_malformed_or_ambiguous_compound_measurements_remain_unresolved(source: str):
    assert parse_measurement_text(source) is None