-- Vantro expense receipts - schema migration
-- Run in Supabase SQL Editor: https://supabase.com/dashboard/project/lmobuqxmtkctqqwbspoz/sql
-- Date: 19 May 2026

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  user_id uuid not null,
  job_id uuid,
  amount numeric(10, 2) not null,
  vat_amount numeric(10, 2),
  category text not null default 'other',
  note text,
  receipt_url text not null,
  receipt_mime text not null default 'image/jpeg',
  status text not null default 'submitted',
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid,
  review_note text,
  paid_at timestamptz,
  paid_in_week_starting date,
  created_at timestamptz not null default now()
);

-- Indexes for common queries
create index if not exists idx_expenses_company_user_week
  on public.expenses (company_id, user_id, submitted_at desc);

create index if not exists idx_expenses_company_status
  on public.expenses (company_id, status, submitted_at desc);

create index if not exists idx_expenses_job
  on public.expenses (job_id) where job_id is not null;

-- Status check constraint
alter table public.expenses
  drop constraint if exists expenses_status_check;
alter table public.expenses
  add constraint expenses_status_check
  check (status in ('submitted', 'approved', 'rejected', 'queried', 'paid'));

-- Category check constraint
alter table public.expenses
  drop constraint if exists expenses_category_check;
alter table public.expenses
  add constraint expenses_category_check
  check (category in ('fuel', 'materials', 'food', 'parking', 'tools', 'other'));

-- RLS
alter table public.expenses enable row level security;

-- Installers see their own expenses only
drop policy if exists expenses_installer_select on public.expenses;
create policy expenses_installer_select on public.expenses
  for select
  using (
    user_id in (select id from public.users where auth_user_id = auth.uid())
  );

-- Admins/foremen/superadmin see all expenses on their company
drop policy if exists expenses_admin_select on public.expenses;
create policy expenses_admin_select on public.expenses
  for select
  using (
    company_id in (
      select company_id from public.users
      where auth_user_id = auth.uid()
        and role = any (array['admin', 'foreman', 'superadmin'])
    )
  );

-- Installers can insert their own expenses
drop policy if exists expenses_installer_insert on public.expenses;
create policy expenses_installer_insert on public.expenses
  for insert
  with check (
    user_id in (select id from public.users where auth_user_id = auth.uid())
  );

-- Admins can update status (review, approve, reject, pay)
drop policy if exists expenses_admin_update on public.expenses;
create policy expenses_admin_update on public.expenses
  for update
  using (
    company_id in (
      select company_id from public.users
      where auth_user_id = auth.uid()
        and role = any (array['admin', 'foreman', 'superadmin'])
    )
  );

-- Verify after running:
-- select column_name, data_type from information_schema.columns
-- where table_name = 'expenses' order by ordinal_position;
--
-- select policyname, cmd, qual from pg_policies where tablename = 'expenses';
