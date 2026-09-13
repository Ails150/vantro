-- 20260913160000_evidence_event_signed.sql  -  Vantro
--
-- Adds 'signed' to the evidence_hashes event vocabulary.
--
-- 20260913150000 hashes a toolbox talk signature with event = 'signed', but the
-- check constraint from 20260904010000 only allows
-- ('created', 'signed_out', 'backfill', 'amended'). So every signature insert
-- failed on the constraint, and because the capture trigger runs inside the
-- caller's transaction the whole insert rolled back: the seed reported six
-- signatures written and the table had none.
--
-- That is the correct behaviour for a capture trigger and worth keeping in
-- mind: an evidence hash that cannot be written takes the row with it, by
-- design. Evidence that exists without a hash is the thing this layer refuses
-- to allow.
--
-- WHY EXTEND THE VOCABULARY RATHER THAN REUSE 'created'
-- The enum is not purely a row lifecycle: 'signed_out' is already a
-- domain event, naming the moment a shift closed rather than the fact a row
-- changed. A signature is the same kind of thing -- the pack prints the event
-- name, and "signed" is what happened. Reusing 'created' would file the most
-- evidential row in the product under the same label as a draft briefing.
--
-- Adding a value to a check constraint is backwards compatible: every existing
-- row still satisfies it, and nothing switches on the set being closed.

begin;

alter table public.evidence_hashes
  drop constraint if exists evidence_hashes_event_check;

alter table public.evidence_hashes
  add constraint evidence_hashes_event_check
  check (event in ('created', 'signed', 'signed_out', 'backfill', 'amended'));

commit;

notify pgrst, 'reload schema';

-- Verify:
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--    where conname = 'evidence_hashes_event_check';
--   -- and a signature now lands with its hash:
--   select entity_type, event, count(*) from evidence_hashes
--    where entity_type = 'toolbox_talk_signatures' group by 1, 2;
