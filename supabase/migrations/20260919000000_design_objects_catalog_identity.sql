alter table public.design_objects
  add column catalog_product_id uuid references public.catalog_products(id) on delete set null,
  add column catalog_product_variant_id uuid references public.catalog_product_variants(id) on delete set null;

create index design_objects_catalog_product_id_idx
  on public.design_objects (catalog_product_id);

create index design_objects_catalog_product_variant_id_idx
  on public.design_objects (catalog_product_variant_id);
