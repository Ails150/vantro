-- 20260902_audit_credits.sql  -  Vantro
-- Pay-as-you-go audit pack credits.
--
-- Today the AI Audit Pack is a £79/mo subscription item and generating a pack
-- is free once enabled (companies.ai_audit_enabled). This adds the second
-- model: a company on PAYG buys credits up front and spends one per audit
-- pack. Subscription companies are untouched -- audit_billing defaults to
-- 'included' and every existing row takes that default.
--
-- Three objects:
--   companies.audit_billing  which model a company is on
--   audit_credits            the balance, one row per company, the thing locked
--                            and decremented
--   audit_credit_ledger      append-only history of every movement, the thing
--                            shown in the Billing tab and reconciled against
--                            Stripe
--
-- Balance is stored rather than derived from the ledger. Summing an
-- append-only log on every generate is both slower and harder to make safe:
-- the balance row gives `select ... for update` a single row to lock, which is
-- what makes consume_audit_credit atomic under concurrent generates.
-- audit_credit_ledger.balance_after keeps the two reconcilable, so a drift bug
-- is visible rather than silent.
--
-- ROW COUNTS BEFORE (live, 2026-09-02):
--   companies                    12   -> all take audit_billing = 'included'
--   audit_credits                 -   (table does not exist)
--   audit_credit_ledger           -   (table does not exist)
--
-- ORDER OF DEPLOY. Additive and safe in either order. Nothing reads these
-- until the consume function and the generate-route guard ship.
--
-- Rollback:
--   drop table if exists public.audit_credit_ledger;
--   drop table if exists public.audit_credits;
--   alter table public.companies drop column if exists audit_billing;

begin;

-- ---------------------------------------------------------------------------
-- 1. Which billing model a company is on.
-- ---------------------------------------------------------------------------
alter table public.companies
  add column if not exists audit_billing text not null default 'included';

alter table public.companies
  drop constraint if exists companies_audit_billing_check;

alter table public.companies
  add constraint companies_audit_billing_check
  check (audit_billing in ('included', 'payg'));

-- ---------------------------------------------------------------------------
-- 2. The balance.
-- ---------------------------------------------------------------------------
create table if not exists public.audit_credits (
  company_id  uuid primary key references public.companies(id) on delete cascade,
  balance     integer not null default 0,
  updated_at  timestamptz not null default now(),

  -- Belt and braces. consume_audit_credit will refuse to spend a credit that
  -- is not there, but if it is ever wrong the database still will not let a
  -- company go negative and quietly accrue free packs.
  constraint audit_credits_balance_non_negative check (balance >= 0)
);

-- ---------------------------------------------------------------------------
-- 3. The history.
-- ---------------------------------------------------------------------------
create table if not exists public.audit_credit_ledger (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies(id) on delete cascade,

  -- Positive credits, negative debits. Never zero.
  delta          integer not null,
  reason         text    not null,

  -- The balance this row produced, so the ledger can be read and reconciled
  -- without replaying every prior row.
  balance_after  integer not null,

  -- Consumption context, all null on purchases.
  --
  -- pack_id identifies this generated pack: a fresh uuid minted per generate
  -- call. A job can be audited more than once over different periods, and each
  -- of those is a distinct pack, so pack_id is an identity -- not a dedupe key.
  --
  -- What makes two generates the same purchase is the tuple below: the job,
  -- the period and the view. That is what the unique index enforces.
  -- period_from / period_to are the `from` / `to` of /api/audit/v2 -- plain
  -- dates, nullable, where null means "the whole job".
  --
  -- ON DELETE SET NULL rather than cascade: a deleted job or a departed user
  -- must not erase financial history.
  pack_id        uuid,
  job_id         uuid references public.jobs(id) on delete set null,
  period_from    date,
  period_to      date,
  view           text,
  user_id        uuid references public.users(id) on delete set null,

  -- Purchase context, null on consumption.
  stripe_checkout_session_id text,
  stripe_payment_intent_id   text,
  quantity                   integer,

  created_at     timestamptz not null default now(),

  constraint audit_credit_ledger_delta_non_zero check (delta <> 0),
  constraint audit_credit_ledger_reason_check
    check (reason in ('purchase', 'consume', 'refund', 'grant', 'adjustment')),
  constraint audit_credit_ledger_view_check
    check (view is null or view in ('internal', 'client', 'external')),

  -- A consume row without a job, a view or a pack identity cannot be
  -- reconciled and would slip past the unique index below on a null. Reject it
  -- at write time rather than discover it in a billing dispute.
  constraint audit_credit_ledger_consume_shape_check
    check (
      reason <> 'consume'
      or (pack_id is not null and job_id is not null and view is not null)
    )
);

-- A Stripe webhook is delivered at least once, not exactly once. This is what
-- makes a replayed checkout.session.completed a no-op instead of free credits.
create unique index if not exists audit_credit_ledger_checkout_session_uniq
  on public.audit_credit_ledger (stripe_checkout_session_id)
  where stripe_checkout_session_id is not null;

-- Charge once per (job, period, view). Regenerating the same pack -- a
-- refresh, a retry after a timeout, a second admin opening the same job --
-- must not bill again, while auditing the same job over a different period is
-- a new pack and a fair new charge. This index is the guarantee;
-- consume_audit_credit relies on it rather than checking first and hoping.
--
-- coalesce rather than the bare columns: a null period means "the whole job",
-- and nulls compare distinct in a unique index, so two whole-job packs would
-- both be let through and billed twice. The sentinels collapse that to one row.
create unique index if not exists audit_credit_ledger_consume_uniq
  on public.audit_credit_ledger (
    company_id,
    job_id,
    coalesce(period_from, '-infinity'::date),
    coalesce(period_to, 'infinity'::date),
    view
  )
  where reason = 'consume';

-- The Billing tab reads a company's history newest first.
create index if not exists audit_credit_ledger_company_created_idx
  on public.audit_credit_ledger (company_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 4. RLS. Every other table in this schema has it on, and these two are
--    reached only by server routes holding the service role, which bypasses
--    RLS. Enabled with no policies: deny by default to anon and authenticated,
--    so a leaked anon key cannot read what a company has spent.
-- ---------------------------------------------------------------------------
alter table public.audit_credits       enable row level security;
alter table public.audit_credit_ledger enable row level security;

commit;

notify pgrst, 'reload schema';

-- Verify:
--   select audit_billing, count(*) from companies group by audit_billing;
--     -> included | 12
--   select count(*) from audit_credits;         -> 0
--   select count(*) from audit_credit_ledger;   -> 0
--   select relname, relrowsecurity from pg_class
--    where relname in ('audit_credits','audit_credit_ledger');  -> both true
