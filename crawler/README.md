# RoomAI Furniture Catalog Crawler

This Python subsystem is the background foundation for RoomAI's furniture catalog. It is separate from the Next.js customer request path and must run through dedicated scheduled or worker processes.

## Responsibilities

```text
Crawler = source facts
Normalizer = standardized RoomAI meaning
Design Intelligence = aesthetic judgment
```

## 6B.3B.5 Normalization and Resolution

```text
SOURCE FACT
	↓
NORMALIZED FACT
	↓
RESOLUTION PROPOSAL
	↓
future approved catalog identity
```

`crawler/core/normalizer.py` deterministically normalizes explicitly supplied units, source colors/materials, and availability while preserving every source value. Unknown units or terms remain unnormalized and are flagged for review; names are never mined for attributes.

`crawler/core/product_resolver.py` produces conservative, non-mutating proposals from explicit vendor, market, identifier, and Article `isRelatedTo` evidence. A related Article record is `related_only`, not an automatic product-family or variant merge. No permanent catalog identity is assigned at this stage.

## 6B.3B.6 Catalog Persistence Plans

```text
Crawler/adapter
	↓
CatalogProduct source facts
	↓
Normalizer
	↓
Persistence plan
	↓
Repository
	↓
Supabase catalog/staging
```

`crawler/core/persistence.py` maps one `CatalogProduct` into a pure, natural-key-based plan for the deployed catalog tables: `catalog_vendors`, `catalog_vendor_markets`, `catalog_products`, `catalog_product_variants`, `catalog_product_dimensions`, `catalog_current_offers`, and `catalog_product_images`. It does not perform database I/O.

The repository boundary in `crawler/core/database.py` resolves database UUIDs after vendor and market upserts. Product identity prefers `(vendor_market, vendor_product_id)` and falls back to `(vendor_market, product_url)`; variants prefer product-plus-SKU, then product-plus-vendor variant ID. Vendor market keys are country-specific, for example `article-us` and `article-ca`.

Plans preserve source fields alongside normalized fields, structured source payload, dimensions, offers, and image ordering. They write only vendor commercial facts, never RoomAI customer prices, markup, or margin. New and uncertain records are staged; missing canonical taxonomy produces a review reason. `isRelatedTo` remains raw evidence and never merges records.

The deployed schema has no standalone source-snapshot or generic review table, so structured snapshots remain in `catalog_products.source_payload` and review intent maps to `needs_taxonomy_review` plus `publication_status='staging'`. Current offers are planned, but price/availability history is intentionally deferred because those tables represent later observations.

Supabase multi-table writes are not claimed to be transactional. Repositories must report partial failure explicitly; idempotent natural keys allow a retry to converge safely. Unit tests use only the in-memory repository and make no live database writes.

## 6B.3C.1 Article US Sofa Discovery Pilot

This controlled discovery-only pilot finds approximately 20-50 candidate Article US sofa URLs from one manually approved public source page. It accepts a public product sitemap first when available, or a US sofa category/listing page, and never uses search-engine scraping as its catalog source.

Candidate URLs must match `/product/<numeric-id>/<slug>`. Discovery removes fragments, query parameters, and trailing slashes; the explicit numeric page ID is the deduplication key. Different page IDs always remain separate. The output preserves Article, market `US`, category `sofas`, product URL, page ID, source page, source type, and timestamp. It does not extract products, normalize facts, resolve identities, use `isRelatedTo`, price products, or write to Supabase.

Run one bounded, manually approved discovery request from the repository root:

```bash
python -m crawler.jobs.discover_products article --market US --category sofas --source-url "https://www.article.com/approved-sofa-source" --source-type category --limit 30
```

For a publicly available product sitemap, use `--source-type sitemap`. Add `--output crawler/output/article_us_sofas_discovery.json` only when you explicitly want a local review artifact; runtime output is ignored by Git. The command prints a summary followed by reviewable candidate JSON, never writes to Supabase, and must be used only in accordance with Article terms, applicable robots policies, rate limits, and access restrictions.

## 6B.3C.2 Article US Sofa Batch Review

This review-only batch accepts the discovery JSON from 6B.3C.1, processes a default of 10 candidates sequentially, and hard-caps the pilot at 50. Each candidate moves through the existing Article adapter, deterministic normalizer, conservative resolution proposal, and persistence-plan mapper. Plans are included for human QA only; the database repository is never imported or applied.

```bash
python -m crawler.jobs.review_article_batch --input crawler/output/article_us_sofas_discovery.json --limit 10 --output crawler/output/article_us_sofas_batch_review.json
```

The JSON output contains `summary` counts and per-product review records with source facts, normalized facts, related-product evidence, non-mutating resolution proposals, staging/review reasons, and proposed catalog records. It contains no RoomAI customer price or markup. A fetch, extraction, normalization, or persistence-plan failure is recorded for that product and the sequential batch continues. `isRelatedTo` remains evidence only and does not establish product-family identity.

## 6B.3C.2A Article Rich Attribute Extraction

The Article adapter continues to prioritize JSON-LD Product properties, then supplements them with JSON from scripts explicitly identified as product state. Labeled source attributes such as Color, Finish, Upholstery Material, Fabric, and Leather populate `source_color` or `source_material` only when explicitly present. Other labeled specifications, including frame material, cushion fill, and assembly information, remain in `variant_attributes.article_attributes` with their original labels and values.

Explicit gallery image metadata is collected in source order, exact URLs are deduplicated, and explicitly labeled logos, recommendation assets, and thumbnails are excluded. This layer never derives color/material from a product name, description, image, or `isRelatedTo` record. Source values remain distinct from later deterministic normalized values.

## 6B.3C.2A.1 Live Source Investigation

Article is the learning vendor, not the architecture. Before adding another adapter rule, inspect a manually downloaded local HTML response for stable, explicit structured evidence:

```bash
python -m crawler.jobs.inspect_article_html crawler/output/article_30333_live.html
```

The diagnostic makes no network requests and reports script inventory, JSON-LD/application-JSON presence, bounded JSON path previews, keyword evidence, and candidate image paths. Description matches are reported only as unstructured text evidence. See [extraction architecture](docs/extraction_architecture.md) for the generic, vendor-configuration, vendor-specific, promotion-after-second-use, and AI-enrichment boundaries.

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
