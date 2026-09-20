-- 20260920140000_companies_subscription_status_free.sql  -  Vantro
--
-- Free signup has never worked.
--
-- app/api/signup/initiate writes companies.subscription_status = 'free' on the
-- free path. The check constraint allows only:
--
--   pending_card, trialing, active, past_due, unpaid, cancelled
--
-- so the insert fails and the customer is told "Could not create your company"
-- with a 500. The landing page says "Free. No card. No contract." and the
-- button behind it has been returning an error since the free path shipped.
-- Production proves it: not one company row carries the status, and the four
-- oldest carry pending_card from the card-first flow that preceded it.
--
-- Found by walking a real signup end to end on production rather than reading
-- the route.
--
-- The value is ADDED, like 'field' was to users_role_check yesterday. Same
-- shape of bug, same shape of fix: the application grew a word and the
-- database was never told.
--
-- WHY 'free' IS A SUBSCRIPTION STATUS AT ALL, since it is fair to ask. The
-- column answers "what is the billing relationship" and the free plan is one:
-- no card, nothing owed, nothing to fail. The alternative -- reusing 'active'
-- for a company paying nothing -- would make every billing query that asks
-- "who is active" wrong in the direction that costs money to discover.

begin;

alter table public.companies drop constraint if exists companies_subscription_status_check;

alter table public.companies add constraint companies_subscription_status_check
  check (subscription_status in (
    'free', 'pending_card', 'trialing', 'active', 'past_due', 'unpaid', 'cancelled'
  ));

comment on column public.companies.subscription_status is
  'free (no card, nothing owed) | pending_card | trialing | active | past_due | unpaid | cancelled. Written by signup and the Stripe webhook.';

commit;

notify pgrst, 'reload schema';

-- Verify:
--   select pg_get_constraintdef(oid) from pg_constraint
--    where conname = 'companies_subscription_status_check';
--   -- and a free signup now lands:
--   select subscription_status, count(*) from companies group by 1;
