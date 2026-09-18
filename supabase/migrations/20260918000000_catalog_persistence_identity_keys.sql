-- Add forward-compatible conflict keys for generic catalog persistence.
-- Existing rows remain nullable because no deterministic backfill is assumed.

alter table public.catalog_products
  add column persistence_key text;

alter table public.catalog_products
  add constraint catalog_products_vendor_market_persistence_key_key
  unique (vendor_market_id, persistence_key);

alter table public.catalog_product_variants
  add column persistence_key text;

alter table public.catalog_product_variants
  add constraint catalog_product_variants_product_persistence_key_key
  unique (product_id, persistence_key);
