-- 20261109160000_payroll_week_lock.sql  -  Vantro
--
-- Approve all locks the week.
--
-- WHERE THE LOCK LIVES. Eleven routes write to signins, so a trigger holds it
-- rather than a check in each. Nothing can be inserted into, moved into, or
-- edited inside an approved week. Only the columns pay depends on are guarded:
-- flags and export stamps can still change, and DELETE is not guarded, so
-- retention purges and account deletion keep working. The one route that
-- deletes live shifts, job delete, checks for itself.
--
-- A WEEK CAN ONLY BE APPROVED ONCE IT HAS ENDED, with nobody still signed in.
-- That is what guarantees a worker signing in on site never meets this lock:
-- a sign-in is always in the current week, and the current week cannot be
-- approved.
--
-- RATES. Hourly rates and pay rules are not per week, so they cannot be locked
-- by week. Approval freezes the built Xero timesheet in xero_snapshot instead,
-- and the export serves that.
--
-- Unlocking clears the approval and the frozen timesheet and writes to
-- audit_log with a required reason. minutes_taken survives: the median measures
-- the original sitting, not a correction made later.

begin;

alter table public.payroll_runs add column if not exists xero_snapshot jsonb;

-- ERASURE. The frozen timesheet holds names and emails. When a worker's data is
-- erased, every approved week they worked has its snapshot cleared (see
-- clearSnapshotsForWorker in lib/payroll-timesheet.ts). The week stays approved
-- and locked; these two columns say why its file is gone, so the export can say
-- so instead of blaming an old approval. Approving again rebuilds the file from
-- the anonymised record.
alter table public.payroll_runs add column if not exists xero_snapshot_cleared_at timestamptz;
alter table public.payroll_runs add column if not exists xero_snapshot_cleared_reason text;
alter table public.payroll_runs drop constraint if exists payroll_runs_snapshot_cleared_reason;
alter table public.payroll_runs add constraint payroll_runs_snapshot_cleared_reason check (
  xero_snapshot_cleared_reason is null or xero_snapshot_cleared_reason in ('erasure')
);

alter table public.payroll_runs drop constraint if exists payroll_runs_approved_is_complete;
alter table public.payroll_runs add constraint payroll_runs_approved_is_complete check (
  approved_at is null or (workers_count is not null and minutes_taken is not null)
);

comment on column public.payroll_runs.xero_snapshot is
  'The Xero timesheet as built at approval. Holds names, emails and pay, so it is admin only.';

create or replace function public.payroll_week_locked(p_company_id uuid, p_at timestamptz)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select exists (
    select 1 from public.payroll_runs r
     where r.company_id = p_company_id
       and r.approved_at is not null
       and r.week_start = date_trunc('week', p_at at time zone 'Europe/London')::date
  );
$fn$;

create or replace function public.signins_payroll_lock()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  if tg_op = 'UPDATE'
     and new.signed_in_at  is not distinct from old.signed_in_at
     and new.signed_out_at is not distinct from old.signed_out_at
     and new.hours_worked  is not distinct from old.hours_worked
     and new.user_id       is not distinct from old.user_id then
    return new;
  end if;

  if (tg_op = 'UPDATE' and public.payroll_week_locked(old.company_id, old.signed_in_at))
     or public.payroll_week_locked(new.company_id, new.signed_in_at) then
    raise exception 'That week is approved. Unlock it on the Payroll tab to change it.'
      using errcode = 'VT423';
  end if;
  return new;
end;
$fn$;

drop trigger if exists signins_payroll_week_lock on public.signins;
create trigger signins_payroll_week_lock
  before insert or update on public.signins
  for each row execute function public.signins_payroll_lock();

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
declare
  r public.payroll_runs%rowtype;
begin
  select * into r from public.payroll_runs
   where company_id = p_company_id and week_start = p_week_start
   for update;

  if r.id is null then return; end if;
  if r.approved_at is not null then return next r; return; end if;

  if p_week_start + 7 > (now() at time zone 'Europe/London')::date then
    raise exception 'A week can be approved once it has ended.' using errcode = 'VT425';
  end if;

  if exists (
    select 1 from public.signins s
     where s.company_id = p_company_id
       and s.signed_out_at is null
       and s.signed_in_at >= (p_week_start::timestamp at time zone 'Europe/London')
       and s.signed_in_at <  ((p_week_start + 7)::timestamp at time zone 'Europe/London')
  ) then
    raise exception 'Someone is still signed in on a shift in that week. Sign them out first.'
      using errcode = 'VT426';
  end if;

  update public.payroll_runs
     set approved_at = now(),
         approved_by = p_user_id,
         workers_count = p_workers,
         minutes_taken = coalesce(minutes_taken, greatest(1, ceil(extract(epoch from now() - opened_at) / 60)::integer))
   where id = r.id
   returning * into r;

  insert into public.audit_log (company_id, user_id, action, entity_type, entity_id, details)
  values (p_company_id, p_user_id, 'payroll_week_approved', 'payroll_runs', r.id,
          jsonb_build_object('week_start', p_week_start, 'workers', p_workers, 'minutes_taken', r.minutes_taken));

  return next r;
end;
$fn$;

create or replace function public.payroll_run_unlock(
  p_company_id uuid,
  p_week_start date,
  p_user_id    uuid,
  p_reason     text
) returns setof public.payroll_runs
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  r public.payroll_runs%rowtype;
  was timestamptz;
begin
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason is required to unlock a week.' using errcode = '22023';
  end if;

  select * into r from public.payroll_runs
   where company_id = p_company_id and week_start = p_week_start
   for update;

  if r.id is null or r.approved_at is null then
    if r.id is not null then return next r; end if;
    return;
  end if;

  was := r.approved_at;

  update public.payroll_runs
     set approved_at = null, approved_by = null, workers_count = null, xero_snapshot = null,
         xero_snapshot_cleared_at = null, xero_snapshot_cleared_reason = null
   where id = r.id
   returning * into r;

  insert into public.audit_log (company_id, user_id, action, entity_type, entity_id, details)
  values (p_company_id, p_user_id, 'payroll_week_unlocked', 'payroll_runs', r.id,
          jsonb_build_object('week_start', p_week_start, 'reason', left(trim(p_reason), 2000), 'approved_at', was));

  return next r;
end;
$fn$;

revoke all on function public.payroll_week_locked(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.payroll_run_unlock(uuid, date, uuid, text) from public, anon, authenticated;
grant execute on function public.payroll_week_locked(uuid, timestamptz) to service_role;
grant execute on function public.payroll_run_unlock(uuid, date, uuid, text) to service_role;
-- Restated rather than inherited from 20261109143240: create or replace keeps
-- the old grants, but nothing here should depend on that being true.
revoke all on function public.payroll_run_approve(uuid, date, uuid, integer) from public, anon, authenticated;
grant execute on function public.payroll_run_approve(uuid, date, uuid, integer) to service_role;

commit;

notify pgrst, 'reload schema';
