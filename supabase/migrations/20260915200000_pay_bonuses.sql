-- 20260915200000_pay_bonuses.sql  -  Vantro
--
-- Bonuses: money that is not hours.
--
-- Every other figure in this engine is derived -- hours multiplied by a rate,
-- adjusted by rules. A bonus is the opposite: a number a person decided on, for
-- a reason, on a date. It cannot be computed from anything Vantro records, so
-- it is stored rather than derived, and it is the only table here that a human
-- writes a free-text justification into.
--
-- A ROW PER BONUS, NOT A COLUMN ON ANYTHING
-- Bonuses are many-per-worker-per-period and each has its own reason. A column
-- would force one bonus per week and throw away why it was paid, and "why was
-- Dan paid an extra 200 in March" is the entire question anyone ever asks about
-- a bonus.
--
-- A REASON IS REQUIRED
-- Enforced by a check constraint, not just by the route. A bonus with no reason
-- is indistinguishable from a typo six months later, and the person who could
-- explain it has usually left. This is the same argument as the closure note on
-- an incident, and it is enforced the same way.
--
-- AWARDED_ON, NOT A PERIOD
-- A single date rather than a from/to. A bonus belongs to the day it was
-- decided, and payroll picks it up by asking which bonuses fall inside the
-- period being exported. Storing a period would mean two sources of truth about
-- which run a bonus lands in, and they would disagree the first time somebody
-- exported a custom date range.
--
-- NEGATIVE IS ALLOWED, ON PURPOSE
-- A deduction is a bonus with a minus sign: a correction for an overpayment
-- last month, a damaged tool agreed with the worker. Refusing negatives would
-- push those corrections into a spreadsheet, which is exactly where this
-- product is trying to stop things living. The reason field is what keeps that
-- honest.

begin;

create table if not exists public.pay_bonuses (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete cascade,
  user_id      uuid not null references public.users(id) on delete cascade,

  -- Pounds, to the penny. numeric for the same reason every other money column
  -- in this schema is numeric.
  amount       numeric(10,2) not null,

  -- Why. Required, and required in the database.
  reason       text not null,

  -- The day this was decided, which is what payroll filters on.
  awarded_on   date not null default current_date,

  created_by   uuid references public.users(id) on delete set null,
  created_at   timestamptz not null default now(),

  -- Zero is not a bonus, it is a row somebody abandoned halfway through.
  constraint pay_bonuses_amount_non_zero check (amount <> 0),
  -- A five figure bonus through this screen is a misplaced decimal point far
  -- more often than it is a real payment.
  constraint pay_bonuses_amount_sane check (amount >= -100000 and amount <= 100000),
  constraint pay_bonuses_reason_present check (length(btrim(reason)) > 0)
);

-- The one query this table serves: every bonus for a company between two dates,
-- to attach to a payroll run.
create index if not exists pay_bonuses_company_awarded_idx
  on public.pay_bonuses (company_id, awarded_on);

-- And the per-worker view on a payroll screen.
create index if not exists pay_bonuses_user_awarded_idx
  on public.pay_bonuses (user_id, awarded_on);

comment on table public.pay_bonuses is
  'One-off amounts added to a worker''s pay, with a required reason. Negative amounts are deductions and are deliberately permitted.';
comment on column public.pay_bonuses.awarded_on is
  'The day the bonus was decided. Payroll picks up bonuses whose awarded_on falls inside the period being exported.';

alter table public.pay_bonuses enable row level security;

-- No policies, deliberately, matching pay_rules: every read and write goes
-- through the service client behind an admin check. RLS on with no policy means
-- a leaked anon key reaches nothing here.

commit;
