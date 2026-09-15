-- 20260915190000_pay_rules_bank_holidays.sql  -  Vantro
--
-- Bank holiday pay.
--
-- public_holidays already exists and is already used: the calendar draws them,
-- the scheduler counts around them, and the GPS ping job skips them. The one
-- thing nobody could do with them was pay somebody extra for working one.
--
-- ONE COLUMN, AND ONE DECISION ABOUT OVERTIME
--
-- The column is easy: a multiplier on the worker's own rate, same shape as the
-- overtime multiplier, null meaning bank holidays pay exactly like any other
-- day.
--
-- The decision is how it interacts with overtime, because a Christmas Day shift
-- could plausibly be both. Three readings exist:
--
--   a) pay both multipliers, so double time on a bank holiday inside an
--      overtime week becomes 3x. Nobody's contract says this.
--   b) pay the higher of the two, per hour. Defensible, and it needs a
--      per-hour comparison that weekly thresholds make genuinely hard to
--      reason about and impossible to explain on a screen.
--   c) bank holiday hours are paid at the bank holiday rate and are taken out
--      of the week BEFORE overtime is worked out.
--
-- (c) is what this implements. It is the reading a payroll clerk would
-- recognise: the day is already enhanced, so it does not also push the rest of
-- the week into overtime, and it never receives two multipliers. The
-- consequence -- eight hours on a bank holiday do not count towards a forty
-- hour weekly threshold -- is real, and is stated on the settings screen rather
-- than left for somebody to discover in a payroll run.

begin;

alter table public.pay_rules
  add column if not exists bank_holiday_multiplier numeric(4,2);

-- Same bounds and the same reasoning as the overtime multiplier: below 1 means
-- paying LESS for a bank holiday, which is a typo rather than a policy.
alter table public.pay_rules
  drop constraint if exists pay_rules_bank_holiday_multiplier_sane;
alter table public.pay_rules
  add constraint pay_rules_bank_holiday_multiplier_sane
  check (bank_holiday_multiplier is null
         or (bank_holiday_multiplier >= 1 and bank_holiday_multiplier <= 3));

comment on column public.pay_rules.bank_holiday_multiplier is
  'Applied to the worker''s own rate for hours worked on a date in public_holidays. Those hours are removed from the week before overtime is calculated, so they never receive two multipliers. Null means bank holidays pay as any other day.';

commit;
