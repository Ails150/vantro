-- 20260913150000_toolbox_evidence_hashes.sql  -  Vantro
--
-- Put signed safety briefings in the merkle root.
--
-- 20260913110000 added toolbox_talks and toolbox_talk_signatures, and the audit
-- pack renders them -- but they were not wired into the capture triggers from
-- 20260904010000, so they appeared in the pack while contributing nothing to
-- its hash. A pack whose root does not cover the safety records it prints is
-- making a weaker claim than it looks like it is making, and the signature is
-- the single most evidential row the product holds: it is a named person
-- attesting they were briefed.
--
-- Same functions as every other evidential table. Nothing bespoke.
--
-- DENYLISTS
--
-- toolbox_talks excludes locked_at and archived_at. Both are workflow state
-- written after capture -- locked_at by the signature trigger, archived_at when
-- an admin withdraws a talk from the list -- and category (c) of the original
-- denylist rationale covers exactly this: a capture hash that changed the
-- moment someone signed would be worthless. The briefing itself (title, notes,
-- document reference and hash, job, who delivered it and when) is all hashed.
--
-- toolbox_talk_signatures denylists NOTHING. Every column is the attestation:
-- who, when, the mark they drew, and where they were standing. There is no
-- bookkeeping on that table and nothing on it is regenerable.
--
-- Signatures also get no amendment trigger, because the table already refuses
-- UPDATE outright (toolbox_talk_signatures_immutable, 20260913110000). An
-- amendment recorder there would be dead code implying a path that does not
-- exist.

begin;

-- ---------------------------------------------------------------------------
-- 1. Capture
-- ---------------------------------------------------------------------------
drop trigger if exists toolbox_talks_evidence_hash on public.toolbox_talks;
create trigger toolbox_talks_evidence_hash
  after insert on public.toolbox_talks
  for each row execute function public.record_evidence_hash(
    'created', '1', 'created_by',
    'locked_at', 'archived_at'
  );

-- The one that matters. 'signed' rather than 'created': the event name is read
-- straight out of the pack, and "signed" is what happened.
drop trigger if exists toolbox_talk_signatures_evidence_hash on public.toolbox_talk_signatures;
create trigger toolbox_talk_signatures_evidence_hash
  after insert on public.toolbox_talk_signatures
  for each row execute function public.record_evidence_hash(
    'signed', '1', 'user_id'
  );

-- ---------------------------------------------------------------------------
-- 2. Immutability, matching the other evidential tables
-- ---------------------------------------------------------------------------
-- id and company_id only. Changing either is not a correction, it is
-- re-attributing a safety record to a different tenant. The content freeze on a
-- signed talk is a separate, stricter guard already in place
-- (toolbox_talks_locked_guard).
drop trigger if exists toolbox_talks_immutable on public.toolbox_talks;
create trigger toolbox_talks_immutable
  before update on public.toolbox_talks
  for each row execute function public.enforce_evidence_immutability(
    '2', 'id', 'company_id'
  );

-- ---------------------------------------------------------------------------
-- 3. Amendments
-- ---------------------------------------------------------------------------
-- Same denylist as the capture trigger above -- they must stay identical, or an
-- untouched talk appears amended the moment anything else about it changes.
-- In practice this is close to a no-op: once a talk is signed the only columns
-- that can change are the two denylisted ones, so the payload is identical and
-- the recorder returns without writing. It exists for the window before the
-- first signature, when an admin can still correct a typo in the notes and that
-- correction should leave a mark.
drop trigger if exists toolbox_talks_evidence_amendment on public.toolbox_talks;
create trigger toolbox_talks_evidence_amendment
  after update on public.toolbox_talks
  for each row execute function public.record_evidence_amendment(
    '1', 'created_by',
    'locked_at', 'archived_at'
  );

-- ---------------------------------------------------------------------------
-- 4. Backfill
-- ---------------------------------------------------------------------------
-- Rows written between 20260913110000 and this migration have no hash. Without
-- a backfill they would be permanently outside the chain, and the demo tenant
-- already holds some. event='backfill' is the same marker the 2026-09-07 run
-- used, so the pack can distinguish a hash taken at capture from one taken
-- afterwards -- which is a weaker claim and should not be dressed up as equal.
--
-- The payload expression must match record_evidence_hash's exactly, or a
-- backfilled row will look amended forever.
insert into public.evidence_hashes
  (company_id, entity_type, entity_id, event, sha256, payload_version, hashed_by)
select
  t.company_id,
  'toolbox_talks',
  t.id,
  'backfill',
  encode(sha256(convert_to(((to_jsonb(t) - 'locked_at') - 'archived_at')::text, 'UTF8')), 'hex'),
  1,
  t.created_by
from public.toolbox_talks t
where not exists (
  select 1 from public.evidence_hashes h
   where h.entity_type = 'toolbox_talks' and h.entity_id = t.id
);

insert into public.evidence_hashes
  (company_id, entity_type, entity_id, event, sha256, payload_version, hashed_by)
select
  sg.company_id,
  'toolbox_talk_signatures',
  sg.id,
  'backfill',
  encode(sha256(convert_to(to_jsonb(sg)::text, 'UTF8')), 'hex'),
  1,
  sg.user_id
from public.toolbox_talk_signatures sg
where not exists (
  select 1 from public.evidence_hashes h
   where h.entity_type = 'toolbox_talk_signatures' and h.entity_id = sg.id
);

commit;

notify pgrst, 'reload schema';

-- Verify:
--   select entity_type, event, count(*) from evidence_hashes
--    where entity_type like 'toolbox%' group by 1, 2;
--   -- a new signature hashes at capture, not as a backfill:
--   insert into toolbox_talk_signatures (...) values (...);
--   select event from evidence_hashes
--    where entity_type = 'toolbox_talk_signatures' order by hashed_at desc limit 1;  -> signed
