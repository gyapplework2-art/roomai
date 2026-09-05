create table public.profiles (
	id uuid primary key references auth.users(id) on delete cascade,
	display_name text,
	preferred_units text not null default 'imperial',
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	constraint profiles_preferred_units_check check (preferred_units in ('imperial', 'metric'))
);

create table public.projects (
	id uuid primary key default gen_random_uuid(),
	user_id uuid not null references auth.users(id) on delete cascade,
	name text not null,
	room_type text not null,
	status text not null default 'draft',
	width_cm numeric not null,
	length_cm numeric not null,
	height_cm numeric,
	currency char(3) not null default 'USD',
	budget_min numeric,
	budget_max numeric,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	constraint projects_room_type_check check (room_type in (
		'living_room', 'bedroom', 'kitchen', 'bathroom', 'dining_room',
		'home_office', 'family_room', 'guest_room', 'kids_room', 'nursery',
		'entryway', 'basement', 'other'
	)),
	constraint projects_status_check check (status in (
		'draft', 'ready', 'generating', 'generated', 'failed', 'archived'
	)),
	constraint projects_width_cm_check check (width_cm > 0),
	constraint projects_length_cm_check check (length_cm > 0),
	constraint projects_height_cm_check check (height_cm is null or height_cm > 0),
	constraint projects_budget_min_check check (budget_min is null or budget_min >= 0),
	constraint projects_budget_max_check check (budget_max is null or budget_max >= 0),
	constraint projects_budget_range_check check (
		budget_min is null or budget_max is null or budget_max >= budget_min
	)
);

create table public.room_preferences (
	id uuid primary key default gen_random_uuid(),
	project_id uuid not null unique references public.projects(id) on delete cascade,
	primary_style text,
	secondary_style text,
	color_mood text,
	primary_color text,
	secondary_color text,
	accent_color text,
	metal_color text,
	preferred_materials jsonb not null default '{}'::jsonb,
	avoid_materials jsonb not null default '{}'::jsonb,
	room_functions jsonb not null default '[]'::jsonb,
	must_have_items jsonb not null default '[]'::jsonb,
	nice_to_have_items jsonb not null default '[]'::jsonb,
	household_size text,
	special_requirements jsonb not null default '[]'::jsonb,
	additional_notes text,
	priority text,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	constraint room_preferences_color_mood_check check (
		color_mood is null or color_mood in ('light', 'warm', 'dark', 'neutral', 'colorful')
	),
	constraint room_preferences_priority_check check (
		priority is null or priority in ('lowest_price', 'best_value', 'design_quality', 'premium_quality')
	)
);

create table public.designs (
	id uuid primary key default gen_random_uuid(),
	project_id uuid not null references public.projects(id) on delete cascade,
	version integer not null,
	status text not null default 'draft',
	design_name text,
	summary text,
	design_specification jsonb,
	model_provider text,
	model_name text,
	prompt_version text,
	generation_started_at timestamptz,
	generation_completed_at timestamptz,
	created_at timestamptz not null default now(),
	constraint designs_version_check check (version > 0),
	constraint designs_status_check check (status in ('draft', 'generating', 'generated', 'failed')),
	constraint designs_project_version_unique unique (project_id, version)
);

create table public.design_objects (
	id uuid primary key default gen_random_uuid(),
	design_id uuid not null references public.designs(id) on delete cascade,
	object_type text not null,
	category text,
	name text,
	x_cm numeric,
	y_cm numeric,
	z_cm numeric,
	width_cm numeric,
	depth_cm numeric,
	height_cm numeric,
	rotation_degrees numeric not null default 0,
	material text,
	primary_color text,
	product_id uuid,
	reasoning text,
	created_at timestamptz not null default now(),
	constraint design_objects_width_cm_check check (width_cm is null or width_cm > 0),
	constraint design_objects_depth_cm_check check (depth_cm is null or depth_cm > 0),
	constraint design_objects_height_cm_check check (height_cm is null or height_cm > 0)
);

create index projects_user_id_idx on public.projects (user_id);
create index projects_user_id_created_at_idx on public.projects (user_id, created_at desc);
create index designs_project_id_idx on public.designs (project_id);
create index design_objects_design_id_idx on public.design_objects (design_id);

alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.room_preferences enable row level security;
alter table public.designs enable row level security;
alter table public.design_objects enable row level security;

create policy profiles_select_authenticated on public.profiles
	for select to authenticated
	using (id = auth.uid());

create policy profiles_insert_authenticated on public.profiles
	for insert to authenticated
	with check (id = auth.uid());

create policy profiles_update_authenticated on public.profiles
	for update to authenticated
	using (id = auth.uid())
	with check (id = auth.uid());

create policy profiles_delete_authenticated on public.profiles
	for delete to authenticated
	using (id = auth.uid());

create policy projects_select_authenticated on public.projects
	for select to authenticated
	using (user_id = auth.uid());

create policy projects_insert_authenticated on public.projects
	for insert to authenticated
	with check (user_id = auth.uid());

create policy projects_update_authenticated on public.projects
	for update to authenticated
	using (user_id = auth.uid())
	with check (user_id = auth.uid());

create policy projects_delete_authenticated on public.projects
	for delete to authenticated
	using (user_id = auth.uid());

create policy room_preferences_select_authenticated on public.room_preferences
	for select to authenticated
	using (
		exists (
			select 1
			from public.projects
			where projects.id = room_preferences.project_id
				and projects.user_id = auth.uid()
		)
	);

create policy room_preferences_insert_authenticated on public.room_preferences
	for insert to authenticated
	with check (
		exists (
			select 1
			from public.projects
			where projects.id = room_preferences.project_id
				and projects.user_id = auth.uid()
		)
	);

create policy room_preferences_update_authenticated on public.room_preferences
	for update to authenticated
	using (
		exists (
			select 1
			from public.projects
			where projects.id = room_preferences.project_id
				and projects.user_id = auth.uid()
		)
	)
	with check (
		exists (
			select 1
			from public.projects
			where projects.id = room_preferences.project_id
				and projects.user_id = auth.uid()
		)
	);

create policy room_preferences_delete_authenticated on public.room_preferences
	for delete to authenticated
	using (
		exists (
			select 1
			from public.projects
			where projects.id = room_preferences.project_id
				and projects.user_id = auth.uid()
		)
	);

create policy designs_select_authenticated on public.designs
	for select to authenticated
	using (
		exists (
			select 1
			from public.projects
			where projects.id = designs.project_id
				and projects.user_id = auth.uid()
		)
	);

create policy designs_insert_authenticated on public.designs
	for insert to authenticated
	with check (
		exists (
			select 1
			from public.projects
			where projects.id = designs.project_id
				and projects.user_id = auth.uid()
		)
	);

create policy designs_update_authenticated on public.designs
	for update to authenticated
	using (
		exists (
			select 1
			from public.projects
			where projects.id = designs.project_id
				and projects.user_id = auth.uid()
		)
	)
	with check (
		exists (
			select 1
			from public.projects
			where projects.id = designs.project_id
				and projects.user_id = auth.uid()
		)
	);

create policy designs_delete_authenticated on public.designs
	for delete to authenticated
	using (
		exists (
			select 1
			from public.projects
			where projects.id = designs.project_id
				and projects.user_id = auth.uid()
		)
	);

create policy design_objects_select_authenticated on public.design_objects
	for select to authenticated
	using (
		exists (
			select 1
			from public.designs
			join public.projects on projects.id = designs.project_id
			where designs.id = design_objects.design_id
				and projects.user_id = auth.uid()
		)
	);

create policy design_objects_insert_authenticated on public.design_objects
	for insert to authenticated
	with check (
		exists (
			select 1
			from public.designs
			join public.projects on projects.id = designs.project_id
			where designs.id = design_objects.design_id
				and projects.user_id = auth.uid()
		)
	);

create policy design_objects_update_authenticated on public.design_objects
	for update to authenticated
	using (
		exists (
			select 1
			from public.designs
			join public.projects on projects.id = designs.project_id
			where designs.id = design_objects.design_id
				and projects.user_id = auth.uid()
		)
	)
	with check (
		exists (
			select 1
			from public.designs
			join public.projects on projects.id = designs.project_id
			where designs.id = design_objects.design_id
				and projects.user_id = auth.uid()
		)
	);

create policy design_objects_delete_authenticated on public.design_objects
	for delete to authenticated
	using (
		exists (
			select 1
			from public.designs
			join public.projects on projects.id = designs.project_id
			where designs.id = design_objects.design_id
				and projects.user_id = auth.uid()
		)
	);
