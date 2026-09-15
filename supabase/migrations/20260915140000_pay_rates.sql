-- 20260915140000_pay_rates.sql  -  Vantro
--
-- What an hour is worth. The first half of turning verified attendance into
-- money.
--
-- Vantro has recorded true hours since the beginning and has never known what
-- any of them cost. lib/plan.ts has advertised "rates, overtime" as part of the
-- Payroll tier since that file was written, and neither existed. The export is
-- hours, and somebody retypes them into Sage with a rate they keep in their
-- head. This is the column that ends that.
--
-- TWO PLACES, ON PURPOSE: A RATE PER PERSON, WITH A COMPANY FALLBACK
--
--   users.hourly_rate              what this person is paid
--   companies.default_hourly_rate  what someone with no rate set is paid
--
-- The fallback is not a convenience, it is what makes the feature usable on day
-- one. A firm with forty installers will not fill in forty rates before they
-- can see a single pay figure, and a payroll screen that reads GBP 0.00 for
-- everyone until they do is one nobody comes back to. They set one default,
-- get a plausible total immediately, and override the people who differ.
--
-- The rate is deliberately NOT per job and NOT per trade. That is the more
-- correct model for subcontracting and it was considered and rejected for now:
-- it needs a rate table, a resolution order, and a UI for every combination,
-- and every one of those is another place a rate can be left unset. An unset
-- rate silently underpays somebody, which is the worst failure this feature
-- has. One rate per person, one fallback, and both visible on screens that
-- already exist.
--
-- NO HISTORY, AND THE CONSEQUENCE STATED
-- Changing a rate changes what past hours are worth, because pay is computed
-- from hours multiplied by the rate as it stands now. That is wrong for a
-- payroll system of record and right for this one: Vantro produces a figure to
-- hand to a payroll system, not a pay slip. When rate history is needed, it
-- needs an effective_from table and every computation re-pointed at it, and
-- that is a bigger change than adding a column. Written down here so the day
-- somebody asks "why did last month's export change", the answer is findable.

begin;

alter table public.users
  -- numeric, never float. This gets multiplied by hours and shown as money.
  -- 10,2 comfortably holds any hourly rate a construction firm pays, and two
  -- decimals is what a rate is quoted in.
  add column if not exists hourly_rate numeric(10,2);

alter table public.companies
  add column if not exists default_hourly_rate numeric(10,2);

-- Zero is allowed and means something real: an unpaid working director, or a
-- worker whose pay is handled entirely outside Vantro. Negative is always a
-- typo. Null means "not set", which is what makes the fallback fire -- so null
-- and zero are deliberately different values here and the resolver treats them
-- differently.
alter table public.users
  drop constraint if exists users_hourly_rate_non_negative;
alter table public.users
  add constraint users_hourly_rate_non_negative
  check (hourly_rate is null or hourly_rate >= 0);

alter table public.companies
  drop constraint if exists companies_default_hourly_rate_non_negative;
alter table public.companies
  add constraint companies_default_hourly_rate_non_negative
  check (default_hourly_rate is null or default_hourly_rate >= 0);

-- An upper bound as well, because the realistic error is a rate typed in pence
-- (1850 for GBP 18.50) and that would quietly multiply one person's week by a
-- hundred. A four figure hourly rate is not a thing any of these companies pay,
-- and refusing it at the database means no route, import or integration can
-- introduce it.
alter table public.users
  drop constraint if exists users_hourly_rate_sane;
alter table public.users
  add constraint users_hourly_rate_sane
  check (hourly_rate is null or hourly_rate <= 1000);

alter table public.companies
  drop constraint if exists companies_default_hourly_rate_sane;
alter table public.companies
  add constraint companies_default_hourly_rate_sane
  check (default_hourly_rate is null or default_hourly_rate <= 1000);

comment on column public.users.hourly_rate is
  'What this person is paid per hour. Null falls back to companies.default_hourly_rate. Zero is a real rate and does not fall back.';
comment on column public.companies.default_hourly_rate is
  'Rate used for any worker with no hourly_rate of their own. Null means pay cannot be computed for those workers.';

commit;
