create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
	new.updated_at = now();
	return new;
end;
$$;

create table public.furniture_categories (
	id uuid primary key default gen_random_uuid(),
	name text not null unique,
	slug text not null unique,
	description text,
	is_active boolean not null default true,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now()
);

create table public.furniture_products (
	id uuid primary key default gen_random_uuid(),
	category_id uuid not null references public.furniture_categories(id),
	product_name text not null,
	brand text,
	sku text,
	retail_price numeric,
	sale_price numeric,
	currency char(3) not null default 'USD',
	shipping_fee numeric,
	availability_status text not null default 'unknown',
	estimated_delivery_days integer,
	width_cm numeric,
	depth_cm numeric,
	height_cm numeric,
	primary_color text,
	secondary_colors text[] not null default '{}',
	room_types text[] not null default '{}',
	material text,
	finish text,
	style text,
	shape text,
	pattern text,
	visual_weight text,
	description text,
	is_active boolean not null default true,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	constraint furniture_products_retail_price_check check (retail_price is null or retail_price >= 0),
	constraint furniture_products_sale_price_check check (sale_price is null or sale_price >= 0),
	constraint furniture_products_shipping_fee_check check (shipping_fee is null or shipping_fee >= 0),
	constraint furniture_products_delivery_days_check check (estimated_delivery_days is null or estimated_delivery_days >= 0),
	constraint furniture_products_width_check check (width_cm is null or width_cm > 0),
	constraint furniture_products_depth_check check (depth_cm is null or depth_cm > 0),
	constraint furniture_products_height_check check (height_cm is null or height_cm > 0),
	constraint furniture_products_currency_check check (currency ~ '^[A-Z]{3}$'),
	constraint furniture_products_availability_check check (availability_status in ('in_stock', 'out_of_stock', 'backorder', 'discontinued', 'unknown')),
	constraint furniture_products_visual_weight_check check (visual_weight is null or visual_weight in ('light', 'medium', 'heavy'))
);

create table public.furniture_product_images (
	id uuid primary key default gen_random_uuid(),
	product_id uuid not null references public.furniture_products(id) on delete cascade,
	image_url text not null,
	display_order integer not null default 0,
	is_primary boolean not null default false,
	created_at timestamptz not null default now(),
	constraint furniture_product_images_display_order_check check (display_order >= 0),
	constraint furniture_product_images_product_order_unique unique (product_id, display_order)
);

create table public.furniture_product_sources (
	id uuid primary key default gen_random_uuid(),
	product_id uuid not null references public.furniture_products(id) on delete cascade,
	vendor_name text not null,
	vendor_item_id text,
	vendor_product_url text,
	vendor_price numeric,
	vendor_shipping_fee numeric,
	vendor_delivery_information text,
	vendor_availability text,
	vendor_country text,
	source text,
	source_updated_at timestamptz,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	constraint furniture_product_sources_vendor_price_check check (vendor_price is null or vendor_price >= 0),
	constraint furniture_product_sources_shipping_fee_check check (vendor_shipping_fee is null or vendor_shipping_fee >= 0)
);

create trigger furniture_categories_set_updated_at
	before update on public.furniture_categories
	for each row
	execute function public.set_updated_at();

create trigger furniture_products_set_updated_at
	before update on public.furniture_products
	for each row
	execute function public.set_updated_at();

create trigger furniture_product_sources_set_updated_at
	before update on public.furniture_product_sources
	for each row
	execute function public.set_updated_at();

create unique index furniture_product_sources_vendor_item_unique
	on public.furniture_product_sources (vendor_name, vendor_item_id)
	where vendor_item_id is not null;

create unique index furniture_product_images_primary_unique
	on public.furniture_product_images (product_id)
	where is_primary;

create index furniture_products_active_category_idx
	on public.furniture_products (is_active, category_id);
create index furniture_products_category_id_idx
	on public.furniture_products (category_id);
create index furniture_products_retail_price_idx
	on public.furniture_products (retail_price);
create index furniture_products_style_idx
	on public.furniture_products (style);
create index furniture_products_primary_color_idx
	on public.furniture_products (primary_color);
create index furniture_products_dimensions_idx
	on public.furniture_products (width_cm, depth_cm, height_cm);
create index furniture_product_images_product_id_idx
	on public.furniture_product_images (product_id);
create index furniture_product_sources_product_id_idx
	on public.furniture_product_sources (product_id);

alter table public.furniture_categories enable row level security;
alter table public.furniture_products enable row level security;
alter table public.furniture_product_images enable row level security;
alter table public.furniture_product_sources enable row level security;

create policy furniture_categories_select_authenticated on public.furniture_categories
	for select to authenticated
	using (is_active);

create policy furniture_products_select_authenticated on public.furniture_products
	for select to authenticated
	using (
		is_active
		and exists (
			select 1
			from public.furniture_categories
			where furniture_categories.id = furniture_products.category_id
				and furniture_categories.is_active
		)
	);


create policy furniture_product_images_select_authenticated on public.furniture_product_images
	for select to authenticated
	using (
		exists (
			select 1
			from public.furniture_products
			join public.furniture_categories on furniture_categories.id = furniture_products.category_id
			where furniture_products.id = furniture_product_images.product_id
				and furniture_products.is_active
				and furniture_categories.is_active
		)
	);