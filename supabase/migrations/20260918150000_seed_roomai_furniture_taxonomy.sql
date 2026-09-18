-- RoomAI 6B.3D.1C
-- Seed canonical RoomAI furniture taxonomy.
--
-- Safe/idempotent reference-data migration.
-- Existing canonical rows are updated rather than duplicated.

begin;

-- ============================================================
-- 1. Canonical categories
-- ============================================================

insert into public.catalog_categories
    (code, display_name, description, sort_order, is_active)
values
    ('living_room', 'Living Room',
     'Furniture primarily used in living and family spaces.', 10, true),

    ('dining_room', 'Dining Room',
     'Furniture primarily used for dining and related storage.', 20, true),

    ('bedroom', 'Bedroom',
     'Furniture primarily used in bedrooms and guest rooms.', 30, true),

    ('home_office', 'Home Office',
     'Furniture primarily used for home office and study spaces.', 40, true),

    ('storage', 'Storage & Shelving',
     'General storage, shelving, cabinet, and media furniture.', 50, true),

    ('rugs', 'Rugs',
     'Area rugs and related floor coverings.', 60, true),

    ('lighting', 'Lighting',
     'Floor, table, pendant, and chandelier lighting.', 70, true),

    ('decor', 'Decor',
     'Mirrors and other decorative furnishings.', 80, true)

on conflict (code) do update
set
    display_name = excluded.display_name,
    description = excluded.description,
    sort_order = excluded.sort_order,
    is_active = excluded.is_active;


-- ============================================================
-- 2. Canonical furniture types
-- ============================================================

with furniture_type_seed(
    category_code,
    code,
    display_name,
    sort_order
) as (
    values

        -- Living room
        ('living_room', 'sofa', 'Sofa', 10),
        ('living_room', 'sectional_sofa', 'Sectional Sofa', 20),
        ('living_room', 'sofa_with_chaise', 'Sofa with Chaise', 30),
        ('living_room', 'loveseat', 'Loveseat', 40),
        ('living_room', 'accent_chair', 'Accent Chair', 50),
        ('living_room', 'lounge_chair', 'Lounge Chair', 60),
        ('living_room', 'swivel_chair', 'Swivel Chair', 70),
        ('living_room', 'recliner', 'Recliner', 80),
        ('living_room', 'coffee_table', 'Coffee Table', 90),
        ('living_room', 'side_end_table', 'Side / End Table', 100),
        ('living_room', 'console_table', 'Console Table', 110),

        -- Dining
        ('dining_room', 'dining_table', 'Dining Table', 10),
        ('dining_room', 'dining_chair', 'Dining Chair', 20),
        ('dining_room', 'bar_counter_stool', 'Bar / Counter Stool', 30),

        -- Bedroom
        ('bedroom', 'bed_frame', 'Bed Frame', 10),
        ('bedroom', 'nightstand', 'Nightstand', 20),
        ('bedroom', 'dresser', 'Dresser', 30),
        ('bedroom', 'bench', 'Bench', 40),

        -- Home office
        ('home_office', 'desk', 'Desk', 10),
        ('home_office', 'office_chair', 'Office Chair', 20),

        -- Storage
        ('storage', 'bookcase_shelving', 'Bookcase / Shelving', 10),
        ('storage', 'cabinet', 'Cabinet', 20),
        ('storage', 'media_console', 'Media Console', 30),

        -- Rugs
        ('rugs', 'area_rug', 'Area Rug', 10),

        -- Lighting
        ('lighting', 'floor_lamp', 'Floor Lamp', 10),
        ('lighting', 'table_lamp', 'Table Lamp', 20),
        ('lighting', 'pendant_chandelier', 'Pendant / Chandelier', 30),

        -- Decor
        ('decor', 'mirror', 'Mirror', 10)
)

insert into public.catalog_furniture_types
    (
        category_id,
        code,
        display_name,
        sort_order,
        is_active
    )
select
    category.id,
    seed.code,
    seed.display_name,
    seed.sort_order,
    true
from furniture_type_seed seed
join public.catalog_categories category
    on category.code = seed.category_code

on conflict (code) do update
set
    category_id = excluded.category_id,
    display_name = excluded.display_name,
    sort_order = excluded.sort_order,
    is_active = excluded.is_active;


-- ============================================================
-- 3. Minimal global taxonomy aliases
-- ============================================================

with alias_seed(
    furniture_type_code,
    alias_text,
    normalized_alias
) as (
    values
        ('sofa', 'sofa', 'sofa'),
        ('sofa', 'sofas', 'sofas'),
        ('sofa', 'couch', 'couch'),
        ('sofa', 'couches', 'couches'),

        ('sectional_sofa', 'sectional', 'sectional'),
        ('sectional_sofa', 'sectional sofa', 'sectional sofa'),
        ('sectional_sofa', 'sectional sofas', 'sectional sofas'),
        ('sectional_sofa', 'modular sofa', 'modular sofa'),
        ('sectional_sofa', 'modular sofas', 'modular sofas'),

        ('sofa_with_chaise', 'sofa with chaise', 'sofa with chaise'),
        ('sofa_with_chaise', 'sofa w chaise', 'sofa w chaise'),

        ('loveseat', 'loveseat', 'loveseat'),
        ('loveseat', 'loveseats', 'loveseats'),

        ('coffee_table', 'coffee table', 'coffee table'),
        ('side_end_table', 'side table', 'side table'),
        ('side_end_table', 'end table', 'end table'),
        ('console_table', 'console table', 'console table'),

        ('dining_table', 'dining table', 'dining table'),
        ('dining_chair', 'dining chair', 'dining chair'),

        ('bed_frame', 'bed frame', 'bed frame'),
        ('nightstand', 'nightstand', 'nightstand'),
        ('dresser', 'dresser', 'dresser'),

        ('desk', 'desk', 'desk'),
        ('office_chair', 'office chair', 'office chair'),

        ('area_rug', 'area rug', 'area rug'),
        ('floor_lamp', 'floor lamp', 'floor lamp'),
        ('table_lamp', 'table lamp', 'table lamp'),
        ('mirror', 'mirror', 'mirror')
)

insert into public.catalog_taxonomy_aliases
    (
        furniture_type_id,
        alias_text,
        normalized_alias,
        source_scope,
        is_active
    )
select
    furniture_type.id,
    alias.alias_text,
    alias.normalized_alias,
    null,
    true
from alias_seed alias
join public.catalog_furniture_types furniture_type
    on furniture_type.code = alias.furniture_type_code

on conflict (
    normalized_alias,
    (coalesce(source_scope, ''))
)
do update
set
    furniture_type_id = excluded.furniture_type_id,
    alias_text = excluded.alias_text,
    is_active = excluded.is_active;


commit;