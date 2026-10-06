"""Coverage-driven catalog expansion orchestration primitives."""

from dataclasses import dataclass

from crawler.core.catalog_coverage import (
    CatalogCoverageReport,
    CoverageReportRow,
    select_expansion_targets,
)
from crawler.core.catalog_batch import intake_candidates, persist_batch
from crawler.discovery.article import (
    discover_article_category,
    discover_article_sofa_urls,
)
from crawler.discovery.sitemap import extract_sitemap_urls
from crawler.discovery.source_map import (
    ApprovedDiscoverySource,
    approved_sources_for_target,
)
from crawler.vendors.article import ArticleVendorAdapter


@dataclass(frozen=True)
class ActionableExpansionTarget:
    """One coverage deficit paired with an explicitly approved source."""

    coverage: CoverageReportRow
    source: ApprovedDiscoverySource


def is_catalog_expansion_source_supported(source: ApprovedDiscoverySource) -> bool:
    """Whether the existing expansion executor can handle an approved source."""
    return source.vendor.lower() == "article" and source.vendor_market_code == "US"


def select_actionable_expansion_targets(
    report: CatalogCoverageReport,
    *,
    limit: int | None = None,
) -> tuple[ActionableExpansionTarget, ...]:
    """Return ranked deficit targets that have approved discovery sources.

    Coverage priority remains authoritative. Targets without an approved
    source are skipped rather than guessed. The limit is applied only after
    unsupported targets have been filtered out.
    """

    if limit is not None and limit < 1:
        raise ValueError("limit must be at least 1.")

    selected: list[ActionableExpansionTarget] = []

    for coverage in select_expansion_targets(report):
        sources = approved_sources_for_target(
            coverage.market_code,
            coverage.furniture_type_code,
        )

        if not sources:
            continue

        selected.append(
            ActionableExpansionTarget(
                coverage=coverage,
                source=sources[0],
            )
        )

        if limit is not None and len(selected) >= limit:
            break

    return tuple(selected)


@dataclass(frozen=True)
class ExpansionTargetResult:
    """Result of one bounded source-backed expansion target."""

    target: ActionableExpansionTarget
    discovered_count: int
    intake: object
    persistence: object

    def as_dict(self) -> dict[str, object]:
        return {
            "market_code": self.target.coverage.market_code,
            "furniture_type_code": self.target.coverage.furniture_type_code,
            "priority": self.target.coverage.priority,
            "actual_product_count": self.target.coverage.actual_product_count,
            "target_product_count": self.target.coverage.target_product_count,
            "deficit_count": self.target.coverage.deficit_count,
            "source": self.target.source.__dict__,
            "discovered_count": self.discovered_count,
            "intake": self.intake.as_dict(),
            "persistence": self.persistence.as_dict(),
        }


@dataclass(frozen=True)
class SkippedExpansionTarget:
    """Coverage target skipped because no approved source exists."""

    market_code: str
    furniture_type_code: str
    reason: str

    def as_dict(self) -> dict[str, str]:
        return {
            "market_code": self.market_code,
            "furniture_type_code": self.furniture_type_code,
            "reason": self.reason,
        }


@dataclass(frozen=True)
class CatalogExpansionResult:
    """Result of one bounded automated catalog expansion run."""

    targets: tuple[ExpansionTargetResult, ...]
    skipped_targets: tuple[SkippedExpansionTarget, ...]
    dry_run: bool

    def as_dict(self) -> dict[str, object]:
        return {
            "stage": "expand",
            "dry_run": self.dry_run,
            "summary": {
                "targets_processed": len(self.targets),
                "targets_skipped": len(self.skipped_targets),
                "candidates_discovered": sum(
                    target.discovered_count
                    for target in self.targets
                ),
                "products_ready": sum(
                    len(target.intake.ready)
                    for target in self.targets
                ),
                "products_review_required": sum(
                    len(target.intake.review_required)
                    for target in self.targets
                ),
                "products_failed": sum(
                    len(target.intake.failed)
                    for target in self.targets
                ),
            },
            "targets": [
                target.as_dict()
                for target in self.targets
            ],
            "skipped_targets": [
                target.as_dict()
                for target in self.skipped_targets
            ],
        }



async def expand_catalog_coverage(
    report: CatalogCoverageReport,
    *,
    fetcher,
    executor,
    target_limit: int = 1,
    product_limit: int = 10,
    execute: bool = False,
) -> CatalogExpansionResult:
    """Expand highest-priority approved deficits in bounded sequential batches."""

    if target_limit < 1:
        raise ValueError("target_limit must be at least 1.")
    if product_limit < 1 or product_limit > 50:
        raise ValueError("product_limit must be between 1 and 50.")

    actionable: list[ActionableExpansionTarget] = []
    skipped: list[SkippedExpansionTarget] = []

    for coverage in select_expansion_targets(report):
        sources = approved_sources_for_target(
            coverage.market_code,
            coverage.furniture_type_code,
        )

        if not sources:
            skipped.append(
                SkippedExpansionTarget(
                    market_code=coverage.market_code,
                    furniture_type_code=coverage.furniture_type_code,
                    reason="no_approved_source",
                )
            )
            continue

        actionable.append(
            ActionableExpansionTarget(
                coverage=coverage,
                source=sources[0],
            )
        )

        if len(actionable) >= target_limit:
            break

    results: list[ExpansionTargetResult] = []

    for target in actionable:
        source = target.source

        if not is_catalog_expansion_source_supported(source):
            continue

        source_fetch = await fetcher.fetch(source.source_url)

        if not source_fetch.succeeded or source_fetch.response_text is None:
            continue

        if source.source_type == "sitemap":
            discovery = discover_article_sofa_urls(
                extract_sitemap_urls(source_fetch.response_text),
                source_fetch.final_url,
                limit=product_limit,
            )
        else:
            discovery = discover_article_category(
                source_fetch.response_text,
                source_fetch.final_url,
                source_category=source.source_category,
                limit=product_limit,
            )

        candidates = [
            candidate.__dict__
            for candidate in discovery.candidates
        ]

        intake = await intake_candidates(
            candidates,
            adapter=ArticleVendorAdapter(source.vendor_market_code),
            fetcher=fetcher,
            limit=product_limit,
        )

        persistence = await persist_batch(
            (
                item.plan
                for item in intake.ready
                if item.plan is not None
            ),
            executor=executor,
            execute=execute,
        )

        results.append(
            ExpansionTargetResult(
                target=target,
                discovered_count=len(discovery.candidates),
                intake=intake,
                persistence=persistence,
            )
        )

    return CatalogExpansionResult(
        targets=tuple(results),
        skipped_targets=tuple(skipped),
        dry_run=not execute,
    )
