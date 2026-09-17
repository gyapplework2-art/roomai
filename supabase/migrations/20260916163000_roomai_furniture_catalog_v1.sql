-- RoomAI 6B.3A Furniture Catalog
-- Supabase/PostgreSQL migration v1.1
-- REVIEWED BASELINE: still do not execute until you approve the Supabase deployment step.
-- REVIEW CHANGES IN v1.1:
-- * strict market+URL fallback identity
-- * nullable taxonomy-alias uniqueness fixed
-- * taxonomy-review flag added
-- * pricing rule name/version + customer-price history added
-- * customer view uses security_invoker and is server-only by default
-- * browser roles explicitly revoked from internal catalog tables/view
-- * updated_at trigger automation added
--

begin;

create extension if not exists pgcrypto;

create type public.catalog_publication_status as enum ('staging','published','rejected','retired');
create type public.catalog_job_type as enum ('discovery','refresh');
create type public.catalog_job_status as enum ('queued','running','succeeded','failed','retry');
create type public.catalog_run_status as enum ('running','succeeded','partial','failed');
create type public.catalog_error_type as enum ('fetch','parse','validation','normalization','db');
create type public.catalog_availability as enum ('in_stock','low_stock','backorder','preorder','out_of_stock','discontinued','unknown');
create type public.catalog_markup_type as enum ('percentage','fixed_amount');

create table public.catalog_countries (
  id uuid primary key default gen_random_uuid(),
  country_code text not null unique check (char_length(country_code)=2),
  country_name text not null,
  default_currency text not null check (char_length(default_currency)=3),
  default_locale text not null,
  is_supported boolean not null default false,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index catalog_countries_one_default_idx on public.catalog_countries (is_default) where is_default;

create table public.catalog_vendors (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  website_url text,
  crawl_enabled boolean not null default true,
  internal_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.catalog_vendor_markets (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.catalog_vendors(id),
  country_id uuid not null references public.catalog_countries(id),
  market_code text not null unique,
  base_url text not null,
  currency_code text not null check (char_length(currency_code)=3),
  default_locale text not null,
  supported_locales jsonb not null default '[]'::jsonb,
  crawl_enabled boolean not null default true,
  crawl_config jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(vendor_id,country_id,market_code)
);

create table public.catalog_categories (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  display_name text not null,
  description text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.catalog_furniture_types (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.catalog_categories(id),
  code text not null unique,
  display_name text not null,
  description text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  replacement_type_id uuid references public.catalog_furniture_types(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.catalog_taxonomy_aliases (
  id uuid primary key default gen_random_uuid(),
  furniture_type_id uuid not null references public.catalog_furniture_types(id),
  alias_text text not null,
  normalized_alias text not null,
  source_scope text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index catalog_taxonomy_aliases_scope_uidx
  on public.catalog_taxonomy_aliases(normalized_alias, coalesce(source_scope,''));

create table public.catalog_brands (
  id uuid primary key default gen_random_uuid(),
  canonical_name text not null,
  normalized_name text not null unique,
  is_active boolean not null default true,
  internal_notes text,
  created_at timestamptz not null default now()
);

create table public.catalog_brand_aliases (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.catalog_brands(id),
  alias_text text not null,
  normalized_alias text not null unique
);

create table public.catalog_products (
  id uuid primary key default gen_random_uuid(),
  vendor_market_id uuid not null references public.catalog_vendor_markets(id),
  brand_id uuid references public.catalog_brands(id),
  furniture_type_id uuid references public.catalog_furniture_types(id),
  vendor_product_id text,
  source_product_name text not null,
  roomai_product_title text,
  source_category text,
  source_subcategory text,
  source_product_type text,
  source_description text,
  roomai_description text,
  source_features jsonb not null default '[]'::jsonb,
  product_url text not null,
  normalized_style text,
  source_payload jsonb not null default '{}'::jsonb,
  source_hash text,
  needs_taxonomy_review boolean not null default false,
  publication_status public.catalog_publication_status not null default 'staging',
  is_active boolean not null default true,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index catalog_products_vendor_product_uidx
  on public.catalog_products(vendor_market_id,vendor_product_id) where vendor_product_id is not null;
create unique index catalog_products_market_url_uidx
  on public.catalog_products(vendor_market_id,product_url);
create index catalog_products_type_idx on public.catalog_products(furniture_type_id,is_active,publication_status);
create index catalog_products_market_idx on public.catalog_products(vendor_market_id,is_active,publication_status);

create table public.catalog_product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.catalog_products(id) on delete cascade,
  vendor_sku text,
  vendor_variant_id text,
  variant_name text,
  source_color text,
  normalized_color text,
  source_material text,
  normalized_material text,
  source_style text,
  normalized_style text,
  configuration text,
  seating_capacity integer,
  source_dimension_text text,
  variant_attributes jsonb not null default '{}'::jsonb,
  publication_status public.catalog_publication_status not null default 'staging',
  is_active boolean not null default true,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index catalog_variants_sku_uidx on public.catalog_product_variants(product_id,vendor_sku) where vendor_sku is not null;
create unique index catalog_variants_vendor_id_uidx on public.catalog_product_variants(product_id,vendor_variant_id) where vendor_variant_id is not null;
create index catalog_variants_filter_idx on public.catalog_product_variants(product_id,normalized_color,normalized_material,is_active);

create table public.catalog_product_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.catalog_products(id) on delete cascade,
  variant_id uuid references public.catalog_product_variants(id) on delete cascade,
  source_url text not null,
  image_role text not null default 'alternate',
  alt_text text,
  width_px integer,
  height_px integer,
  sort_order integer not null default 0,
  source_hash text,
  created_at timestamptz not null default now(),
  unique(product_id,variant_id,source_url)
);

create table public.catalog_product_dimensions (
  id uuid primary key default gen_random_uuid(),
  variant_id uuid not null unique references public.catalog_product_variants(id) on delete cascade,
  source_dimension_text text,
  width_cm numeric(10,2),
  depth_cm numeric(10,2),
  height_cm numeric(10,2),
  weight_kg numeric(10,2),
  dimension_details jsonb not null default '{}'::jsonb
);

create table public.catalog_product_attributes (
  id uuid primary key default gen_random_uuid(),
  variant_id uuid not null references public.catalog_product_variants(id) on delete cascade,
  attribute_key text not null,
  source_value text,
  normalized_value jsonb,
  normalization_version text,
  created_at timestamptz not null default now(),
  unique(variant_id,attribute_key)
);

create table public.catalog_current_offers (
  id uuid primary key default gen_random_uuid(),
  variant_id uuid not null unique references public.catalog_product_variants(id) on delete cascade,
  currency text not null check (char_length(currency)=3),
  vendor_list_price numeric(12,2),
  vendor_sale_price numeric(12,2),
  vendor_shipping_fee numeric(12,2),
  source_availability text,
  normalized_availability public.catalog_availability not null default 'unknown',
  delivery_text text,
  estimated_delivery_days_min integer,
  estimated_delivery_days_max integer,
  checked_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.catalog_price_history (
  id uuid primary key default gen_random_uuid(),
  variant_id uuid not null references public.catalog_product_variants(id) on delete cascade,
  currency text not null,
  vendor_list_price numeric(12,2),
  vendor_sale_price numeric(12,2),
  vendor_shipping_fee numeric(12,2),
  observed_at timestamptz not null default now(),
  crawl_run_id uuid
);
create index catalog_price_history_variant_time_idx on public.catalog_price_history(variant_id,observed_at desc);

create table public.catalog_availability_history (
  id uuid primary key default gen_random_uuid(),
  variant_id uuid not null references public.catalog_product_variants(id) on delete cascade,
  source_availability text,
  normalized_availability public.catalog_availability not null default 'unknown',
  delivery_text text,
  observed_at timestamptz not null default now()
);
create index catalog_availability_history_variant_time_idx on public.catalog_availability_history(variant_id,observed_at desc);

create table public.catalog_pricing_rules (
  id uuid primary key default gen_random_uuid(),
  rule_name text not null default 'Default markup',
  rule_version integer not null default 1,
  country_id uuid references public.catalog_countries(id),
  vendor_market_id uuid references public.catalog_vendor_markets(id),
  category_id uuid references public.catalog_categories(id),
  furniture_type_id uuid references public.catalog_furniture_types(id),
  product_id uuid references public.catalog_products(id),
  variant_id uuid references public.catalog_product_variants(id),
  markup_type public.catalog_markup_type not null default 'percentage',
  markup_value numeric(12,4) not null check (markup_value >= 0),
  priority integer not null default 100,
  effective_from timestamptz not null default now(),
  effective_to timestamptz,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (effective_to is null or effective_to > effective_from)
);
create index catalog_pricing_rules_active_idx on public.catalog_pricing_rules(is_active,effective_from,effective_to,priority);

create table public.catalog_customer_prices (
  variant_id uuid primary key references public.catalog_product_variants(id) on delete cascade,
  pricing_rule_id uuid not null references public.catalog_pricing_rules(id),
  currency text not null,
  source_price_basis numeric(12,2) not null,
  markup_type public.catalog_markup_type not null,
  markup_value numeric(12,4) not null,
  calculated_markup_amount numeric(12,2) not null,
  roomai_selling_price numeric(12,2) not null,
  calculated_at timestamptz not null default now()
);


create table public.catalog_customer_price_history (
  id uuid primary key default gen_random_uuid(),
  variant_id uuid not null references public.catalog_product_variants(id) on delete cascade,
  pricing_rule_id uuid not null references public.catalog_pricing_rules(id),
  currency text not null,
  source_price_basis numeric(12,2) not null,
  markup_type public.catalog_markup_type not null,
  markup_value numeric(12,4) not null,
  roomai_selling_price numeric(12,2) not null,
  calculated_at timestamptz not null default now()
);
create index catalog_customer_price_history_variant_time_idx
  on public.catalog_customer_price_history(variant_id,calculated_at desc);

create table public.catalog_crawl_jobs (
  id uuid primary key default gen_random_uuid(),
  vendor_market_id uuid not null references public.catalog_vendor_markets(id),
  job_type public.catalog_job_type not null,
  target_url text,
  priority integer not null default 100,
  status public.catalog_job_status not null default 'queued',
  next_run_at timestamptz,
  attempt_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index catalog_crawl_queue_idx on public.catalog_crawl_jobs(status,next_run_at,priority);

create table public.catalog_crawl_runs (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references public.catalog_crawl_jobs(id),
  vendor_market_id uuid not null references public.catalog_vendor_markets(id),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status public.catalog_run_status not null default 'running',
  products_seen integer not null default 0,
  variants_seen integer not null default 0,
  changed_count integer not null default 0,
  error_count integer not null default 0,
  adapter_version text,
  normalization_version text,
  source_snapshot_hash text
);

alter table public.catalog_price_history
  add constraint catalog_price_history_run_fk foreign key (crawl_run_id) references public.catalog_crawl_runs(id);

create table public.catalog_crawl_errors (
  id uuid primary key default gen_random_uuid(),
  crawl_run_id uuid not null references public.catalog_crawl_runs(id) on delete cascade,
  url text,
  error_type public.catalog_error_type not null,
  message text not null,
  retryable boolean not null default false,
  created_at timestamptz not null default now()
);

-- Customer-safe view: intentionally excludes vendor, brand, SKU, source URL, source price and crawler metadata.
create view public.roomai_catalog_public
with (security_invoker = true) as
select
  p.id as product_id,
  v.id as variant_id,
  c.country_code,
  cat.code as category_code,
  cat.display_name as category_name,
  ft.code as furniture_type_code,
  ft.display_name as furniture_type_name,
  coalesce(p.roomai_product_title,p.source_product_name) as product_title,
  p.roomai_description,
  v.normalized_color,
  v.normalized_material,
  coalesce(v.normalized_style,p.normalized_style) as normalized_style,
  v.configuration,
  v.seating_capacity,
  d.width_cm,d.depth_cm,d.height_cm,d.weight_kg,
  cp.currency,
  cp.roomai_selling_price,
  o.normalized_availability,
  o.delivery_text,
  o.estimated_delivery_days_min,
  o.estimated_delivery_days_max,
  o.checked_at as vendor_data_checked_at,
  cp.calculated_at as roomai_price_calculated_at
from public.catalog_products p
join public.catalog_vendor_markets vm on vm.id=p.vendor_market_id and vm.is_active
join public.catalog_countries c on c.id=vm.country_id and c.is_supported
join public.catalog_product_variants v on v.product_id=p.id and v.is_active and v.publication_status='published'
left join public.catalog_categories cat on cat.id=(select category_id from public.catalog_furniture_types where id=p.furniture_type_id)
left join public.catalog_furniture_types ft on ft.id=p.furniture_type_id
left join public.catalog_product_dimensions d on d.variant_id=v.id
left join public.catalog_current_offers o on o.variant_id=v.id
join public.catalog_customer_prices cp on cp.variant_id=v.id
where p.is_active and p.publication_status='published';

-- RLS: internal tables are server/service-role only by default.
do $$
declare r record;
begin
  for r in
    select tablename from pg_tables
    where schemaname='public' and tablename like 'catalog_%'
  loop
    execute format('alter table public.%I enable row level security', r.tablename);
  end loop;
end $$;

-- No direct anon/authenticated policies are created on internal catalog tables.
-- Application server/service-role performs ingestion and internal operations.
-- Expose customer catalog through a controlled server API or explicitly reviewed view policy.


-- Keep updated_at accurate without application-specific code.
create or replace function public.catalog_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
declare r record;
begin
  for r in
    select tablename from pg_tables
    where schemaname='public'
      and tablename like 'catalog_%'
      and exists (
        select 1 from information_schema.columns c
        where c.table_schema='public'
          and c.table_name=pg_tables.tablename
          and c.column_name='updated_at'
      )
  loop
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.catalog_set_updated_at()',
      r.tablename || '_set_updated_at', r.tablename
    );
  end loop;
end $$;

-- Defense in depth: no browser role gets raw catalog-table access.
do $$
declare r record;
begin
  for r in select tablename from pg_tables where schemaname='public' and tablename like 'catalog_%'
  loop
    execute format('revoke all on table public.%I from anon, authenticated', r.tablename);
  end loop;
end $$;

-- The public view is intentionally NOT granted to anon/authenticated in v1.1.
-- RoomAI should read it through a controlled server-side API initially.
revoke all on table public.roomai_catalog_public from anon, authenticated;

-- Minimal US seed/reference data.
insert into public.catalog_countries(country_code,country_name,default_currency,default_locale,is_supported,is_default)
values ('US','United States','USD','en-US',true,true);

insert into public.catalog_categories(code,display_name,description,sort_order)
values ('living_room','Living Room','Furniture primarily used in living and family spaces.',10);

insert into public.catalog_furniture_types(category_id,code,display_name,description,sort_order)
select id,'sofa','Sofa','Upholstered seating generally designed for multiple people.',10
from public.catalog_categories where code='living_room';

insert into public.catalog_taxonomy_aliases(furniture_type_id,alias_text,normalized_alias,source_scope)
select id,'couch','couch',null from public.catalog_furniture_types where code='sofa';

-- Example default pricing rule only; markup_value is intentionally 0.0000 until Grace chooses the production value.
insert into public.catalog_pricing_rules(country_id,rule_name,rule_version,markup_type,markup_value,priority,is_active)
select id,'US default markup',1,'percentage',0.0000,100,true from public.catalog_countries where country_code='US';

commit;
