from crawler.core.catalog_coverage import (
    CoverageTarget,
    build_coverage_plan,
    build_coverage_report,
)
from crawler.core.catalog_expansion import select_actionable_expansion_targets


def make_report():
    plan = build_coverage_plan(
        [
            CoverageTarget("US", "accent_chair", 30, "critical"),
            CoverageTarget("US", "bed_frame", 30, "critical"),
            CoverageTarget("US", "coffee_table", 30, "critical"),
            CoverageTarget("US", "desk", 30, "critical"),
            CoverageTarget("US", "sectional_sofa", 30, "critical"),
            CoverageTarget("US", "sofa", 30, "critical"),
        ]
    )

    return build_coverage_report(
        plan,
        {
            ("US", "accent_chair"): 0,
            ("US", "bed_frame"): 0,
            ("US", "coffee_table"): 0,
            ("US", "desk"): 0,
            ("US", "sectional_sofa"): 1,
            ("US", "sofa"): 3,
        },
    )


def test_actionable_targets_skip_targets_without_approved_source():
    selected = select_actionable_expansion_targets(make_report())

    assert [
        row.coverage.furniture_type_code
        for row in selected
    ] == [
        "bed_frame",
        "coffee_table",
        "desk",
        "sectional_sofa",
        "sofa",
    ]


def test_actionable_target_carries_approved_source():
    selected = select_actionable_expansion_targets(
        make_report(),
        limit=1,
    )

    assert len(selected) == 1

    row = selected[0]

    assert row.coverage.furniture_type_code == "bed_frame"
    assert row.source.market_code == "US"
    assert row.source.furniture_type_code == "bed_frame"
    assert row.source.vendor == "article"
    assert row.source.source_category == "beds"


def test_actionable_target_limit_applies_after_unsupported_targets_are_skipped():
    selected = select_actionable_expansion_targets(
        make_report(),
        limit=2,
    )

    assert [
        row.coverage.furniture_type_code
        for row in selected
    ] == [
        "bed_frame",
        "coffee_table",
    ]


def test_met_target_is_not_actionable():
    plan = build_coverage_plan(
        [
            CoverageTarget("US", "bed_frame", 2, "critical"),
            CoverageTarget("US", "coffee_table", 2, "critical"),
        ]
    )

    report = build_coverage_report(
        plan,
        {
            ("US", "bed_frame"): 2,
            ("US", "coffee_table"): 0,
        },
    )

    selected = select_actionable_expansion_targets(report)

    assert [
        row.coverage.furniture_type_code
        for row in selected
    ] == ["coffee_table"]


def test_actionable_target_limit_must_be_positive():
    report = make_report()

    for limit in (0, -1):
        try:
            select_actionable_expansion_targets(report, limit=limit)
        except ValueError:
            pass
        else:
            raise AssertionError(
                f"Expected ValueError for limit={limit}"
            )


def test_expansion_loop_is_bounded_and_dry_run_by_default():
    import asyncio
    from datetime import datetime, timezone
    from pathlib import Path

    from crawler.core.catalog_expansion import expand_catalog_coverage
    from crawler.core.fetcher import FetchResult
    from crawler.core.supabase_repository import ExecutionReport

    fixtures = Path(__file__).parent / "fixtures" / "article"
    product_html = (fixtures / "normal_sofa.html").read_text()

    class FakeFetcher:
        def __init__(self):
            self.calls = []

        async def fetch(self, url):
            self.calls.append(url)

            if "/browse/" in url:
                html = """
                <html><body>
                  <a href="/product/90090/example-bed">One</a>
                  <a href="/product/90091/example-bed">Two</a>
                  <a href="/product/90092/example-bed">Three</a>
                </body></html>
                """
                return FetchResult(
                    url,
                    url,
                    200,
                    html,
                    "text/html",
                    datetime.now(timezone.utc),
                    1,
                )

            return FetchResult(
                url,
                url,
                200,
                product_html,
                "text/html",
                datetime.now(timezone.utc),
                1,
            )

    class FakeExecutor:
        def __init__(self):
            self.calls = []

        async def execute(self, plan, *, execution_requested):
            self.calls.append(execution_requested)
            return ExecutionReport(
                execution_requested,
                False,
            )

    plan = build_coverage_plan(
        [
            CoverageTarget("US", "accent_chair", 30, "critical"),
            CoverageTarget("US", "bed_frame", 30, "critical"),
            CoverageTarget("US", "coffee_table", 30, "critical"),
        ]
    )
    report = build_coverage_report(plan, {})

    fetcher = FakeFetcher()
    executor = FakeExecutor()

    result = asyncio.run(
        expand_catalog_coverage(
            report,
            fetcher=fetcher,
            executor=executor,
            target_limit=1,
            product_limit=2,
        )
    )

    assert result.dry_run is True
    assert len(result.targets) == 1
    assert result.targets[0].target.coverage.furniture_type_code == "bed_frame"
    assert result.targets[0].discovered_count == 2
    assert len(result.targets[0].intake.items) == 2
    assert all(call is False for call in executor.calls)
    assert len(fetcher.calls) == 3


def test_expansion_loop_passes_execute_flag_to_guarded_executor():
    import asyncio
    from datetime import datetime, timezone
    from pathlib import Path

    from crawler.core.catalog_expansion import expand_catalog_coverage
    from crawler.core.fetcher import FetchResult
    from crawler.core.supabase_repository import ExecutionReport

    fixtures = Path(__file__).parent / "fixtures" / "article"
    product_html = (fixtures / "normal_sofa.html").read_text()

    class FakeFetcher:
        async def fetch(self, url):
            if "/browse/" in url:
                html = """
                <html><body>
                  <a href="/product/90090/example-bed">One</a>
                </body></html>
                """
                return FetchResult(
                    url,
                    url,
                    200,
                    html,
                    "text/html",
                    datetime.now(timezone.utc),
                    1,
                )

            return FetchResult(
                url,
                url,
                200,
                product_html,
                "text/html",
                datetime.now(timezone.utc),
                1,
            )

    class FakeExecutor:
        def __init__(self):
            self.calls = []

        async def execute(self, plan, *, execution_requested):
            self.calls.append(execution_requested)
            return ExecutionReport(
                execution_requested,
                False,
            )

    plan = build_coverage_plan(
        [CoverageTarget("US", "bed_frame", 30, "critical")]
    )
    report = build_coverage_report(plan, {})

    executor = FakeExecutor()

    result = asyncio.run(
        expand_catalog_coverage(
            report,
            fetcher=FakeFetcher(),
            executor=executor,
            target_limit=1,
            product_limit=1,
            execute=True,
        )
    )

    assert result.dry_run is False
    assert executor.calls
    assert all(call is True for call in executor.calls)


def test_expansion_loop_reports_targets_without_approved_sources():
    import asyncio
    from datetime import datetime, timezone
    from pathlib import Path

    from crawler.core.catalog_expansion import expand_catalog_coverage
    from crawler.core.fetcher import FetchResult
    from crawler.core.supabase_repository import ExecutionReport

    fixtures = Path(__file__).parent / "fixtures" / "article"
    product_html = (fixtures / "normal_sofa.html").read_text()

    class FakeFetcher:
        async def fetch(self, url):
            if "/browse/" in url:
                html = """
                <html><body>
                  <a href="/product/90090/example-bed">One</a>
                </body></html>
                """
                return FetchResult(
                    url,
                    url,
                    200,
                    html,
                    "text/html",
                    datetime.now(timezone.utc),
                    1,
                )

            return FetchResult(
                url,
                url,
                200,
                product_html,
                "text/html",
                datetime.now(timezone.utc),
                1,
            )

    class FakeExecutor:
        async def execute(self, plan, *, execution_requested):
            return ExecutionReport(
                execution_requested,
                False,
            )

    plan = build_coverage_plan(
        [
            CoverageTarget("US", "accent_chair", 30, "critical"),
            CoverageTarget("US", "bed_frame", 30, "critical"),
        ]
    )
    report = build_coverage_report(plan, {})

    result = asyncio.run(
        expand_catalog_coverage(
            report,
            fetcher=FakeFetcher(),
            executor=FakeExecutor(),
            target_limit=1,
            product_limit=1,
        )
    )

    assert len(result.targets) == 1
    assert (
        result.targets[0].target.coverage.furniture_type_code
        == "bed_frame"
    )

    assert len(result.skipped_targets) == 1
    assert result.skipped_targets[0].market_code == "US"
    assert result.skipped_targets[0].furniture_type_code == "accent_chair"
    assert result.skipped_targets[0].reason == "no_approved_source"

    document = result.as_dict()

    assert document["summary"]["targets_processed"] == 1
    assert document["summary"]["targets_skipped"] == 1
    assert document["skipped_targets"] == [
        {
            "market_code": "US",
            "furniture_type_code": "accent_chair",
            "reason": "no_approved_source",
        }
    ]
