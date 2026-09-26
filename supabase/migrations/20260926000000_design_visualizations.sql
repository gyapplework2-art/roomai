create table public.design_visualizations (
  id uuid primary key default gen_random_uuid(),
  design_id uuid not null references public.designs(id) on delete cascade,
  status text not null default 'generating' check (status in ('generating', 'generated', 'failed')),
  storage_bucket text,
  storage_path text,
  model_provider text,
  model_name text,
  prompt_version text,
  generation_started_at timestamptz not null default now(),
  generation_completed_at timestamptz,
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  check (
    status <> 'generated'
    or (storage_bucket is not null and storage_path is not null and generation_completed_at is not null)
  )
);

create index design_visualizations_design_created_idx
  on public.design_visualizations (design_id, created_at desc);

create index design_visualizations_latest_generated_idx
  on public.design_visualizations (design_id, generation_completed_at desc)
  where status = 'generated';

alter table public.design_visualizations enable row level security;

create policy design_visualizations_select_authenticated on public.design_visualizations
  for select to authenticated
  using (
    exists (
      select 1
      from public.designs
      join public.projects on projects.id = designs.project_id
      where designs.id = design_visualizations.design_id
        and projects.user_id = auth.uid()
    )
  );

create policy design_visualizations_insert_authenticated on public.design_visualizations
  for insert to authenticated
  with check (
    exists (
      select 1
      from public.designs
      join public.projects on projects.id = designs.project_id
      where designs.id = design_visualizations.design_id
        and projects.user_id = auth.uid()
    )
  );

create policy design_visualizations_update_authenticated on public.design_visualizations
  for update to authenticated
  using (
    exists (
      select 1
      from public.designs
      join public.projects on projects.id = designs.project_id
      where designs.id = design_visualizations.design_id
        and projects.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.designs
      join public.projects on projects.id = designs.project_id
      where designs.id = design_visualizations.design_id
        and projects.user_id = auth.uid()
    )
  );

create policy design_visualizations_delete_authenticated on public.design_visualizations
  for delete to authenticated
  using (
    exists (
      select 1
      from public.designs
      join public.projects on projects.id = designs.project_id
      where designs.id = design_visualizations.design_id
        and projects.user_id = auth.uid()
    )
  );

insert into storage.buckets (id, name, public)
values ('design-visualizations', 'design-visualizations', false)
on conflict (id) do update set public = false;

create policy design_visualizations_storage_select_authenticated on storage.objects
  for select to authenticated
  using (
    bucket_id = 'design-visualizations'
    and (storage.foldername(name))[1] = auth.uid()::text
    and exists (
      select 1
      from public.designs
      join public.projects on projects.id = designs.project_id
      where designs.id::text = (storage.foldername(name))[3]
        and projects.id::text = (storage.foldername(name))[2]
        and projects.user_id = auth.uid()
    )
  );

create policy design_visualizations_storage_insert_authenticated on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'design-visualizations'
    and (storage.foldername(name))[1] = auth.uid()::text
    and exists (
      select 1
      from public.designs
      join public.projects on projects.id = designs.project_id
      where designs.id::text = (storage.foldername(name))[3]
        and projects.id::text = (storage.foldername(name))[2]
        and projects.user_id = auth.uid()
    )
  );

create policy design_visualizations_storage_delete_authenticated on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'design-visualizations'
    and (storage.foldername(name))[1] = auth.uid()::text
    and exists (
      select 1
      from public.designs
      join public.projects on projects.id = designs.project_id
      where designs.id::text = (storage.foldername(name))[3]
        and projects.id::text = (storage.foldername(name))[2]
        and projects.user_id = auth.uid()
    )
  );
