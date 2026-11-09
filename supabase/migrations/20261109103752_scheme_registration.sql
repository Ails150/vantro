-- 20261109103752_scheme_registration.sql  -  Vantro
--
-- Competent person scheme registration (Certass and FENSA).
--
-- WHAT STOPS A JOB BEING REGISTERED TWICE
--   1. claim_scheme_registration moves a job to 'registering' under a row lock.
--      Two sign-offs at the same moment: one gets the claim, one does not.
--   2. scheme_registrations has one row per job, by unique constraint.
--   3. A call whose outcome we cannot know (a timeout, a process that died
--      mid-request) goes to 'unknown', NOT 'failed'. The scheme may have
--      accepted it. It can only be retried once a person has checked the
--      scheme's portal and said it is not there.
--
-- WHAT IS HASHED
--   The scheme_registrations row, on insert, by the existing trigger. It is a
--   snapshot of what was registered and the number that came back. It holds no
--   homeowner name or email: an evidence hash cannot be erased, and a homeowner
--   can ask to be.

begin;

-- ---------------------------------------------------------------------------
-- 1. Scheme connections
-- ---------------------------------------------------------------------------
create table if not exists public.scheme_connections (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies(id) on delete cascade,
  scheme             text not null check (scheme in ('certass', 'fensa')),
  api_key_encrypted  text not null check (api_key_encrypted like 'v1:%'),
  api_key_last4      text not null check (char_length(api_key_last4) <= 4),
  member_number      text not null check (char_length(trim(member_number)) between 1 and 64),
  active             boolean not null default false,
  validated_at       timestamptz,
  created_by         uuid references public.users(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint scheme_connections_one_per_scheme unique (company_id, scheme),
  constraint scheme_connections_active_needs_validation
    check (not active or validated_at is not null)
);

comment on column public.scheme_connections.api_key_encrypted is
  'AES-256-GCM, sealed by lib/secret-box.ts. Never selectable by a browser session, even in this form.';

alter table public.scheme_connections enable row level security;

drop policy if exists scheme_connections_select on public.scheme_connections;
create policy scheme_connections_select on public.scheme_connections
  for select to authenticated
  using (
    exists (
      select 1 from public.users u
       where u.auth_user_id = auth.uid()
         and u.role = any (array['admin'::text, 'superadmin'::text])
         and (u.role = 'superadmin'::text or u.company_id = public.scheme_connections.company_id)
    )
  );

-- RLS decides which rows; these grants decide which columns. Writes go through
-- a server route, so a browser session has no write grant at all, and the
-- sealed key is outside the column list.
revoke all on public.scheme_connections from public, anon, authenticated;
grant select (id, company_id, scheme, api_key_last4, member_number, active,
              validated_at, created_at, updated_at)
  on public.scheme_connections to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Job fields
-- ---------------------------------------------------------------------------
alter table public.jobs
  add column if not exists notifiable                   boolean not null default false,
  add column if not exists scheme                       text,
  add column if not exists property_address             text,
  add column if not exists work_type                    text,
  add column if not exists windows_count                integer,
  add column if not exists doors_count                  integer,
  add column if not exists completion_date              date,
  add column if not exists homeowner_name               text,
  add column if not exists homeowner_email              text,
  add column if not exists certificate_number           text,
  add column if not exists registration_status          text not null default 'not_required',
  add column if not exists registration_error           text,
  add column if not exists registration_attempts        integer not null default 0,
  add column if not exists registration_attempted_at    timestamptz,
  add column if not exists registered_at                timestamptz,
  add column if not exists registration_environment     text,
  add column if not exists homeowner_email_status       text not null default 'not_sent',
  add column if not exists homeowner_email_error        text,
  add column if not exists homeowner_email_attempted_at timestamptz;

alter table public.jobs drop constraint if exists jobs_scheme_check;
alter table public.jobs add constraint jobs_scheme_check
  check (scheme is null or scheme in ('certass', 'fensa'));

alter table public.jobs drop constraint if exists jobs_registration_status_check;
alter table public.jobs add constraint jobs_registration_status_check
  check (registration_status in
    ('not_required', 'pending', 'registering', 'registered', 'failed', 'unknown'));

alter table public.jobs drop constraint if exists jobs_registration_environment_check;
alter table public.jobs add constraint jobs_registration_environment_check
  check (registration_environment is null or registration_environment in ('simulator', 'live'));

alter table public.jobs drop constraint if exists jobs_homeowner_email_status_check;
alter table public.jobs add constraint jobs_homeowner_email_status_check
  check (homeowner_email_status in ('not_sent', 'sending', 'sent', 'failed', 'skipped_simulator'));

alter table public.jobs drop constraint if exists jobs_scheme_counts_check;
alter table public.jobs add constraint jobs_scheme_counts_check
  check ((windows_count is null or windows_count between 0 and 999)
     and (doors_count is null or doors_count between 0 and 999));

comment on column public.jobs.registration_status is
  'not_required, pending, registering, registered, failed (the scheme definitely did not accept it, safe to retry), unknown (it may have; check the portal before retrying).';

-- Today's list reads this; only jobs that opted in are in it.
create index if not exists jobs_scheme_attention
  on public.jobs (company_id, registration_status)
  where notifiable;

-- A certificate number, once written, is what was registered.
create or replace function public.jobs_certificate_write_once()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $fn$
begin
  if old.certificate_number is not null
     and new.certificate_number is distinct from old.certificate_number then
    raise exception 'job % already has certificate %; it cannot be changed', old.id, old.certificate_number
      using errcode = 'integrity_constraint_violation';
  end if;
  return new;
end;
$fn$;

drop trigger if exists jobs_certificate_write_once on public.jobs;
create trigger jobs_certificate_write_once
  before update on public.jobs
  for each row execute function public.jobs_certificate_write_once();

-- ---------------------------------------------------------------------------
-- 3. The registration record
-- ---------------------------------------------------------------------------
create table if not exists public.scheme_registrations (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies(id) on delete cascade,
  job_id             uuid not null references public.jobs(id) on delete cascade,
  scheme             text not null check (scheme in ('certass', 'fensa')),
  environment        text not null check (environment in ('simulator', 'live')),
  certificate_number text not null check (char_length(trim(certificate_number)) between 1 and 128),
  member_number      text not null,
  property_address   text not null,
  work_type          text not null,
  windows_count      integer not null,
  doors_count        integer not null,
  completion_date    date not null,
  registered_by      uuid references public.users(id) on delete set null,
  registered_at      timestamptz not null default now(),
  constraint scheme_registrations_one_per_job unique (job_id)
);

create index if not exists scheme_registrations_company
  on public.scheme_registrations (company_id, registered_at desc);

drop trigger if exists scheme_registrations_evidence_hash on public.scheme_registrations;
create trigger scheme_registrations_evidence_hash
  after insert on public.scheme_registrations
  for each row execute function public.record_evidence_hash('created', '1', 'registered_by');

create or replace function public.reject_scheme_registration_update()
returns trigger
language plpgsql
as $fn$
begin
  raise exception 'scheme_registrations is append-only: % may not be updated', old.id
    using errcode = 'restrict_violation';
end;
$fn$;

drop trigger if exists scheme_registrations_immutable on public.scheme_registrations;
create trigger scheme_registrations_immutable
  before update on public.scheme_registrations
  for each row execute function public.reject_scheme_registration_update();

-- Server only, as variation_shares is: RLS on and no policy.
alter table public.scheme_registrations enable row level security;

-- ---------------------------------------------------------------------------
-- 4. The claim
-- ---------------------------------------------------------------------------
-- A 'registering' row older than three minutes belongs to a process that died.
-- The scheme may or may not have received the request, so it becomes 'unknown',
-- never 'failed'.
create or replace function public.claim_scheme_registration(
  p_company_id          uuid,
  p_job_id              uuid,
  p_after_manual_check  boolean default false
) returns table (claimed boolean, current_status text)
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  j public.jobs%rowtype;
begin
  select * into j from public.jobs
   where id = p_job_id and company_id = p_company_id
   for update;

  if j.id is null then
    return query select false, 'not_found'::text;
    return;
  end if;

  if j.registration_status = 'registering'
     and j.registration_attempted_at < now() - interval '3 minutes' then
    update public.jobs
       set registration_status = 'unknown',
           registration_error = 'The last attempt did not finish, so the scheme may have received it. Check the scheme portal before retrying.'
     where id = j.id;
    j.registration_status := 'unknown';
  end if;

  if j.registration_status in ('pending', 'failed')
     or (j.registration_status = 'unknown' and p_after_manual_check) then
    update public.jobs
       set registration_status = 'registering',
           registration_error = null,
           registration_attempted_at = now(),
           registration_attempts = registration_attempts + 1
     where id = j.id;
    return query select true, 'registering'::text;
    return;
  end if;

  return query select false, j.registration_status;
end;
$fn$;

revoke all on function public.claim_scheme_registration(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.claim_scheme_registration(uuid, uuid, boolean) to service_role;

commit;

notify pgrst, 'reload schema';

-- Verify:
--   select claimed, current_status from claim_scheme_registration('<company>', '<job>');
--   select entity_type, event, count(*) from evidence_hashes
--    where entity_type = 'scheme_registrations' group by 1, 2;
