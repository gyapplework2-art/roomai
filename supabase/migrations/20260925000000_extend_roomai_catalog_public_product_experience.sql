-- D.3A.6: Extend the customer-safe catalog view with product experience fields.
-- Exposes only customer-facing vendor identity, product URL, and one deterministic
-- variant image. Internal vendor configuration, source pricing, crawler metadata,
-- and source payloads remain excluded.

create or replace view public.roomai_catalog_public
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
  cp.calculated_at as roomai_price_calculated_at,
  vendor.name as vendor_name,
  p.product_url,
  primary_image.source_url as primary_image_url
from public.catalog_products p
join public.catalog_vendor_markets vm
  on vm.id=p.vendor_market_id and vm.is_active
join public.catalog_vendors vendor
  on vendor.id=vm.vendor_id
join public.catalog_countries c
  on c.id=vm.country_id and c.is_supported
join public.catalog_product_variants v
  on v.product_id=p.id
  and v.is_active
  and v.publication_status='published'
left join public.catalog_categories cat
  on cat.id=(
    select category_id
    from public.catalog_furniture_types
    where id=p.furniture_type_id
  )
left join public.catalog_furniture_types ft
  on ft.id=p.furniture_type_id
left join public.catalog_product_dimensions d
  on d.variant_id=v.id
left join public.catalog_current_offers o
  on o.variant_id=v.id
join public.catalog_customer_prices cp
  on cp.variant_id=v.id
left join lateral (
  select i.source_url
  from public.catalog_product_images i
  where i.product_id=p.id
    and i.variant_id=v.id
  order by i.sort_order asc, i.created_at asc, i.id asc
  limit 1
) primary_image on true
where p.is_active
  and p.publication_status='published';

-- Preserve the existing server-only access boundary.
revoke all on table public.roomai_catalog_public from anon, authenticated;
