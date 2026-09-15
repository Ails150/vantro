-- 20260915160000_pay_rules_breaks.sql  -  Vantro
--
-- Unpaid breaks.
--
-- A worker signs in at 07:30 and out at 16:30 and is on site for nine hours.
-- They did not work nine hours, because they had lunch, and almost every firm
-- pays eight. Until now Vantro had no way to express that, so either the export
-- overstated every long day or somebody adjusted the figure by hand afterwards
-- -- which throws away the verified sign-out time that is the whole point of
-- the product.
--
-- TWO COLUMNS, BECAUSE A BREAK IS CONDITIONAL
-- Deducting thirty minutes from every shift regardless of length would take
-- lunch off a two hour call-out. The threshold is what makes the rule match how
-- people actually describe it: "half an hour unpaid on anything over six".
--
--   unpaid_break_minutes   how long the break is
--   break_after_hours      only deduct on shifts longer than this
--
-- Both null is the default and means no deduction, in keeping with every other
-- rule in this table: nothing changes for a company that has not asked for it.
--
-- WHAT THIS DELIBERATELY IS NOT
-- It is not a record of when the break was taken, and it does not claim to be.
-- The Working Time Regulations entitle a worker to a twenty minute rest break
-- on a shift over six hours, and proving one was actually taken needs the
-- worker to record it -- a button on the phone, with a time against it. That is
-- a real feature and a different one. This is a payroll deduction, and the
-- column comments say so, so that nobody later mistakes it for compliance
-- evidence.

begin;

alter table public.pay_rules
  add column if not exists unpaid_break_minutes integer,
  add column if not exists break_after_hours    numeric(4,2);

-- A break longer than eight hours is a typo, not a policy. Zero is allowed and
-- is simply "no deduction", which is the same as null -- both are accepted
-- rather than one being forced, because a company clearing the field and a
-- company typing 0 mean the same thing here and refusing one of them would be
-- pedantry.
alter table public.pay_rules
  drop constraint if exists pay_rules_unpaid_break_minutes_sane;
alter table public.pay_rules
  add constraint pay_rules_unpaid_break_minutes_sane
  check (unpaid_break_minutes is null or (unpaid_break_minutes between 0 and 480));

alter table public.pay_rules
  drop constraint if exists pay_rules_break_after_hours_sane;
alter table public.pay_rules
  add constraint pay_rules_break_after_hours_sane
  check (break_after_hours is null or (break_after_hours >= 0 and break_after_hours <= 24));

comment on column public.pay_rules.unpaid_break_minutes is
  'Minutes deducted from a qualifying shift as an unpaid break. A PAYROLL DEDUCTION, not evidence that a break was taken.';
comment on column public.pay_rules.break_after_hours is
  'Only deduct the break from shifts longer than this many hours. Null means deduct from every shift.';

commit;
