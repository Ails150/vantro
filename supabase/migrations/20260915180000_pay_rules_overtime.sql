-- 20260915180000_pay_rules_overtime.sql  -  Vantro
--
-- Overtime.
--
-- lib/plan.ts has promised "rates, overtime" as a Payroll-tier feature since it
-- was written. The rate arrived two commits ago. This is the other half.
--
-- WHY OVERTIME CANNOT LIVE IN payableHours()
-- Every other rule in this table is a fact about ONE shift: round it, deduct a
-- break, floor it at a minimum. Overtime is not. "Anything over forty hours in
-- a week" cannot be decided while looking at a single Tuesday -- it depends on
-- what the rest of the week did. So overtime gets its own function that takes a
-- worker's whole week, and payableHours() stays per-shift and stays simple.
--
-- BOTH THRESHOLDS, AND THE DOUBLE-COUNTING TRAP
-- Firms use daily thresholds ("over 8 in a day"), weekly ones ("over 40 in a
-- week"), or both. Both together is where it goes wrong: a 10 hour Monday
-- already contributed 2 hours of daily overtime, and if the weekly calculation
-- then looks at the raw 50 hour total it pays those same 2 hours twice.
--
-- The engine takes daily overtime out FIRST, and the weekly threshold is then
-- applied only to what is left. That is the standard and correct reading, and
-- there is a test named after the trap.
--
-- THE MULTIPLIER IS A MULTIPLIER, NOT A SECOND RATE
-- Time and a half is 1.5 applied to whatever that person's own rate is, so a
-- rate change does not leave a stale overtime rate behind it. Double time is 2.
-- A multiplier below 1 would mean overtime is paid WORSE than basic, which is
-- not a policy, it is a mistake, so it is refused.

begin;

alter table public.pay_rules
  add column if not exists overtime_daily_threshold_hours  numeric(4,2),
  add column if not exists overtime_weekly_threshold_hours numeric(5,2),
  add column if not exists overtime_multiplier             numeric(4,2);

alter table public.pay_rules
  drop constraint if exists pay_rules_overtime_daily_sane;
alter table public.pay_rules
  add constraint pay_rules_overtime_daily_sane
  check (overtime_daily_threshold_hours is null
         or (overtime_daily_threshold_hours > 0 and overtime_daily_threshold_hours <= 24));

alter table public.pay_rules
  drop constraint if exists pay_rules_overtime_weekly_sane;
alter table public.pay_rules
  add constraint pay_rules_overtime_weekly_sane
  check (overtime_weekly_threshold_hours is null
         or (overtime_weekly_threshold_hours > 0 and overtime_weekly_threshold_hours <= 168));

-- At least 1. Below 1 means overtime pays worse than basic, which is a typo
-- every time -- most often 0.5 entered where 1.5 was meant. 3 is past any real
-- policy and catches a decimal point in the wrong place.
alter table public.pay_rules
  drop constraint if exists pay_rules_overtime_multiplier_sane;
alter table public.pay_rules
  add constraint pay_rules_overtime_multiplier_sane
  check (overtime_multiplier is null
         or (overtime_multiplier >= 1 and overtime_multiplier <= 3));

comment on column public.pay_rules.overtime_daily_threshold_hours is
  'Hours in one day above which overtime is paid. Null means no daily overtime.';
comment on column public.pay_rules.overtime_weekly_threshold_hours is
  'Hours in one week above which overtime is paid, applied AFTER daily overtime has been taken out so the same hour is never paid twice. Null means no weekly overtime.';
comment on column public.pay_rules.overtime_multiplier is
  'Applied to the worker''s own rate. 1.5 is time and a half. Null means overtime is paid at basic rate even when a threshold is crossed.';

commit;
