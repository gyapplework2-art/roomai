import pytest

from crawler.core.design_attributes import (
    ATTRIBUTE_DEFINITIONS,
    FURNITURE_TYPE_ATTRIBUTES,
    applicable_attributes,
    get_attribute_definition,
    is_attribute_applicable,
)
from crawler.core.taxonomy import CANONICAL_TYPES


def test_all_canonical_furniture_types_have_applicability_entries():
    assert set(FURNITURE_TYPE_ATTRIBUTES) == CANONICAL_TYPES
    assert len(FURNITURE_TYPE_ATTRIBUTES) == 28


def test_every_applicable_attribute_is_defined():
    referenced = {
        attribute
        for attributes in FURNITURE_TYPE_ATTRIBUTES.values()
        for attribute in attributes
    }

    assert referenced <= set(ATTRIBUTE_DEFINITIONS)


@pytest.mark.parametrize(
    ("attribute_name", "value_type"),
    [
        ("shape", "string"),
        ("assembly_required", "boolean"),
        ("drawer_count", "integer"),
        ("seat_height", "measurement"),
        ("seat_depth", "measurement"),
        ("pile_height", "measurement"),
        ("bulb_count", "integer"),
        ("dimmable", "boolean"),
        ("upholstery", "string"),
    ],
)
def test_attribute_value_types_are_registered(attribute_name: str, value_type: str):
    definition = get_attribute_definition(attribute_name)

    assert definition is not None
    assert definition.name == attribute_name
    assert definition.value_type == value_type


def test_sofa_applicability_includes_upholstery_but_not_lighting():
    assert is_attribute_applicable("sofa", "upholstery")
    assert is_attribute_applicable("sofa", "assembly_required")
    assert not is_attribute_applicable("sofa", "bulb_base")
    assert not is_attribute_applicable("sofa", "dimmable")
    assert is_attribute_applicable("sofa", "seat_height")
    assert is_attribute_applicable("sofa", "seat_depth")


def test_seat_measurements_are_not_applicable_to_area_rugs():
    assert not is_attribute_applicable("area_rug", "seat_height")
    assert not is_attribute_applicable("area_rug", "seat_depth")


def test_dining_table_applicability_includes_table_concepts_not_cushion_fill():
    assert is_attribute_applicable("dining_table", "shape")
    assert is_attribute_applicable("dining_table", "extendable")
    assert not is_attribute_applicable("dining_table", "cushion_fill")


def test_area_rug_applicability_includes_rug_concepts_not_storage_counts():
    assert is_attribute_applicable("area_rug", "pile_height")
    assert is_attribute_applicable("area_rug", "pattern")
    assert not is_attribute_applicable("area_rug", "drawer_count")


def test_floor_lamp_applicability_includes_lighting_concepts_not_upholstery():
    assert is_attribute_applicable("floor_lamp", "bulb_base")
    assert is_attribute_applicable("floor_lamp", "dimmable")
    assert not is_attribute_applicable("floor_lamp", "upholstery")


def test_bed_frame_applicability_includes_bed_size_not_lighting():
    assert is_attribute_applicable("bed_frame", "bed_size")
    assert is_attribute_applicable("bed_frame", "platform_slat_type")
    assert not is_attribute_applicable("bed_frame", "bulb_base")


def test_mirror_applicability_includes_shape_and_frame_attributes():
    attributes = applicable_attributes("mirror")

    assert "shape" in attributes
    assert "frame_material" in attributes
    assert "frame_finish" in attributes
    assert "wall_mountable" in attributes


def test_unknown_applicability_queries_are_safe():
    assert applicable_attributes("unknown_type") == ()
    assert applicable_attributes(None) == ()
    assert is_attribute_applicable("unknown_type", "shape") is False
    assert is_attribute_applicable("sofa", "unknown_attribute") is False
    assert get_attribute_definition("unknown_attribute") is None
