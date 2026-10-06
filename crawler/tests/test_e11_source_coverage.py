from copy import deepcopy
from dataclasses import replace

import pytest

from crawler.core.catalog_coverage import E11_P0_MINIMUM_VIABLE_COVERAGE_PLAN
from crawler.core.e11_catalog_acquisition import build_e11_p0_acquisition_plan
from crawler.core.e11_catalog_coverage import build_e11_p0_coverage_report
from crawler.core.e11_catalog_sources import (
    E11SourceSelectionPlan,
    build_e11_source_selection_plan,
)
from crawler.core.e11_catalog_targets import (
    E11CrawlerAcquisitionTargets,
    select_e11_p0_crawler_targets,
)
from crawler.core.e11_source_coverage import (
    E11SourceCoverageError,
    build_e11_source_coverage_gate,
)
import crawler.core.e11_catalog_sources as e11_sources


def _source_plan():
    coverage = build_e11_p0_coverage_report([])
    acquisition = build_e11_p0_acquisition_plan(coverage)
    targets = select_e11_p0_crawler_targets(acquisition)
    return build_e11_source_selection_plan(targets)


def _target(plan, furniture_type_code):
    return next(target for target in plan.targets if target.furniture_type_code == furniture_type_code)


def test_empty_active_target_plan_passes_gate_without_onboarding():
    report = build_e11_source_coverage_gate(E11SourceSelectionPlan(dry_run=True, targets=()))
    assert report.targets == ()
    assert report.active_target_count == 0
    assert report.source_ready_target_count == 0
    assert report.source_blocked_target_count == 0
    assert report.all_active_targets_source_ready is True
    assert report.as_dict()["summary"]["all_active_targets_source_ready"] is True


def test_eligible_active_target_is_source_ready_and_preserves_sources_and_demand():
    source_plan = _source_plan()
    sofa_source = _target(source_plan, "sofa")
    input_snapshot = deepcopy(source_plan)
    report = build_e11_source_coverage_gate(E11SourceSelectionPlan(True, (sofa_source,)))
    sofa = report.targets[0]

    assert sofa.furniture_type_code == "sofa"
    assert sofa.source_coverage_met is True
    assert sofa.onboarding_required is False
    assert sofa.source_coverage_status == "source_ready"
    assert sofa.onboarding_reason is None
    assert sofa.eligible_sources == sofa_source.eligible_sources
    assert sofa.missing_distinct_products == sofa_source.missing_distinct_products
    assert sofa.missing_ready_variants == sofa_source.missing_ready_variants
    assert sofa.acquisition_reason == sofa_source.acquisition_reason
    assert sofa.discovery_candidate_limit == sofa_source.discovery_candidate_limit
    assert sofa.planned_batch_count == sofa_source.planned_batch_count
    assert sofa.per_batch_candidate_limits == sofa_source.per_batch_candidate_limits
    assert source_plan == input_snapshot


def test_zero_source_target_remains_present_and_requires_explicit_onboarding():
    source_plan = _source_plan()
    accent = _target(source_plan, "accent_chair")
    report = build_e11_source_coverage_gate(E11SourceSelectionPlan(True, (accent,)))
    blocked = report.targets[0]

    assert blocked.furniture_type_code == "accent_chair"
    assert blocked.missing_distinct_products == 3
    assert blocked.missing_ready_variants == 4
    assert blocked.source_coverage_met is False
    assert blocked.onboarding_required is True
    assert blocked.source_coverage_status == "source_onboarding_required"
    assert blocked.onboarding_reason == "no_eligible_approved_source"
    assert blocked.eligible_sources == ()
    assert "vendor" not in blocked.__dict__
    assert "source_url" not in blocked.__dict__
    assert report.all_active_targets_source_ready is False


def test_mixed_p0_source_gate_keeps_eligible_types_ready_and_accent_chair_blocked():
    report = build_e11_source_coverage_gate(_source_plan())

    assert report.active_target_count == 5
    assert report.source_ready_target_count == 4
    assert report.source_blocked_target_count == 1
    assert report.all_active_targets_source_ready is False
    assert [_target(report, code).source_coverage_met for code in (
        "sofa", "sectional_sofa", "coffee_table", "area_rug",
    )] == [True, True, True, True]
    assert _target(report, "accent_chair").onboarding_reason == "no_eligible_approved_source"


def test_only_the_supplied_active_subset_is_gated():
    source_plan = _source_plan()
    subset = E11SourceSelectionPlan(True, (
        _target(source_plan, "sofa"),
        _target(source_plan, "accent_chair"),
    ))
    report = build_e11_source_coverage_gate(subset)

    assert [target.furniture_type_code for target in report.targets] == ["sofa", "accent_chair"]
    assert report.active_target_count == 2
    assert report.source_ready_target_count == 1
    assert report.source_blocked_target_count == 1


def test_source_records_and_target_order_are_preserved():
    source_plan = _source_plan()
    report = build_e11_source_coverage_gate(source_plan)

    assert [target.furniture_type_code for target in report.targets] == [
        target.furniture_type_code for target in source_plan.targets
    ]
    for original, planned in zip(source_plan.targets, report.targets, strict=True):
        assert planned.eligible_sources == original.eligible_sources


def test_gate_is_deterministic_and_does_not_query_source_registry(monkeypatch):
    plan = _source_plan()
    snapshot = deepcopy(plan)

    def forbidden_registry_call(*_args, **_kwargs):
        raise AssertionError("E.11.7 must trust the E.11.6 plan")

    monkeypatch.setattr(e11_sources, "approved_sources_for_target", forbidden_registry_call)
    first = build_e11_source_coverage_gate(plan)
    second = build_e11_source_coverage_gate(plan)

    assert first == second
    assert first.as_dict() == second.as_dict()
    assert plan == snapshot


def test_inconsistent_source_status_and_source_list_fails_fast():
    plan = _source_plan()
    sofa = _target(plan, "sofa")
    mismatched = replace(sofa, source_status="no_eligible_source")
    with pytest.raises(E11SourceCoverageError, match="E11_SOURCE_COVERAGE_STATUS_SOURCE_MISMATCH"):
        build_e11_source_coverage_gate(E11SourceSelectionPlan(True, (mismatched,)))

    accent = _target(plan, "accent_chair")
    fake = replace(sofa.eligible_sources[0], market_code="CA", vendor_market_code="CA")
    mismatched_scope = replace(accent, source_status="eligible_sources_available", eligible_sources=(fake,))
    with pytest.raises(E11SourceCoverageError, match="E11_SOURCE_COVERAGE_SOURCE_SCOPE_MISMATCH"):
        build_e11_source_coverage_gate(E11SourceSelectionPlan(True, (mismatched_scope,)))


def test_non_p0_or_duplicate_targets_fail_fast():
    plan = _source_plan()
    sofa = _target(plan, "sofa")
    non_p0 = replace(sofa, furniture_type_code="mirror")
    with pytest.raises(E11SourceCoverageError, match="E11_SOURCE_COVERAGE_NON_P0_TARGET"):
        build_e11_source_coverage_gate(E11SourceSelectionPlan(True, (non_p0,)))
    with pytest.raises(E11SourceCoverageError, match="E11_SOURCE_COVERAGE_DUPLICATE_TARGET"):
        build_e11_source_coverage_gate(E11SourceSelectionPlan(True, (sofa, sofa)))


def test_non_dry_run_source_plan_is_rejected():
    plan = _source_plan()
    not_dry_run = E11SourceSelectionPlan(False, plan.targets)
    with pytest.raises(E11SourceCoverageError, match="E11_SOURCE_COVERAGE_REQUIRES_DRY_RUN_PLAN"):
        build_e11_source_coverage_gate(not_dry_run)
