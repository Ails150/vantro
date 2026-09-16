-- 20260916130000_evidence_hashes_immutable.sql  -  Vantro
--
-- The hash ledger itself is append-only.
--
-- FOUND BY THE SECURITY PASS, section D16. Every evidential table carries an
-- immutability trigger: signins, diary_entries, qa_submissions, defects,
-- variations, walkthroughs, incidents and the rest all refuse to have their
-- identifying columns changed, and record an `amended` hash when an evidential
-- field legitimately moves.
--
-- evidence_hashes carried no such guard. So the ledger that makes all of that
-- tamper-EVIDENT could itself be rewritten:
--
--   update evidence_hashes set sha256 = '000...' where id = ...;   -- succeeded
--
-- Change a shift, let the trigger append an `amended` row, then overwrite that
-- row's digest with the hash of the original, and the tampering is invisible.
-- The chain is the only thing standing behind the claim that a compliance pack
-- is evidence rather than a printout, and it was the one table in the scheme
-- nobody had protected.
--
-- WHAT THIS DOES AND DOES NOT CLOSE.
--
-- UPDATE is refused outright. A hash row states what a row looked like at a
-- moment; there is no such thing as a legitimate correction to it. If the
-- evidence changes, the existing triggers append a NEW row chained by
-- supersedes_id. Nothing in the application has ever updated this table --
-- verified by grep before writing this -- so nothing breaks.
--
-- DELETE is deliberately still allowed, and this is the honest limit. Tenant
-- deletion under Article 17 has to remove these rows, and a controller that
-- cannot delete a customer's data on request has a worse problem than this one.
-- Deletion is not silent, though: supersedes_id chains each amendment to its
-- predecessor, so removing a row in the middle leaves a dangling reference that
-- a verifier can see. Removing the WHOLE chain for an entity is undetectable
-- from the chain alone, which is what an audit pack's own signed manifest is
-- for -- it carries the hashes it was built from, so a pack already issued to a
-- client cannot be retro-fitted by deleting rows here.
--
-- An attacker who reaches the service role key still owns the database. The
-- point of this is not to stop them; it is that after this, tampering with the
-- record requires DELETING evidence rather than quietly rewriting it, and a gap
-- is visible where a rewrite was not.

begin;

create or replace function public.reject_evidence_hash_update()
returns trigger
language plpgsql
as $fn$
begin
  raise exception
    'evidence_hashes is append-only: row % may not be updated. If the evidence changed, the amendment triggers append a new row chained by supersedes_id.',
    old.id
    using errcode = 'restrict_violation';
end;
$fn$;

comment on function public.reject_evidence_hash_update() is
  'BEFORE UPDATE guard on evidence_hashes. There is no legitimate update to a hash row; amendments are appended, never edited.';

drop trigger if exists evidence_hashes_immutable on public.evidence_hashes;
create trigger evidence_hashes_immutable
  before update on public.evidence_hashes
  for each row execute function public.reject_evidence_hash_update();

commit;
