-- 20260916110000_pay_rules_weekends.sql  -  Vantro
--
-- Saturday and Sunday multipliers.
--
-- Weekend rates are near-universal in construction subcontracting and are
-- usually quoted separately from overtime: "time and a half Saturday, double
-- Sunday" is a term of the contract, not a consequence of having worked forty
-- hours already. So they are their own columns rather than something derived
-- from the overtime rules.
--
-- THEY FOLLOW THE BANK HOLIDAY RULE EXACTLY, AND ON PURPOSE.
-- A Saturday shift is removed from the week before overtime is calculated,
-- paid at the Saturday rate, and never receives an overtime multiplier on top.
-- Same for Sunday. This is the same reading already implemented for bank
-- holidays in 20260915190000, and consistency matters more here than in most
-- places: an admin who has understood how bank holiday pay behaves should not
-- have to learn a second, different rule for Saturday.
--
-- The consequence is the same one, and is stated on the settings screen: those
-- hours do not count towards a weekly overtime threshold, because they have
-- already been enhanced.
--
-- PRECEDENCE WHERE A DAY IS BOTH.
-- A bank holiday that falls on a Sunday -- Christmas Day 2033, and every
-- substitute day in between -- is both. The engine applies the HIGHEST single
-- multiplier and never multiplies them together. Nobody's contract says a
-- Sunday bank holiday pays 4x, and the alternative readings (bank holiday
-- always wins, or weekend always wins) would each be wrong for half of real
-- contracts. Highest-single is the one nobody argues with.

begin;

alter table public.pay_rules
  add column if not exists saturday_multiplier numeric(4,2),
  add column if not exists sunday_multiplier   numeric(4,2);

-- Same bounds and reasoning as the overtime and bank holiday multipliers:
-- below 1 means paying LESS for a weekend, which is a typo rather than a
-- policy, and above 3 is a misplaced decimal point.
alter table public.pay_rules
  drop constraint if exists pay_rules_saturday_multiplier_sane;
alter table public.pay_rules
  add constraint pay_rules_saturday_multiplier_sane
  check (saturday_multiplier is null or (saturday_multiplier >= 1 and saturday_multiplier <= 3));

alter table public.pay_rules
  drop constraint if exists pay_rules_sunday_multiplier_sane;
alter table public.pay_rules
  add constraint pay_rules_sunday_multiplier_sane
  check (sunday_multiplier is null or (sunday_multiplier >= 1 and sunday_multiplier <= 3));

comment on column public.pay_rules.saturday_multiplier is
  'Applied to hours worked on a Saturday. Those hours leave the week before overtime is calculated and never take an overtime multiplier as well. Null means Saturday pays as any other day.';
comment on column public.pay_rules.sunday_multiplier is
  'As saturday_multiplier, for Sunday. Where a day is both a weekend day and a bank holiday, the highest single multiplier applies; they are never multiplied together.';

commit;
