-- 20260913200000_incidents.sql  -  Vantro
--
-- Near misses, injuries and hazards, reported from the phone by whoever saw it.
--
-- WHY THE REPORT IS SEPARATE FROM THE CLOSURE
-- What a worker reported and what an admin decided about it are two different
-- claims by two different people, and an investigation asks about both. So the
-- reported half -- kind, description, photographs, when and where -- is
-- immutable from the moment it lands, and the acknowledgement and closure are
-- written alongside it rather than over it. An admin cannot edit a worker's
-- account of what happened, which is the property that makes the record worth
-- anything.
--
-- The most important thing about a near miss is that reporting one is easy and
-- carries no friction, so the required fields are the two a person can supply
-- while standing there: what kind, and what happened. Everything else is
-- optional.
--
-- STATUS
--   open           reported, nobody has looked at it
--   acknowledged   an admin has seen it and is dealing with it
--   closed         dealt with, with a closure note explaining how
--
-- Open and acknowledged incidents are pinned to the admin's TODAY view until
-- they are closed. That is deliberate: a hazard nobody has closed is a live
-- problem, and it should not be possible to scroll past it.
--
-- HASH CAPTURE FROM DAY ONE, as with RAMS.

begin;

create table if not exists public.incidents (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies(id) on delete cascade,
  job_id            uuid not null references public.jobs(id) on delete cascade,
  reported_by       uuid not null references public.users(id) on delete restrict,

  kind              text not null,
  description       text not null,
  photo_urls        text[] not null default '{}',
  -- R2 object keys for the same photographs, so the pack can hash the bytes.
  photo_paths       text[] not null default '{}',
  -- When it happened, which is not always when it was reported: someone
  -- finishing a lift does not stop to fill in a form.
  occurred_at       timestamptz not null default now(),
  reported_at       timestamptz not null default now(),
  lat               double precision,
  lng               double precision,
  accuracy_metres   integer,

  status            text not null default 'open',
  acknowledged_by   uuid references public.users(id) on delete set null,
  acknowledged_at   timestamptz,
  closed_by         uuid references public.users(id) on delete set null,
  closed_at         timestamptz,
  closure_notes     text,

  created_at        timestamptz not null default now(),

  constraint incidents_kind_check check (kind in ('near_miss', 'injury', 'hazard')),
  constraint incidents_status_check check (status in ('open', 'acknowledged', 'closed')),
  constraint incidents_description_len check (char_length(description) between 1 and 8000),
  constraint incidents_closure_len check (closure_notes is null or char_length(closure_notes) <= 8000),
  -- Closing without saying how is not closing. The note is the record of what
  -- was actually done about it, and it is the only part of a closure anyone
  -- reads later.
  constraint incidents_closed_needs_notes
    check (status <> 'closed' or (closure_notes is not null and char_length(trim(closure_notes)) > 0)),
  constraint incidents_closed_needs_who
    check (status <> 'closed' or (closed_by is not null and closed_at is not null))
);

-- The TODAY query: everything not yet closed, newest first.
create index if not exists incidents_open_by_company
  on public.incidents (company_id, reported_at desc)
  where status <> 'closed';
create index if not exists incidents_job on public.incidents (job_id, reported_at desc);
create index if not exists incidents_reporter on public.incidents (reported_by, reported_at desc);

-- ---------------------------------------------------------------------------
-- The worker's account is immutable
-- ---------------------------------------------------------------------------
create or replace function public.incident_report_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $fn$
begin
  if new.id is distinct from old.id
     or new.company_id is distinct from old.company_id
     or new.job_id is distinct from old.job_id
     or new.reported_by is distinct from old.reported_by
     or new.kind is distinct from old.kind
     or new.description is distinct from old.description
     or new.photo_urls is distinct from old.photo_urls
     or new.photo_paths is distinct from old.photo_paths
     or new.occurred_at is distinct from old.occurred_at
     or new.reported_at is distinct from old.reported_at
     or new.lat is distinct from old.lat
     or new.lng is distinct from old.lng then
    raise exception
      'the reported details of incident % cannot be edited; only the acknowledgement and closure may be written', old.id
      using errcode = 'integrity_constraint_violation';
  end if;
  return new;
end;
$fn$;

drop trigger if exists incidents_report_immutable on public.incidents;
create trigger incidents_report_immutable
  before update on public.incidents
  for each row execute function public.incident_report_guard();

-- ---------------------------------------------------------------------------
-- Evidence hashes, from day one
-- ---------------------------------------------------------------------------
-- The capture hash covers the worker's report. Everything an admin writes
-- afterwards is denylisted, for the same reason review and approval are
-- denylisted everywhere else: a hash that changed when somebody acknowledged an
-- incident would say the report had been altered, which is the opposite of the
-- truth. The amendment recorder shares the denylist exactly, so acknowledging
-- and closing leave the capture hash alone and write nothing.
drop trigger if exists incidents_evidence_hash on public.incidents;
create trigger incidents_evidence_hash
  after insert on public.incidents
  for each row execute function public.record_evidence_hash(
    'created', '1', 'reported_by',
    'status', 'acknowledged_by', 'acknowledged_at',
    'closed_by', 'closed_at', 'closure_notes'
  );

drop trigger if exists incidents_evidence_amendment on public.incidents;
create trigger incidents_evidence_amendment
  after update on public.incidents
  for each row execute function public.record_evidence_amendment(
    '1', 'reported_by',
    'status', 'acknowledged_by', 'acknowledged_at',
    'closed_by', 'closed_at', 'closure_notes'
  );

drop trigger if exists incidents_immutable on public.incidents;
create trigger incidents_immutable
  before update on public.incidents
  for each row execute function public.enforce_evidence_immutability(
    '2', 'id', 'company_id'
  );

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
-- Reporting is the one write a plain worker may do, and the with check ties
-- reported_by to auth.uid() so nobody files an incident in someone else's name.
--
-- Reads are company-wide rather than assignment-scoped on purpose: a hazard on
-- one site is worth another crew seeing, and narrowing it would make the
-- feature quieter than it should be. Only admin, foreman and superadmin may
-- update, which is how acknowledgement and closure stay theirs.

alter table public.incidents enable row level security;

drop policy if exists incidents_select on public.incidents;
create policy incidents_select on public.incidents
  for select to authenticated
  using (
    exists (
      select 1 from public.users u
       where u.auth_user_id = auth.uid()
         and (u.role = 'superadmin'::text or u.company_id = public.incidents.company_id)
    )
  );

drop policy if exists incidents_insert_own on public.incidents;
create policy incidents_insert_own on public.incidents
  for insert to authenticated
  with check (
    exists (
      select 1 from public.users u
       where u.auth_user_id = auth.uid()
         and u.id = public.incidents.reported_by
         and u.company_id = public.incidents.company_id
    )
  );

drop policy if exists incidents_update_manager on public.incidents;
create policy incidents_update_manager on public.incidents
  for update to authenticated
  using (
    exists (
      select 1 from public.users u
       where u.auth_user_id = auth.uid()
         and u.role = any (array['admin'::text, 'foreman'::text, 'superadmin'::text])
         and (u.role = 'superadmin'::text or u.company_id = public.incidents.company_id)
    )
  );

commit;

notify pgrst, 'reload schema';

-- Verify:
--   select policyname, cmd from pg_policies where tablename = 'incidents';
--   -- the report cannot be edited:
--   update incidents set description = 'x' where id = '<scratch>';   -> ERROR
--   -- closing without a note is refused:
--   update incidents set status = 'closed' where id = '<scratch>';   -> ERROR
--   -- and it hashes at capture:
--   select entity_type, event from evidence_hashes where entity_type = 'incidents';
