-- 20261109143240_payroll_runs.sql  -  Vantro
--
-- How long a week's payroll took: from opening the timesheets to pressing
-- Approve all. One row per company per week.
--
-- WHEN THE CLOCK STARTS
--   The Payroll tab opens on this week by default, so a look on Tuesday would
--   start the clock for an approval on Friday. opened_at is therefore the start
--   of the SITTING: an unapproved week opened again more than four hours after
--   opened_at restarts from then.
--
-- APPROVAL RECORDS, IT DOES NOT LOCK. Nothing here changes hours or pay.
--
-- The open and the approval are functions so each is one atomic step. A double
-- tap on Approve all keeps the first time, and only the first.

begin;

create table if not exists public.payroll_runs (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies(id) on delete cascade,
  week_start     date not null check (extract(isodow from week_start) = 1),
  opened_at      timestamptz not null default now(),
  opened_by      uuid references public.users(id) on delete set null,
  approved_at    timestamptz,
  approved_by    uuid references public.users(id) on delete set null,
  workers_count  integer check (workers_count is null or workers_count > 0),
  minutes_taken  integer check (minutes_taken is null or minutes_taken >= 1),
  constraint payroll_runs_one_per_week unique (company_id, week_start),
  constraint payroll_runs_approved_is_complete check (
    (approved_at is null and workers_count is null and minutes_taken is null)
    or (approved_at is not null and workers_count is not null and minutes_taken is not null)
  )
);

create index if not exists payroll_runs_approved
  on public.payroll_runs (company_id, approved_at) where approved_at is not null;

comment on column public.payroll_runs.opened_at is
  'Start of the sitting. Restarted when an unapproved week is opened more than four hours later.';
comment on column public.payroll_runs.minutes_taken is
  'approved_at minus opened_at, rounded up, at least 1. Time taken, not time saved.';

-- Own company only, superadmin included. superadmin is held by people inside
-- customer companies, so it does not cross companies here. The one cross-company
-- view is the median page, server side, limited to the platform owner.
alter table public.payroll_runs enable row level security;

drop policy if exists payroll_runs_select on public.payroll_runs;
create policy payroll_runs_select on public.payroll_runs
  for select to authenticated
  using (
    exists (
      select 1 from public.users u
       where u.auth_user_id = auth.uid()
         and u.role = any (array['admin'::text, 'superadmin'::text])
         and u.company_id = public.payroll_runs.company_id
    )
  );

revoke all on public.payroll_runs from public, anon, authenticated;
grant select on public.payroll_runs to authenticated;

create or replace function public.payroll_run_open(
  p_company_id uuid,
  p_week_start date,
  p_user_id    uuid
) returns setof public.payroll_runs
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  insert into public.payroll_runs (company_id, week_start, opened_by)
  values (p_company_id, p_week_start, p_user_id)
  on conflict (company_id, week_start) do update
    set opened_at = now(), opened_by = excluded.opened_by
    where public.payroll_runs.approved_at is null
      and public.payroll_runs.opened_at < now() - interval '4 hours';

  return query
    select * from public.payroll_runs
     where company_id = p_company_id and week_start = p_week_start;
end;
$fn$;

create or replace function public.payroll_run_approve(
  p_company_id uuid,
  p_week_start date,
  p_user_id    uuid,
  p_workers    integer
) returns setof public.payroll_runs
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  update public.payroll_runs
     set approved_at = now(),
         approved_by = p_user_id,
         workers_count = p_workers,
         minutes_taken = greatest(1, ceil(extract(epoch from now() - opened_at) / 60)::integer)
   where company_id = p_company_id
     and week_start = p_week_start
     and approved_at is null;

  return query
    select * from public.payroll_runs
     where company_id = p_company_id and week_start = p_week_start;
end;
$fn$;

revoke all on function public.payroll_run_open(uuid, date, uuid) from public, anon, authenticated;
revoke all on function public.payroll_run_approve(uuid, date, uuid, integer) from public, anon, authenticated;
grant execute on function public.payroll_run_open(uuid, date, uuid) to service_role;
grant execute on function public.payroll_run_approve(uuid, date, uuid, integer) to service_role;

commit;

notify pgrst, 'reload schema';
