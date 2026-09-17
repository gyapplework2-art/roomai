from pathlib import Path

from crawler.core.database import InMemoryCatalogRepository
from crawler.core.persistence import build_persistence_plan
from crawler.vendors.article import ArticleVendorAdapter


FIXTURE = Path(__file__).parent / "fixtures" / "article" / "inch_dimensions_sofa.html"


def plan():
    product = ArticleVendorAdapter().parse_product(
        FIXTURE.read_text(),
        "https://example.com/article/product/90090/inch-dimension-sofa",
    )
    return build_persistence_plan(product)


def test_repeated_plan_application_is_idempotent():
    repository = InMemoryCatalogRepository()
    persistence_plan = plan()

    first = repository.apply_plan(persistence_plan)
    second = repository.apply_plan(persistence_plan)

    assert first.succeeded and second.succeeded
    assert len(repository.applied) == 1
    assert persistence_plan.product_natural_key in repository.applied


def test_partial_failure_is_explicit_and_retry_can_converge():
    persistence_plan = plan()
    failed = InMemoryCatalogRepository(fail_after=3).apply_plan(persistence_plan)
    retried = InMemoryCatalogRepository().apply_plan(persistence_plan)

    assert failed.succeeded is False
    assert failed.partial_failure is True
    assert failed.error == "Partial persistence failure; retry is safe."
    assert retried.succeeded is True
    assert retried.partial_failure is False
