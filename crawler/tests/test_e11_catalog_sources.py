from dataclasses import replace

import pytest

from crawler.core.e11_catalog_acquisition import build_e11_p0_acquisition_plan
from crawler.core.e11_catalog_coverage import build_e11_p0_coverage_report
from crawler.core.e11_catalog_targets import (
    E11CrawlerAcquisitionTarget,
    E11CrawlerAcquisitionTargets,
    select_e11_p0_crawler_targets,
)
from crawler.core.e11_catalog_sources import (
    E11SourcePlanningError,
    build_e11_source_selection_plan,
)
from crawler.discovery.source_map import ApprovedDiscoverySource, approved_sources_for_target
import crawler.core.e11_catalog_sources as e11_sources


def _active_targets():
    e11_2 = build_e11_p0_coverage_report([])
    e11_3 = build_e11_p0_acquisition_plan(e11_2)
    return select_e11_p0_crawler_targets(e11_3)


def _target(plan, furniture_type_code):
    return next(target for target in plan.targets if target.furniture_type_code == furniture_type_code)


def test_empty_e11_catalog_plans_all_five_types_and_explicit_zero_source_case():
    target_plan = _active_targets()
    plan = build_e11_source_selection_plan(target_plan)

    assert plan.dry_run is True
    assert tuple(target.furniture_type_code for target in plan.targets) == tuple(
        target.furniture_type_code for target in target_plan.targets
    )
    assert len(plan.targets) == 5
    accent_chair = _target(plan, "accent_chair")
    assert accent_chair.source_status == "no_eligible_source"
    assert accent_chair.eligible_sources == ()
    assert accent_chair.acquisition_reason == "products_and_variants_missing"

    for furniture_type_code in ("sofa", "sectional_sofa", "coffee_table", "area_rug"):
        assert _target(plan, furniture_type_code).source_status == "eligible_sources_available"


def test_multiple_approved_sources_preserve_registry_order(monkeypatch):
    source_plan = _active_targets()
    original = approved_sources_for_target("US", "sofa")[0]
    second = replace(
        original,
        source_category="sofas-secondary",
        source_url="https://www.article.com/browse/1/sofas-secondary",
    )
    registered = (second, original)
    monkeypatch.setattr(e11_sources, "approved_sources_for_target", lambda market, type_code: registered if (market, type_code) == ("US", "sofa") else ())

    plan = build_e11_source_selection_plan(source_plan)
    sofa = _target(plan, "sofa")

    assert [source.source_category for source in sofa.eligible_sources] == ["sofas-secondary", "sofas"]
    assert sofa.source_status == "eligible_sources_available"


def test_wrong_market_and_type_scope_are_not_selected():
    source_plan = _active_targets()
    sofa = _target(source_plan, "sofa")
    canada_target = replace(sofa, market_code="CA")
    plan = build_e11_source_selection_plan(E11CrawlerAcquisitionTargets((canada_target,)))
    assert plan.targets[0].source_status == "no_eligible_source"
    assert approved_sources_for_target("CA", "sofa") == ()
    assert approved_sources_for_target("US", "sofas") == ()


def test_only_active_e11_5_targets_are_carried_forward():
    active = _active_targets()
    sofa_only = E11CrawlerAcquisitionTargets((_target(active, "sofa"),))
    plan = build_e11_source_selection_plan(sofa_only)
    assert tuple(target.furniture_type_code for target in plan.targets) == ("sofa",)


def test_source_metadata_with_wrong_type_or_unsupported_vendor_is_excluded(monkeypatch):
    source_plan = _active_targets()
    approved = approved_sources_for_target("US", "sofa")[0]
    wrong_type = replace(approved, furniture_type_code="coffee_table")
    unsupported_vendor = replace(approved, vendor="ikea")
    monkeypatch.setattr(e11_sources, "approved_sources_for_target", lambda _market, _type: (wrong_type, unsupported_vendor))

    plan = build_e11_source_selection_plan(E11CrawlerAcquisitionTargets((_target(source_plan, "sofa"),)))
    assert plan.targets[0].source_status == "no_eligible_source"
    assert plan.targets[0].eligible_sources == ()


def test_invalid_configured_source_url_is_not_eligible(monkeypatch):
    approved = approved_sources_for_target("US", "sofa")[0]
    invalid = replace(approved, source_url="file:///catalog")
    monkeypatch.setattr(e11_sources, "approved_sources_for_target", lambda _market, _type: (invalid,))
    plan = build_e11_source_selection_plan(E11CrawlerAcquisitionTargets((_target(_active_targets(), "sofa"),)))
    assert plan.targets[0].source_status == "no_eligible_source"
    assert plan.targets[0].eligible_sources == ()


def test_e11_5_demand_fields_are_preserved_and_order_is_unchanged():
    targets = _active_targets()
    plan = build_e11_source_selection_plan(targets)
    assert [target.furniture_type_code for target in plan.targets] == [target.furniture_type_code for target in targets.targets]

    for source_target, planned_target in zip(targets.targets, plan.targets, strict=True):
        assert planned_target.market_code == source_target.market_code
        assert planned_target.furniture_type_code == source_target.furniture_type_code
        assert planned_target.missing_distinct_products == source_target.missing_distinct_products
        assert planned_target.missing_ready_variants == source_target.missing_ready_variants
        assert planned_target.acquisition_reason == source_target.acquisition_reason
        assert planned_target.discovery_candidate_limit == source_target.discovery_candidate_limit
        assert planned_target.planned_batch_count == source_target.planned_batch_count
        assert planned_target.per_batch_candidate_limits == source_target.per_batch_candidate_limits


def test_source_plan_is_deterministic_and_does_not_mutate_target_input():
    targets = _active_targets()
    snapshot = targets
    first = build_e11_source_selection_plan(targets)
    second = build_e11_source_selection_plan(targets)

    assert first == second
    assert first.as_dict() == second.as_dict()
    assert targets == snapshot
    assert all("unknown" not in source.vendor.lower() and "tbd" not in source.vendor.lower()
        for target in first.targets for source in target.eligible_sources)
    assert all(source.source_url.startswith(("http://", "https://"))
        for target in first.targets for source in target.eligible_sources)


def test_non_p0_target_fails_instead_of_expanding_the_e11_contract():
    target = _target(_active_targets(), "sofa")
    with pytest.raises(E11SourcePlanningError, match="E11_SOURCE_PLAN_NON_P0_TARGET"):
        build_e11_source_selection_plan(E11CrawlerAcquisitionTargets((replace(target, furniture_type_code="mirror"),)))


def test_configured_source_registry_has_no_accent_chair_source():
    assert approved_sources_for_target("US", "accent_chair") == ()
    plan = build_e11_source_selection_plan(_active_targets())
    accent_chair = _target(plan, "accent_chair")
    assert accent_chair.acquisition_reason == "products_and_variants_missing"
    assert accent_chair.source_status == "no_eligible_source"
