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

## Local Setup

From the repository root in your real terminal:

```bash
python3 -m venv crawler/.venv
source crawler/.venv/bin/activate
pip install -r crawler/requirements.txt
pytest crawler/tests
```

Copy `.env.example` to `.env` only for a background worker that needs future Supabase persistence. Do not place service-role credentials in Next.js client code.
