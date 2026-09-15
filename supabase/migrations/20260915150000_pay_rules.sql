-- 20260915150000_pay_rules.sql  -  Vantro
--
-- The rules that turn hours at a rate into what somebody is actually owed.
--
-- One row per company, created on demand. Not columns on companies: there are
-- eight of them and there will be more, they are read together as a set by one
-- function, and companies is already a wide table that half the application
-- selects with *. A named table also means "has this company configured pay
-- yet" is answerable by the row existing.
--
-- WHY ALL OF IT IS OPTIONAL AND OFF BY DEFAULT
-- Every rule here changes what a worker is paid. A default that silently
-- deducts half an hour, or quietly pays time and a half, would change payroll
-- totals for existing companies the moment this deploys -- for people who never
-- asked for it and would have no idea why their figures moved. So a company
-- with no pay_rules row gets exactly today's behaviour: hours multiplied by
-- rate, nothing added, nothing taken away. Every rule is opted into explicitly.
--
-- This migration creates the table and the two rules that are pure
-- configuration. Breaks, lateness, overtime, bank holiday pay and bonuses each
-- arrive in their own migration with their own engine code and tests, so that
-- any one of them can be reverted without taking the others with it.

begin;

create table if not exists public.pay_rules (
  -- The company IS the key. One set of rules per company, and making the
  -- primary key the company id makes a second row impossible rather than merely
  -- unlikely -- two rows here would mean two answers to "what is this person
  -- owed", resolved by whichever the query happened to return first.
  company_id  uuid primary key references public.companies(id) on delete cascade,

  -- --- Rounding --------------------------------------------------------------
  -- Round each shift's worked time to a number of minutes before it is paid.
  --
  -- Null means do not round, which is the default and the honest one: Vantro
  -- records real sign-in and sign-out times, and rounding is a deliberate
  -- commercial choice on top of a true measurement. Where a company does round,
  -- it is nearly always to 15 minutes.
  round_to_minutes            integer,

  -- Which way rounding goes. 'nearest' is the fair default where rounding is on
  -- at all; 'up' favours the worker, 'down' favours the company and is the one
  -- that gets a firm into trouble, so it is possible but never a default.
  rounding_direction          text not null default 'nearest',

  -- --- Minimum paid shift ----------------------------------------------------
  -- A worker called to site and sent home after twenty minutes is often owed a
  -- minimum. Null means no minimum applies.
  minimum_paid_minutes        integer,

  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),

  constraint pay_rules_round_to_minutes_sane
    check (round_to_minutes is null or (round_to_minutes between 1 and 60)),
  constraint pay_rules_rounding_direction_valid
    check (rounding_direction in ('nearest', 'up', 'down')),
  constraint pay_rules_minimum_paid_minutes_sane
    check (minimum_paid_minutes is null or (minimum_paid_minutes between 0 and 1440))
);

comment on table public.pay_rules is
  'Per-company rules applied on top of hours x rate. No row means no rules: hours x rate exactly, which is the behaviour every company had before this table existed.';
comment on column public.pay_rules.round_to_minutes is
  'Round each shift to this many minutes before paying it. Null means pay the real recorded time.';
comment on column public.pay_rules.rounding_direction is
  'nearest | up | down. Only meaningful when round_to_minutes is set.';
comment on column public.pay_rules.minimum_paid_minutes is
  'Shortest shift that will be paid, in minutes. A shorter shift is paid as this. Null means no minimum.';

-- Keep updated_at honest. Pay rules are the kind of setting somebody changes
-- and then denies changing, and the answer to "when did this change" should not
-- depend on the application remembering to set a column.
create or replace function public.pay_rules_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists pay_rules_touch_updated_at on public.pay_rules;
create trigger pay_rules_touch_updated_at
  before update on public.pay_rules
  for each row execute function public.pay_rules_touch_updated_at();

alter table public.pay_rules enable row level security;

-- No policies, deliberately. Every read and write goes through the service
-- client behind an admin check in the route, exactly as jobs and companies do
-- in this codebase. RLS on with no policy means a leaked anon key reaches
-- nothing here at all, which is the safer failure.

commit;
