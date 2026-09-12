-- 20260912090000_signout_method_not_write_once.sql  -  Vantro
--
-- Fixes the reason a worker's phone buzzed ~170 times over one weekend.
--
-- WHAT WENT WRONG
-- 20260901_baseline_existing_tables.sql declares:
--
--     signed_out_method text default 'manual'
--
-- so every signins row is born with that column already set. On 2026-09-04,
-- 20260904020000_evidence_append_only.sql added signed_out_method to the
-- write-once list on signins_immutable, and write-once means "null -> value
-- only". Against a column with a non-null default there is no null to start
-- from, so the guard could never protect anything -- it could only ever refuse.
--
-- Both auto sign-out paths write signed_out_method = 'auto':
--   lib/scheduling/notificationEngine.ts   30 min after scheduled shift end
--   app/api/cron/auto-signout/route.ts     14h hard cap / shift end + 2h
--
-- Every one of those UPDATEs has been rejected since 2026-09-04. Neither
-- caller checked the error, so the shift stayed open and the engine re-ran the
-- same branch on the next tick -- sending the "signed out automatically" push
-- again, every five minutes, indefinitely. The manual sign-out path was
-- unaffected: it writes 'manual' over 'manual', which is not a change, so the
-- trigger lets it through. That is why this only ever bit shifts nobody closed
-- by hand.
--
-- WHAT THIS DOES
-- 1. Drops the column default. The value now means something: null until a
--    sign-out actually happens, then 'manual' or 'auto'.
-- 2. Rebuilds signins_immutable without signed_out_method / signed_out_source
--    in the write-once list. These two are labels describing HOW the sign-out
--    was recorded, not the captured evidence itself. The evidence -- the
--    coordinates, the accuracy, the distance, the in-range verdict -- stays
--    write-once exactly as before, and every other guarantee of
--    20260904020000 is untouched: id and company_id are still immutable, and
--    signins_evidence_amendment still records any real change to the payload.
-- 3. Clears the default-only label off shifts that are still open, so the rows
--    stranded by the bug can be closed by the normal path. Only rows with
--    signed_out_at IS NULL are touched: a closed shift's method is a real
--    record of what happened and is left exactly as it is.
--
-- Step 3 has to run with the immutability trigger off, because value -> null
-- is precisely what write-once refuses. The trigger is re-enabled in the same
-- transaction; a failure anywhere rolls the whole thing back rather than
-- leaving the table unguarded.

begin;

-- 1. The default that made write-once unsatisfiable ---------------------------
alter table public.signins alter column signed_out_method drop default;

-- 2. Rebuild the guard without the two label columns --------------------------
drop trigger if exists signins_immutable on public.signins;
create trigger signins_immutable
  before update on public.signins
  for each row execute function public.enforce_evidence_immutability(
    '2', 'id', 'company_id',
    'sign_out_lat', 'sign_out_lng', 'sign_out_accuracy_metres',
    'sign_out_distance_metres', 'sign_out_within_range'
  );

-- 3. Un-strand the open shifts ------------------------------------------------
alter table public.signins disable trigger signins_immutable;

update public.signins
   set signed_out_method = null
 where signed_out_at is null
   and signed_out_method is not null;

alter table public.signins enable trigger signins_immutable;

commit;
