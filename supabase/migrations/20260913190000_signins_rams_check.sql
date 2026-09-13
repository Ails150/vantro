-- 20260913190000_signins_rams_check.sql  -  Vantro
--
-- Record what the RAMS gate decided at the moment of sign-in.
--
-- WHY
-- lib/rams.ts fails OPEN when its own lookup errors: refusing every sign-in on
-- the platform because a read failed would turn a database blip into a total
-- stoppage across every site. That is the right call, and it has one bad
-- property -- it is invisible. A shift that started because the gate could not
-- be evaluated looks identical, afterwards, to a shift that started because the
-- worker had signed. This column is the difference.
--
--   signed          they had signed the version in force
--   none_required   no RAMS is uploaded for that job
--   skipped_error   the gate could not be evaluated and let them through
--
-- null on every row written before this migration, and on any written by a
-- deployment that predates it. Null means "not recorded", which is not the same
-- as none_required and must not be rendered as though it were.
--
-- IT IS EVIDENCE, SO IT IS HASHED
-- Deliberately NOT added to the signins denylist. It is written once, at
-- insert, and it records a fact about how the shift began. The denylist exists
-- for bookkeeping and post-capture workflow state; this is neither. Existing
-- rows keep the hashes they were captured with -- adding a column does not
-- retrospectively change a payload that was already hashed -- so nothing looks
-- amended.

begin;

alter table public.signins
  add column if not exists rams_check text;

alter table public.signins
  drop constraint if exists signins_rams_check_check;
alter table public.signins
  add constraint signins_rams_check_check
  check (rams_check is null or rams_check in ('signed', 'none_required', 'skipped_error'));

comment on column public.signins.rams_check is
  'What the RAMS gate decided at sign-in. skipped_error means the gate failed open because its lookup errored -- the shift started unverified.';

-- The audit pack asks "were any shifts in this period started without the gate
-- working", which is a rare-value scan over a large table. Partial, because the
-- other values are the overwhelming majority and are never queried this way.
create index if not exists signins_rams_check_skipped
  on public.signins (company_id, signed_in_at desc)
  where rams_check = 'skipped_error';

commit;

notify pgrst, 'reload schema';

-- Verify:
--   select rams_check, count(*) from signins group by 1;
--   -- the constraint bites:
--   update signins set rams_check = 'nonsense' where id = '<scratch>';  -> ERROR
