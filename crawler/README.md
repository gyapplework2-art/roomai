# RoomAI Furniture Catalog Crawler

This Python subsystem is the background foundation for RoomAI's furniture catalog. It is separate from the Next.js customer request path and must run through dedicated scheduled or worker processes.

## Responsibilities

```text
Crawler = source facts
Normalizer = standardized RoomAI meaning
Design Intelligence = aesthetic judgment
```

The crawler discovers and extracts vendor facts. A future normalizer maps those facts into RoomAI terminology. Design Intelligence makes aesthetic decisions. These responsibilities must not be mixed.

## Vendor Markets

RoomAI is US-first but country-specific. A vendor market is an independent commercial catalog: `ikea-us` and `ikea-ca` can have different URLs, SKUs, prices, currencies, availability, shipping, and delivery information. Each `CatalogProduct` belongs to exactly one `vendor_market_code`; this foundation performs no cross-country matching or deduplication.

Vendor-specific logic belongs in `crawler/vendors/`. Adapters must respect vendor terms, applicable robots policies, rate limits, retries/backoff, and country-market isolation. This project does not include anti-bot, CAPTCHA, or authentication circumvention.

## Product Contract

`crawler/models/product.py` defines source-fact Pydantic models for products, variants, dimensions, images, and current vendor offers. It preserves original names, descriptions, features, colors, materials, styles, images, and offers to support future AI recommendations and direct category shopping.

Vendor price != RoomAI customer price. The contract contains no RoomAI markup, margin, or customer selling price. Future Supabase persistence will store source facts, while future nightly jobs refresh vendor price/availability and weekly jobs discover products.

## Generic Acquisition

`crawler/core/fetcher.py` provides reusable HTTP/HTTPS acquisition with a configured User-Agent, redirects, bounded retries for transient failures, exponential backoff, and request throttling. It is country-neutral and has no anti-bot or access-control bypassing behavior.

`crawler/core/structured_data.py` extracts JSON-LD with the Python standard library. It preserves valid original JSON-LD, tolerates malformed blocks, and identifies schema.org `Product`, `Offer`, and `AggregateOffer` source facts where present. It does not perform vendor-specific parsing, RoomAI normalization, or customer-price calculation. Unit tests use synthetic `example.com` data and mocked HTTP transports only; they never crawl real retailers.

## 6B.3B.4 Article Pilot

`crawler/vendors/article.py` is the first vendor-specific extraction pilot. It accepts already-fetched HTML, reads schema.org Product data first, and uses only a minimal title/meta fallback if structured data is absent or malformed. It produces a `CatalogProduct` source record for the explicit `US` Article market and preserves raw JSON-LD, including Article/brand facts, descriptions, images, offers, SKUs, colors, materials, and variants where publicly present.

The pilot does not discover Article pages, crawl linked pages, infer missing fields, normalize source terms, assess style or room compatibility, calculate customer prices, persist data, or run automatically. Numeric dimensions are populated only where the source explicitly declares centimeters or kilograms; other dimensions remain preserved as source text instead of being guessed.

Fixture tests under `crawler/tests/fixtures/article/` use fictional Article-like products and `example.com` URLs. They require no network access.

For a manually approved, single-product inspection, run this explicit command from the repository root:

```bash
python -m crawler.jobs.inspect_article_product https://www.article.com/example-product
```

Before making any manual request, confirm Article robots policies, terms, rate limits, and access restrictions permit it. The command fetches exactly the supplied URL, prints source-fact JSON to stdout, and performs no discovery, AI work, pricing calculation, or database write.

```text
Crawler = source facts
Normalizer = standardized RoomAI meaning
Design Intelligence = aesthetic judgment
```

## Local Setup

From the repository root in your real terminal:

```bash
python3 -m venv crawler/.venv
source crawler/.venv/bin/activate
pip install -r crawler/requirements.txt
pytest crawler/tests
```

Copy `.env.example` to `.env` only for a background worker that needs future Supabase persistence. Do not place service-role credentials in Next.js client code.
