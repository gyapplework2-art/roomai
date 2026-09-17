"""Repository boundary for applying catalog persistence plans.

No Supabase client is constructed at import time. A future service-role-backed
repository can implement this interface while tests use InMemoryCatalogRepository.
"""

from dataclasses import dataclass
from typing import Protocol

from crawler.core.persistence import CatalogPersistencePlan


@dataclass(frozen=True)
class PersistenceResult:
    succeeded: bool
    partial_failure: bool
    attempted: tuple[str, ...]
    natural_keys: tuple[str, ...]
    review_reasons: tuple[str, ...]
    error: str | None = None


class CatalogRepository(Protocol):
    """Supabase-facing implementation contract based on deployed catalog tables."""

    def apply_plan(self, plan: CatalogPersistencePlan) -> PersistenceResult:
        """Upsert vendor, market, product, variants, dimensions, offers, and images."""


class InMemoryCatalogRepository:
    """Deterministic fake repository for unit tests; it never contacts Supabase."""

    def __init__(self, fail_after: int | None = None) -> None:
        self.fail_after = fail_after
        self.applied: dict[str, CatalogPersistencePlan] = {}

    def apply_plan(self, plan: CatalogPersistencePlan) -> PersistenceResult:
        steps = ("catalog_vendors", "catalog_vendor_markets", "catalog_products", "catalog_product_variants", "catalog_product_dimensions", "catalog_current_offers", "catalog_product_images")
        if self.fail_after is not None:
            attempted = steps[: self.fail_after]
            return PersistenceResult(False, True, attempted, (plan.product_natural_key,), plan.review_reasons, "Partial persistence failure; retry is safe.")
        self.applied[plan.product_natural_key] = plan
        return PersistenceResult(True, False, steps, (plan.product_natural_key,), plan.review_reasons)
