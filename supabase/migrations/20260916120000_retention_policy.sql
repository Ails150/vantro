-- 20260916120000_retention_policy.sql  -  Vantro
--
-- A retention policy a paid company chooses for itself.
--
-- BUILT ON data_retention_days, WHICH ALREADY EXISTED. It was read by exactly
-- one thing -- /api/cleanup, weekly, deleting location_logs older than the
-- value or 90 days if unset -- and by nothing else. So a company could set it
-- and every shift, diary entry, photograph and signature would be kept
-- regardless. This makes the column mean what its name says.
--
-- THREE CHOICES, AND WHY THOSE THREE
--   forever   null. The default, and what every existing company already has
--             in effect.
--   3 years   1095 days. Long enough for most commercial disputes.
--   6 years   2190 days. The Limitation Act 1980 gives six years for an action
--             on a simple contract, so six years of evidence is the span a
--             subcontractor can still be sued across.
--
-- Not offered: anything shorter. Health and safety records have their own
-- statutory minimums and a subcontractor who deletes attendance at twelve
-- months has destroyed their own defence. A company that genuinely needs
-- shorter can be set to it by hand; it will not be one click in a settings
-- screen.
--
-- NULL MEANS FOREVER, and that is a change of meaning for /api/cleanup, which
-- treated null as "90 days" for location_logs. That route is updated in the
-- same commit: GPS breadcrumbs are high-volume telemetry rather than evidence,
-- and they keep their own 90-day cap, tightened where a company's policy is
-- shorter. Retention is a floor on privacy, not a licence to keep telemetry.
--
-- THE THIRTY DAY GRACE IS THE POINT OF retention_policy_set_at.
-- Choosing "3 years" on a company with four years of history would, without
-- it, silently destroy a year of records the moment a nightly job next ran.
-- The first purge under a policy is held for thirty days, a banner says exactly
-- what will go and when, and the countdown restarts if the policy changes
-- again. Somebody who picks the wrong option has a month to notice.

begin;

alter table public.companies
  -- When the CURRENT policy was chosen. Null means never chosen, which is the
  -- same as "forever" and is what every existing company has.
  add column if not exists retention_policy_set_at timestamptz,
  -- Who chose it. A setting that destroys records should have a name on it.
  add column if not exists retention_policy_set_by uuid references public.users(id) on delete set null;

-- Guard the value rather than the choice. The three options above are what the
-- UI offers; the constraint exists to stop a nonsense number reaching a delete
-- statement. One day is refused outright -- there is no legitimate reading of
-- it, and it would erase a company overnight.
alter table public.companies
  drop constraint if exists companies_data_retention_days_sane;
alter table public.companies
  add constraint companies_data_retention_days_sane
  check (data_retention_days is null or (data_retention_days >= 30 and data_retention_days <= 36500));

comment on column public.companies.data_retention_days is
  'How long records are kept, in days. NULL means keep for ever, which is the default. 1095 is three years, 2190 is six. Enforced nightly by /api/cron/retention-purge, thirty days after retention_policy_set_at.';
comment on column public.companies.retention_policy_set_at is
  'When the current retention policy was chosen. The first purge under it is held for thirty days from this timestamp so a wrong choice can be undone.';

-- ---------------------------------------------------------------------------
-- What a purge did, kept
-- ---------------------------------------------------------------------------
--
-- A purge destroys records permanently. "What did we delete, when, and under
-- which policy" has to be answerable afterwards, and it cannot be answered from
-- the rows themselves because they are gone. This is small, append-only in
-- practice, and deliberately NOT swept by the purge it records.
create table if not exists public.retention_purges (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies(id) on delete cascade,

  -- The policy in force at the time, copied rather than referenced: the
  -- company's setting may since have changed, and the record must say what was
  -- applied on the night.
  retention_days    integer not null,
  -- Everything older than this went.
  cutoff            timestamptz not null,

  -- table name -> rows deleted.
  deleted           jsonb not null default '{}'::jsonb,
  total_deleted     integer not null default 0,

  ran_at            timestamptz not null default now()
);

create index if not exists retention_purges_company_idx
  on public.retention_purges (company_id, ran_at desc);

comment on table public.retention_purges is
  'One row per company per nightly purge that deleted something. The only surviving record of what a retention policy destroyed.';

alter table public.retention_purges enable row level security;
-- No policies: written by the cron through the service client, read by an admin
-- route behind an admin check. Matches pay_rules and mfa_recovery_codes.

commit;
