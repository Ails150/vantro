-- 20260915170000_pay_rules_lateness.sql  -  Vantro
--
-- Lateness.
--
-- Vantro knows the exact minute somebody arrived on site and has never once
-- said whether that was late. The information is the most useful thing the
-- product holds for a supervisor and it has been sitting unread in a timestamp.
--
-- LATENESS DOES NOT REDUCE PAY, AND THIS IS THE WHOLE DESIGN
-- Pay is hours multiplied by a rate. A worker who arrives forty minutes late
-- worked forty minutes less and is ALREADY paid forty minutes less. Deducting
-- again for the lateness would charge them twice for one offence -- and doing
-- that automatically, across a whole company, from a GPS timestamp, is the kind
-- of thing that ends up at a tribunal.
--
-- So this column adds no arithmetic to the pay engine. It adds a fact to a
-- screen: who was late, by how long, how often. What to do about it is a
-- conversation between a supervisor and a person, which is where it belongs.
--
-- ONE COLUMN: THE GRACE
-- Deliberately NOT the same value as companies.grace_period_minutes. That one
-- is the sign-OUT grace -- the window after a shift's end time before hours are
-- calculated to the last on-site GPS fix. Reusing it here would couple two
-- unrelated policies, so that a company relaxing its sign-out handling would
-- silently stop reporting late arrivals. They are different numbers with
-- different meanings and they get different columns.
--
-- Null means lateness is not reported at all. A firm whose crews start when
-- they get there does not want a screen full of red.

begin;

alter table public.pay_rules
  add column if not exists lateness_grace_minutes integer;

-- Zero is meaningful and different from null: report anybody who is even one
-- minute past the start time. Two hours is past the point where "late" is the
-- right word and something else has happened.
alter table public.pay_rules
  drop constraint if exists pay_rules_lateness_grace_sane;
alter table public.pay_rules
  add constraint pay_rules_lateness_grace_sane
  check (lateness_grace_minutes is null or (lateness_grace_minutes between 0 and 120));

comment on column public.pay_rules.lateness_grace_minutes is
  'Minutes after the scheduled start before an arrival counts as late. Null means do not report lateness. REPORTING ONLY: this never changes pay, because a late worker is already paid for fewer hours.';

commit;
