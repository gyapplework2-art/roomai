create table public.room_geometries (
	id uuid primary key default gen_random_uuid(),
	project_id uuid not null unique references public.projects(id) on delete cascade,
	schema_version text not null default '1.0',
	shape_type text not null,
	template_rotation_degrees integer not null default 0,
	template_mirrored_horizontal boolean not null default false,
	template_mirrored_vertical boolean not null default false,
	vertices jsonb not null,
	wall_segments jsonb not null,
	ceiling_height_cm numeric,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	constraint room_geometries_schema_version_check check (schema_version = '1.0'),
	constraint room_geometries_shape_type_check check (shape_type in (
		'rectangle', 'l_shape', 'clipped_corner', 't_shape', 'u_shape', 'stepped'
	)),
	constraint room_geometries_template_rotation_check check (
		template_rotation_degrees in (0, 90, 180, 270)
	),
	constraint room_geometries_ceiling_height_check check (
		ceiling_height_cm is null or ceiling_height_cm > 0
	)
);

create table public.room_openings (
	id uuid primary key default gen_random_uuid(),
	room_geometry_id uuid not null references public.room_geometries(id) on delete cascade,
	opening_type text not null,
	wall_segment_id text not null,
	offset_cm numeric not null,
	width_cm numeric not null,
	height_cm numeric not null,
	sill_height_cm numeric,
	hinge_side text,
	swing_direction text,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	constraint room_openings_type_check check (opening_type in ('door', 'window')),
	constraint room_openings_offset_check check (offset_cm >= 0),
	constraint room_openings_width_check check (width_cm > 0),
	constraint room_openings_height_check check (height_cm > 0),
	constraint room_openings_sill_height_check check (
		sill_height_cm is null or sill_height_cm >= 0
	),
	constraint room_openings_hinge_side_check check (
		hinge_side is null or hinge_side in ('left', 'right')
	),
	constraint room_openings_swing_direction_check check (
		swing_direction is null or swing_direction in ('inward', 'outward')
	)
);

create index room_openings_room_geometry_id_idx
	on public.room_openings (room_geometry_id);

alter table public.room_geometries enable row level security;
alter table public.room_openings enable row level security;

create policy room_geometries_select_authenticated on public.room_geometries
	for select to authenticated
	using (
		exists (
			select 1
			from public.projects
			where projects.id = room_geometries.project_id
				and projects.user_id = auth.uid()
		)
	);

create policy room_geometries_insert_authenticated on public.room_geometries
	for insert to authenticated
	with check (
		exists (
			select 1
			from public.projects
			where projects.id = room_geometries.project_id
				and projects.user_id = auth.uid()
		)
	);

create policy room_geometries_update_authenticated on public.room_geometries
	for update to authenticated
	using (
		exists (
			select 1
			from public.projects
			where projects.id = room_geometries.project_id
				and projects.user_id = auth.uid()
		)
	)
	with check (
		exists (
			select 1
			from public.projects
			where projects.id = room_geometries.project_id
				and projects.user_id = auth.uid()
		)
	);

create policy room_geometries_delete_authenticated on public.room_geometries
	for delete to authenticated
	using (
		exists (
			select 1
			from public.projects
			where projects.id = room_geometries.project_id
				and projects.user_id = auth.uid()
		)
	);

create policy room_openings_select_authenticated on public.room_openings
	for select to authenticated
	using (
		exists (
			select 1
			from public.room_geometries
			join public.projects on projects.id = room_geometries.project_id
			where room_geometries.id = room_openings.room_geometry_id
				and projects.user_id = auth.uid()
		)
	);

create policy room_openings_insert_authenticated on public.room_openings
	for insert to authenticated
	with check (
		exists (
			select 1
			from public.room_geometries
			join public.projects on projects.id = room_geometries.project_id
			where room_geometries.id = room_openings.room_geometry_id
				and projects.user_id = auth.uid()
		)
	);

create policy room_openings_update_authenticated on public.room_openings
	for update to authenticated
	using (
		exists (
			select 1
			from public.room_geometries
			join public.projects on projects.id = room_geometries.project_id
			where room_geometries.id = room_openings.room_geometry_id
				and projects.user_id = auth.uid()
		)
	)
	with check (
		exists (
			select 1
			from public.room_geometries
			join public.projects on projects.id = room_geometries.project_id
			where room_geometries.id = room_openings.room_geometry_id
				and projects.user_id = auth.uid()
		)
	);

create policy room_openings_delete_authenticated on public.room_openings
	for delete to authenticated
	using (
		exists (
			select 1
			from public.room_geometries
			join public.projects on projects.id = room_geometries.project_id
			where room_geometries.id = room_openings.room_geometry_id
				and projects.user_id = auth.uid()
		)
	);
