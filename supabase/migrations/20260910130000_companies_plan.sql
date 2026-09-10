-- companies.plan: the single column every feature gate reads from.
--
-- WHY THIS EXISTS
--
-- Entitlement was spread across columns that could disagree: plan (holding the
-- old tier names), current_plan, subscription_status, ai_audit_enabled and
-- stripe_ai_audit_subscription_item_id. A company could be plan='growth' with
-- subscription_status='canceled', or ai_audit_enabled=true with no subscription
-- item behind it, and each call site picked whichever column it knew about.
-- lib/plan.ts now answers "what can this company do" from one value.
--
-- THE COLUMN ALREADY EXISTS
--
-- The upgrade route and the checkout webhook have been writing plan for some
-- time, with the old tier vocabulary: starter, growth, scale. So this is a
-- vocabulary change on live data, not a new column, and the values have to be
-- rewritten BEFORE the check constraint goes on. Constraining first is what
-- made the first attempt fail with 23514.
--
-- THE MAPPING IS DELIBERATELY GENEROUS
--
-- The old tiers were GBP 299/399/499. The new suite tier is GBP 99 and is
-- strictly more capable than any of them, so anyone who was paying anything
-- maps to 'suite'. Mapping a GBP 499 Scale customer down to 'payroll' would
-- remove features they are paying four times over for. Only companies with no
-- payment relationship at all become 'free'.
--
-- Nobody is billed differently by this migration. It records entitlement only;
-- what Stripe charges is unchanged until someone acts in the Billing tab.

begin;

-- 1. Make sure it exists, without assuming anything about its current shape.
--    No default or NOT NULL here: if the column is already present those
--    clauses are skipped entirely, which is how the first attempt ended up
--    constraining a column it had not actually normalised.
alter table public.companies
  add column if not exists plan text;

-- 2. Constraint off before rewriting, and dropped by name so a re-run replaces
--    rather than fails.
alter table public.companies
  drop constraint if exists companies_plan_check;

-- 3. Normalise every row, including ones already holding a new-vocabulary value
--    (left alone by the first branch) and ones holding an old tier name.
update public.companies
   set plan = case
     when plan in ('free', 'payroll', 'suite') then plan
     -- The old paid tiers. All were dearer than suite, so none of them lose out.
     when plan in ('starter', 'growth', 'scale') then 'suite'
     -- No usable plan value: fall back to the other entitlement signals,
     -- most-entitled first.
     when ai_audit_enabled is true then 'suite'
     when stripe_ai_audit_subscription_item_id is not null then 'suite'
     -- past_due is included on purpose: a failed card is a dunning problem, not
     -- a reason to strip features mid-cycle.
     when subscription_status in ('active', 'trialing', 'past_due') then 'suite'
     when current_plan is not null then 'suite'
     else 'free'
   end;

-- 4. Now that every row holds a legal value, tighten the column.
update public.companies set plan = 'free' where plan is null;

alter table public.companies
  alter column plan set default 'free';

alter table public.companies
  alter column plan set not null;

alter table public.companies
  add constraint companies_plan_check
  check (plan in ('free', 'payroll', 'suite'));

-- 5. Apexify to suite explicitly. It is the tenant the e2e suite runs against,
--    so it must have every surface those specs touch regardless of what its
--    billing columns happen to hold.
update public.companies
   set plan = 'suite'
 where name ilike '%Apexify%';

-- 6. Index: every admin page load and every gate resolves a company's plan.
create index if not exists companies_plan_idx on public.companies (plan);

comment on column public.companies.plan is
  'Entitlement tier: free | payroll | suite. Read through lib/plan.ts, never directly. Supersedes current_plan and ai_audit_enabled, which are retained for one release so a rollback has something to read.';

-- DELIBERATELY NOT INCLUDED
--
-- No drop of current_plan, ai_audit_enabled, ai_audit_trial_ends_at or
-- stripe_ai_audit_subscription_item_id. The Stripe webhook still writes some of
-- them, and dropping a column the running deployment writes to fails that
-- webhook immediately. They stop being read in this release and can be dropped
-- in the next one, once nothing has referenced them for a full cycle.
--
-- No new RLS policy. companies already has companies_select_own (which includes
-- 'superadmin'::text in its role array), and a column added to a table inherits
-- the table's policies. Writes to companies all go through the service client.

commit;
