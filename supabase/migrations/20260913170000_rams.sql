-- 20260913170000_rams.sql  -  Vantro
--
-- RAMS: the risk assessment and method statement for a job, the versions of it,
-- and who signed which version before starting work.
--
-- WHY VERSIONS ARE THE WHOLE DESIGN
-- A RAMS is revised. The method changes, a new hazard is identified, the
-- principal contractor asks for an amendment. The compliance question is never
-- "has this person signed the RAMS", it is "has this person signed the version
-- that is in force today". A signature against v1 says nothing about v2, and a
-- schema that stores one signature per person per job would quietly answer the
-- wrong question and block nobody after a revision.
--
-- So: rams_documents is append-only and versioned per job. Uploading a revision
-- writes a new row at version N+1 and stamps superseded_at on the previous one.
-- rams_signatures point at a specific rams_documents row. The sign-in gate asks
-- for a signature on the CURRENT version, so a revision correctly puts everyone
-- back to unsigned.
--
-- THE PDF IS EVIDENCE
-- document_sha256 is the hash of the bytes, recorded at upload the same way
-- receipts are. Without it "they signed the RAMS" is a claim about a URL, and
-- the file behind a URL can be replaced. With it the pack can show that the
-- document signed is the document held.
--
-- HASH CAPTURE FROM DAY ONE
-- Unlike toolbox talks, which needed a follow-up migration to join the chain,
-- both tables are wired into record_evidence_hash here. A signature on a method
-- statement is the row most likely to be produced in an investigation.

begin;

-- ---------------------------------------------------------------------------
-- 1. Documents
-- ---------------------------------------------------------------------------
create table if not exists public.rams_documents (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies(id) on delete cascade,
  job_id            uuid not null references public.jobs(id) on delete cascade,
  version           integer not null,
  title             text not null,
  -- R2 object key, public URL, and the hash of the bytes.
  document_path     text not null,
  document_url      text not null,
  document_sha256   text not null,
  document_bytes    integer,
  notes             text,
  uploaded_by       uuid references public.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  -- Set when a later version replaces this one. Null means in force.
  superseded_at     timestamptz,
  superseded_by     uuid references public.rams_documents(id) on delete set null,
  archived_at       timestamptz,
  constraint rams_documents_title_len check (char_length(title) between 1 and 200),
  constraint rams_documents_version_positive check (version >= 1),
  constraint rams_documents_version_per_job unique (job_id, version)
);

create index if not exists rams_documents_job on public.rams_documents (job_id, version desc);
create index if not exists rams_documents_company on public.rams_documents (company_id, created_at desc);
-- The gate's query: the one live version for a job. Partial, because that is
-- the only row it ever wants and there is exactly one.
create unique index if not exists rams_documents_current_per_job
  on public.rams_documents (job_id)
  where superseded_at is null and archived_at is null;

-- ---------------------------------------------------------------------------
-- 2. Signatures
-- ---------------------------------------------------------------------------
create table if not exists public.rams_signatures (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies(id) on delete cascade,
  -- Against a VERSION, not a job. See the header.
  rams_id           uuid not null references public.rams_documents(id) on delete cascade,
  user_id           uuid not null references public.users(id) on delete cascade,
  signature_svg     text not null,
  signed_at         timestamptz not null default now(),
  -- How long the document was open before they signed. Not proof anybody read
  -- it, and not treated as such anywhere -- but a wall of two-second signatures
  -- is a finding, and the number has to exist for anyone to notice.
  read_seconds      integer,
  lat               double precision,
  lng               double precision,
  accuracy_metres   integer,
  device_info       text,
  constraint rams_signatures_svg_len check (char_length(signature_svg) between 32 and 200000),
  constraint rams_signatures_once unique (rams_id, user_id)
);

create index if not exists rams_signatures_rams on public.rams_signatures (rams_id);
create index if not exists rams_signatures_user on public.rams_signatures (user_id, signed_at desc);

-- ---------------------------------------------------------------------------
-- 3. Immutability
-- ---------------------------------------------------------------------------
-- A version is never edited. Revising a method statement means a new version,
-- which is the entire point of the table. Only the supersede and archive
-- bookkeeping may be written after insert.
create or replace function public.rams_document_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $fn$
begin
  if new.title is distinct from old.title
     or new.notes is distinct from old.notes
     or new.version is distinct from old.version
     or new.job_id is distinct from old.job_id
     or new.company_id is distinct from old.company_id
     or new.document_path is distinct from old.document_path
     or new.document_url is distinct from old.document_url
     or new.document_sha256 is distinct from old.document_sha256 then
    raise exception
      'RAMS version % is immutable; upload a new version instead (row %)', old.version, old.id
      using errcode = 'integrity_constraint_violation';
  end if;
  return new;
end;
$fn$;

drop trigger if exists rams_documents_immutable on public.rams_documents;
create trigger rams_documents_immutable
  before update on public.rams_documents
  for each row execute function public.rams_document_guard();

-- A signature is a record of a moment. Never edited.
drop trigger if exists rams_signatures_immutable on public.rams_signatures;
create trigger rams_signatures_immutable
  before update on public.rams_signatures
  for each row execute function public.toolbox_signature_immutable();

-- ---------------------------------------------------------------------------
-- 4. Evidence hashes, from day one
-- ---------------------------------------------------------------------------
-- Documents denylist the supersede and archive bookkeeping: it is written after
-- capture, and a hash that changed when a later revision arrived would make
-- every superseded version look tampered with.
drop trigger if exists rams_documents_evidence_hash on public.rams_documents;
create trigger rams_documents_evidence_hash
  after insert on public.rams_documents
  for each row execute function public.record_evidence_hash(
    'created', '1', 'uploaded_by',
    'superseded_at', 'superseded_by', 'archived_at'
  );

drop trigger if exists rams_documents_evidence_amendment on public.rams_documents;
create trigger rams_documents_evidence_amendment
  after update on public.rams_documents
  for each row execute function public.record_evidence_amendment(
    '1', 'uploaded_by',
    'superseded_at', 'superseded_by', 'archived_at'
  );

-- Signatures denylist nothing: every column is the attestation. No amendment
-- trigger, because the table refuses UPDATE outright.
drop trigger if exists rams_signatures_evidence_hash on public.rams_signatures;
create trigger rams_signatures_evidence_hash
  after insert on public.rams_signatures
  for each row execute function public.record_evidence_hash(
    'signed', '1', 'user_id'
  );

-- ---------------------------------------------------------------------------
-- 5. RLS
-- ---------------------------------------------------------------------------
-- Same shape as toolbox_talks and job_checklists_rls. The load-bearing policy
-- is again the insert with check on signatures, tying user_id to auth.uid():
-- a RAMS signature somebody else could write is not a RAMS signature.
--
-- Workers get SELECT on documents because they have to read the thing before
-- signing it, and that read is company-scoped rather than assignment-scoped so
-- somebody moved onto a job mid-shift is not locked out of the document they
-- are about to be asked to sign.

alter table public.rams_documents enable row level security;
alter table public.rams_signatures enable row level security;

drop policy if exists rams_documents_select on public.rams_documents;
create policy rams_documents_select on public.rams_documents
  for select to authenticated
  using (
    exists (
      select 1 from public.users u
       where u.auth_user_id = auth.uid()
         and (u.role = 'superadmin'::text or u.company_id = public.rams_documents.company_id)
    )
  );

drop policy if exists rams_documents_insert on public.rams_documents;
create policy rams_documents_insert on public.rams_documents
  for insert to authenticated
  with check (
    exists (
      select 1 from public.users u
       where u.auth_user_id = auth.uid()
         and u.role = any (array['admin'::text, 'foreman'::text, 'superadmin'::text])
         and (u.role = 'superadmin'::text or u.company_id = public.rams_documents.company_id)
    )
  );

drop policy if exists rams_documents_update on public.rams_documents;
create policy rams_documents_update on public.rams_documents
  for update to authenticated
  using (
    exists (
      select 1 from public.users u
       where u.auth_user_id = auth.uid()
         and u.role = any (array['admin'::text, 'foreman'::text, 'superadmin'::text])
         and (u.role = 'superadmin'::text or u.company_id = public.rams_documents.company_id)
    )
  );

drop policy if exists rams_signatures_select on public.rams_signatures;
create policy rams_signatures_select on public.rams_signatures
  for select to authenticated
  using (
    exists (
      select 1 from public.users u
       where u.auth_user_id = auth.uid()
         and (u.role = 'superadmin'::text or u.company_id = public.rams_signatures.company_id)
    )
  );

drop policy if exists rams_signatures_insert_own on public.rams_signatures;
create policy rams_signatures_insert_own on public.rams_signatures
  for insert to authenticated
  with check (
    exists (
      select 1 from public.users u
       where u.auth_user_id = auth.uid()
         and u.id = public.rams_signatures.user_id
         and u.company_id = public.rams_signatures.company_id
    )
  );

commit;

notify pgrst, 'reload schema';

-- Verify:
--   select policyname, cmd from pg_policies
--    where tablename like 'rams%' order by tablename, cmd;
--   -- one live version per job, enforced:
--   insert into rams_documents (job_id, version, ...) values ('<job>', 2, ...);
--     -> fails until the v1 row has superseded_at set
--   -- a version cannot be edited:
--   update rams_documents set title = 'x' where id = '<v1>';   -> ERROR
--   -- signatures hash at capture:
--   select entity_type, event from evidence_hashes where entity_type like 'rams%';
