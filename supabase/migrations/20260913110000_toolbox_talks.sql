-- 20260913110000_toolbox_talks.sql  -  Vantro
--
-- Toolbox talks: the safety briefing a supervisor gives on site, and the
-- record of who was actually there for it.
--
-- WHY THE SIGNATURE IS THE POINT
-- A toolbox talk with no signatures is a claim. The thing an auditor, an
-- insurer or the HSE asks for is evidence that a named person received a named
-- briefing on a named date. So the signature row -- not the talk -- is the
-- evidential record here: it carries who, when, and the drawn mark they made,
-- and it is written once and never edited.
--
-- TWO TABLES, NOT ONE
--   toolbox_talks              the briefing: title, notes, optional PDF, the
--                              job it was given on. Editable by the admin who
--                              raised it, up to the point someone signs.
--   toolbox_talk_signatures    one row per worker per talk. Append-only.
--
-- WHY SIGNING CLOSES EDITING
-- If the notes can change after a signature is collected, the signature stops
-- meaning anything: it attests to whatever the text says now, not what the
-- worker was actually briefed on. locked_at is set by a trigger on the first
-- signature, and the update guard refuses content changes once it is set. An
-- admin who needs to change a briefing after it has been signed raises a new
-- one -- which is the same "corrections are new rows" rule the evidence layer
-- already applies elsewhere.
--
-- THE SIGNATURE IMAGE
-- Stored as a data: URI of the drawn path, not a file in R2. It is a few
-- kilobytes of monochrome strokes; putting it in the row keeps the signature
-- and the attestation atomic, so there is no window where a signature row
-- exists pointing at an object that failed to upload. signature_svg is capped
-- so a malformed client cannot post a megabyte of path data.

begin;

-- ---------------------------------------------------------------------------
-- 1. The talks
-- ---------------------------------------------------------------------------
create table if not exists public.toolbox_talks (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies(id) on delete cascade,
  job_id            uuid not null references public.jobs(id) on delete cascade,
  title             text not null,
  notes             text,
  -- R2 object key for an optional briefing PDF, plus the hash of its bytes so
  -- the audit pack can prove the document has not been swapped.
  document_path     text,
  document_url      text,
  document_sha256   text,
  delivered_by      uuid references public.users(id) on delete set null,
  delivered_at      timestamptz not null default now(),
  created_by        uuid references public.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  -- Set by trigger on the first signature. Non-null means the content is frozen.
  locked_at         timestamptz,
  archived_at       timestamptz,
  constraint toolbox_talks_title_len check (char_length(title) between 1 and 200),
  constraint toolbox_talks_notes_len check (notes is null or char_length(notes) <= 8000)
);

create index if not exists toolbox_talks_job on public.toolbox_talks (job_id, delivered_at desc);
create index if not exists toolbox_talks_company on public.toolbox_talks (company_id, delivered_at desc);

-- ---------------------------------------------------------------------------
-- 2. The signatures
-- ---------------------------------------------------------------------------
create table if not exists public.toolbox_talk_signatures (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies(id) on delete cascade,
  talk_id           uuid not null references public.toolbox_talks(id) on delete cascade,
  user_id           uuid not null references public.users(id) on delete cascade,
  -- The drawn mark, as an SVG data: URI. See the header.
  signature_svg     text not null,
  signed_at         timestamptz not null default now(),
  -- Where they were when they signed, when the phone could tell us. Null is
  -- honest; 0 would not be.
  lat               double precision,
  lng               double precision,
  accuracy_metres   integer,
  device_info       text,
  constraint toolbox_talk_signatures_svg_len check (char_length(signature_svg) between 32 and 200000),
  -- One signature per person per talk. Signing twice is not more evidence.
  constraint toolbox_talk_signatures_once unique (talk_id, user_id)
);

create index if not exists toolbox_talk_signatures_talk on public.toolbox_talk_signatures (talk_id);
create index if not exists toolbox_talk_signatures_user on public.toolbox_talk_signatures (user_id, signed_at desc);

-- ---------------------------------------------------------------------------
-- 3. Signing freezes the briefing
-- ---------------------------------------------------------------------------
create or replace function public.toolbox_talk_lock_on_signature()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  update public.toolbox_talks
     set locked_at = coalesce(locked_at, new.signed_at)
   where id = new.talk_id;
  return null;
end;
$fn$;

drop trigger if exists toolbox_talks_lock on public.toolbox_talk_signatures;
create trigger toolbox_talks_lock
  after insert on public.toolbox_talk_signatures
  for each row execute function public.toolbox_talk_lock_on_signature();

-- Content is frozen once locked. archived_at and locked_at itself stay
-- writable: withdrawing a talk from the list is not rewriting what was signed.
create or replace function public.toolbox_talk_guard_locked()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $fn$
begin
  if old.locked_at is null then
    return new;
  end if;
  if new.title is distinct from old.title
     or new.notes is distinct from old.notes
     or new.document_path is distinct from old.document_path
     or new.document_url is distinct from old.document_url
     or new.document_sha256 is distinct from old.document_sha256
     or new.job_id is distinct from old.job_id
     or new.delivered_at is distinct from old.delivered_at then
    raise exception
      'toolbox talk % has been signed; raise a new talk rather than editing this one', old.id
      using errcode = 'integrity_constraint_violation';
  end if;
  return new;
end;
$fn$;

drop trigger if exists toolbox_talks_locked_guard on public.toolbox_talks;
create trigger toolbox_talks_locked_guard
  before update on public.toolbox_talks
  for each row execute function public.toolbox_talk_guard_locked();

-- A signature is a record of a moment. It is never edited.
create or replace function public.toolbox_signature_immutable()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $fn$
begin
  raise exception
    'toolbox talk signatures are append-only (row %)', old.id
    using errcode = 'integrity_constraint_violation';
end;
$fn$;

drop trigger if exists toolbox_talk_signatures_immutable on public.toolbox_talk_signatures;
create trigger toolbox_talk_signatures_immutable
  before update on public.toolbox_talk_signatures
  for each row execute function public.toolbox_signature_immutable();

-- ---------------------------------------------------------------------------
-- 4. RLS
-- ---------------------------------------------------------------------------
-- Same shape as job_checklists_rls: admin, foreman and superadmin manage;
-- superadmin crosses companies, everyone else is pinned to their own. Workers
-- read the talks on their own company's jobs and insert only their OWN
-- signature -- the with check on user_id is what stops one worker signing on
-- behalf of another, which is the whole integrity claim of the feature.
--
-- The app reads through the service client, which bypasses RLS. These policies
-- are what stands between a leaked anon key and a forged safety record.

alter table public.toolbox_talks enable row level security;
alter table public.toolbox_talk_signatures enable row level security;

drop policy if exists toolbox_talks_select on public.toolbox_talks;
create policy toolbox_talks_select on public.toolbox_talks
  for select to authenticated
  using (
    exists (
      select 1 from public.users u
       where u.auth_user_id = auth.uid()
         and (u.role = 'superadmin'::text or u.company_id = public.toolbox_talks.company_id)
    )
  );

drop policy if exists toolbox_talks_write on public.toolbox_talks;
create policy toolbox_talks_write on public.toolbox_talks
  for insert to authenticated
  with check (
    exists (
      select 1 from public.users u
       where u.auth_user_id = auth.uid()
         and u.role = any (array['admin'::text, 'foreman'::text, 'superadmin'::text])
         and (u.role = 'superadmin'::text or u.company_id = public.toolbox_talks.company_id)
    )
  );

drop policy if exists toolbox_talks_update on public.toolbox_talks;
create policy toolbox_talks_update on public.toolbox_talks
  for update to authenticated
  using (
    exists (
      select 1 from public.users u
       where u.auth_user_id = auth.uid()
         and u.role = any (array['admin'::text, 'foreman'::text, 'superadmin'::text])
         and (u.role = 'superadmin'::text or u.company_id = public.toolbox_talks.company_id)
    )
  );

drop policy if exists toolbox_talk_signatures_select on public.toolbox_talk_signatures;
create policy toolbox_talk_signatures_select on public.toolbox_talk_signatures
  for select to authenticated
  using (
    exists (
      select 1 from public.users u
       where u.auth_user_id = auth.uid()
         and (u.role = 'superadmin'::text or u.company_id = public.toolbox_talk_signatures.company_id)
    )
  );

-- You may only ever sign as yourself.
drop policy if exists toolbox_talk_signatures_insert_own on public.toolbox_talk_signatures;
create policy toolbox_talk_signatures_insert_own on public.toolbox_talk_signatures
  for insert to authenticated
  with check (
    exists (
      select 1 from public.users u
       where u.auth_user_id = auth.uid()
         and u.id = public.toolbox_talk_signatures.user_id
         and u.company_id = public.toolbox_talk_signatures.company_id
    )
  );

commit;

notify pgrst, 'reload schema';

-- Verify:
--   select policyname, cmd from pg_policies
--    where tablename in ('toolbox_talks','toolbox_talk_signatures') order by tablename, cmd;
--   -- signing locks the talk:
--   insert into toolbox_talk_signatures (...) values (...);
--   select locked_at from toolbox_talks where id = '...';   -> non-null
--   update toolbox_talks set notes = 'x' where id = '...';  -> ERROR, has been signed
