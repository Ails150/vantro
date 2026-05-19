-- Vantro subcontractors Day 1 - schema migration
-- Run in Supabase SQL Editor: https://supabase.com/dashboard/project/lmobuqxmtkctqqwbspoz/sql
-- Date: 19 May 2026

-- 1. subcontractors table
create table if not exists public.subcontractors (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  name text not null,
  contact_name text,
  contact_phone text,
  contact_email text,
  address text,
  rate_type text not null default 'daily',
  rate_amount numeric(10, 2),
  rate_currency text not null default 'GBP',
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid
);

create index if not exists idx_subcontractors_company_active
  on public.subcontractors (company_id, active, name);

alter table public.subcontractors
  drop constraint if exists subcontractors_rate_type_check;
alter table public.subcontractors
  add constraint subcontractors_rate_type_check
  check (rate_type in ('hourly', 'daily', 'weekly', 'monthly', 'per_job'));

-- 2. subcontractor_assignments table
create table if not exists public.subcontractor_assignments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  subcontractor_id uuid not null references public.subcontractors(id) on delete cascade,
  job_id uuid not null,
  expected_crew_size integer,
  expected_days integer,
  notes text,
  status text not null default 'active',
  assigned_by uuid,
  assigned_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists idx_sub_assignments_company_status
  on public.subcontractor_assignments (company_id, status, assigned_at desc);
create index if not exists idx_sub_assignments_subcontractor
  on public.subcontractor_assignments (subcontractor_id, status);
create index if not exists idx_sub_assignments_job
  on public.subcontractor_assignments (job_id, status);

alter table public.subcontractor_assignments
  drop constraint if exists sub_assignments_status_check;
alter table public.subcontractor_assignments
  add constraint sub_assignments_status_check
  check (status in ('active', 'completed', 'cancelled'));

-- 3. users.subcontractor_id (soft link, nullable)
alter table public.users
  add column if not exists subcontractor_id uuid references public.subcontractors(id) on delete set null;

create index if not exists idx_users_subcontractor
  on public.users (subcontractor_id) where subcontractor_id is not null;

-- 4. signins.crew_headcount
alter table public.signins
  add column if not exists crew_headcount integer not null default 1;

alter table public.signins
  drop constraint if exists signins_crew_headcount_check;
alter table public.signins
  add constraint signins_crew_headcount_check
  check (crew_headcount >= 1 and crew_headcount <= 50);

-- 5. RLS - subcontractors
alter table public.subcontractors enable row level security;

drop policy if exists subcontractors_admin_select on public.subcontractors;
create policy subcontractors_admin_select on public.subcontractors
  for select
  using (
    company_id in (
      select company_id from public.users
      where auth_user_id = auth.uid()
        and role = any (array['admin', 'foreman', 'superadmin'])
    )
  );

drop policy if exists subcontractors_admin_write on public.subcontractors;
create policy subcontractors_admin_write on public.subcontractors
  for all
  using (
    company_id in (
      select company_id from public.users
      where auth_user_id = auth.uid()
        and role = any (array['admin', 'foreman', 'superadmin'])
    )
  );

-- Crew leads can see their own subcontractor row
drop policy if exists subcontractors_crew_lead_select on public.subcontractors;
create policy subcontractors_crew_lead_select on public.subcontractors
  for select
  using (
    id in (select subcontractor_id from public.users where auth_user_id = auth.uid())
  );

-- 6. RLS - subcontractor_assignments
alter table public.subcontractor_assignments enable row level security;

drop policy if exists sub_assignments_admin_all on public.subcontractor_assignments;
create policy sub_assignments_admin_all on public.subcontractor_assignments
  for all
  using (
    company_id in (
      select company_id from public.users
      where auth_user_id = auth.uid()
        and role = any (array['admin', 'foreman', 'superadmin'])
    )
  );

-- Crew leads can see assignments for their subcontractor
drop policy if exists sub_assignments_crew_lead_select on public.subcontractor_assignments;
create policy sub_assignments_crew_lead_select on public.subcontractor_assignments
  for select
  using (
    subcontractor_id in (select subcontractor_id from public.users where auth_user_id = auth.uid())
  );

-- 7. updated_at trigger for subcontractors
create or replace function public.touch_subcontractor_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists subcontractors_touch_updated_at on public.subcontractors;
create trigger subcontractors_touch_updated_at
  before update on public.subcontractors
  for each row execute function public.touch_subcontractor_updated_at();

-- Verify after running:
-- select count(*) from public.subcontractors;  -- expect 0
-- select count(*) from public.subcontractor_assignments;  -- expect 0
-- select column_name from information_schema.columns where table_name = 'users' and column_name = 'subcontractor_id';
-- select column_name from information_schema.columns where table_name = 'signins' and column_name = 'crew_headcount';
-- select tablename, policyname from pg_policies where tablename in ('subcontractors', 'subcontractor_assignments') order by tablename, policyname;
