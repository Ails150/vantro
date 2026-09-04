-- 20260904030000_audit_packs_manifest.sql  -  Vantro
-- Phase 1.2: the pack manifest and its signature.
--
-- THE TABLE ALREADY EXISTS
-- The spec asks for a "new table audit_packs". It is not new. public.audit_packs
-- has been in the database since before this work, holding
--   id, company_id, job_id, generated_at, generated_by, period_from, period_to,
--   ai_audit_used, exec_summary, red_flags
--
-- Seven of those ten columns are exactly what the spec asks for, under the same
-- names. So this extends the table rather than creating a rival one under a
-- different name, which is the safe choice: a second table would leave two
-- places claiming to be the register of generated packs, and the older one
-- would rot.
--
-- The three columns the spec does not mention -- ai_audit_used, exec_summary,
-- red_flags -- are KEPT. Nothing in the application reads or writes this table
-- (the only reference is the tenant wipe in app/api/account/delete), but
-- audit_packs_job_id_idx shows 116 index scans, so something has been reading
-- it that a repo grep cannot see. Dropping columns to tidy up, against a table
-- with unexplained reads, is not a trade worth taking. They stay, unused.
--
-- audit_report_log is a second, fully unused table with a report_ref column,
-- covering roughly the same ground. It is left alone here and noted in
-- PHASE-1.md as something to decide about deliberately rather than in passing.

-- ---------------------------------------------------------------------------
-- 1. Manifest columns
-- ---------------------------------------------------------------------------
alter table public.audit_packs
  -- What a reader quotes. Crockford base32, no I/L/O/U, so it survives being
  -- read down a phone or retyped from paper.
  add column if not exists reference       text,
  add column if not exists view_type       text,
  add column if not exists merkle_root     text,
  add column if not exists signature       text,

  -- The signed artefact, stored verbatim. The signature is over the canonical
  -- JSON of exactly this object, so it must be kept byte-reproducible -- which
  -- is why lib/audit/manifest.ts sorts keys rather than trusting jsonb round
  -- trips to preserve order.
  add column if not exists manifest        jsonb,

  add column if not exists evidence_count  integer,

  -- Which share link this pack was issued for, when it was issued for one.
  add column if not exists share_id        uuid references public.audit_shares(id),

  -- Fingerprint of the key that signed it. Without this, rotating
  -- AUDIT_SIGNING_KEY would silently make every earlier signature unverifiable
  -- with no way to tell which key a given pack needs.
  add column if not exists signing_key_sha256 text;

comment on column public.audit_packs.reference is
  'Human-quotable pack reference, VTR-YYYYMMDD-XXXXXXXX. The value handed to /verify.';
comment on column public.audit_packs.manifest is
  'The signed manifest, verbatim. Signature is over canonicalJson() of this object; do not rewrite it in place.';
comment on column public.audit_packs.signing_key_sha256 is
  'SHA-256 of the SPKI DER public key that signed this pack, so a key rotation stays verifiable.';

-- One reference, one pack. This is the lookup key for a public endpoint, so a
-- duplicate would make /verify ambiguous in exactly the situation where being
-- unambiguous is the whole point.
create unique index if not exists audit_packs_reference_key
  on public.audit_packs (reference)
  where reference is not null;

-- ---------------------------------------------------------------------------
-- 2. RLS
-- ---------------------------------------------------------------------------
-- /verify is public and unauthenticated, but it is answered by a server route
-- holding the service role, which returns a fixed, minimal shape: root,
-- validity, generated_at, evidence count. No policy is added here, so a leaked
-- anon key still cannot enumerate packs or read a manifest -- which would
-- expose which evidence exists for which job, to anyone.
--
-- Enabled only if it is not already; this table predates the migration and its
-- current setting is not recorded anywhere in version control.
alter table public.audit_packs enable row level security;

notify pgrst, 'reload schema';

-- Verify:
--   select column_name from information_schema.columns
--    where table_name = 'audit_packs' order by ordinal_position;
--     -> includes reference, view_type, merkle_root, signature, manifest,
--        evidence_count, share_id, signing_key_sha256
--   select count(*) from audit_packs where reference is not null;   -> 0 until
--        the first pack is generated
--   select relrowsecurity from pg_class where relname = 'audit_packs';  -> t

-- ---------------------------------------------------------------------------
-- 3. Phase 1.3: archive bookkeeping
-- ---------------------------------------------------------------------------
-- How many of this pack's files could not be copied into the archive prefix.
-- Zero, or null for packs generated before archiving existed. A pack with a
-- non-zero count still renders; it just must not claim its evidence is
-- permanently held, and the UI says so.
alter table public.audit_packs
  add column if not exists archive_failed_count integer;

comment on column public.audit_packs.archive_failed_count is
  'Files that failed to copy into audit-archive/<company>/<ref>/ at generation. Non-zero means this pack has evidence that is not permanently held.';
