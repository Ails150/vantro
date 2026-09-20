-- 20260920130000_solo_owner_and_deferred_vertical.sql  -  Vantro
--
-- Two columns, both in service of the same person: the subcontractor who is
-- the company AND the crew, on one phone.
--
-- ---------------------------------------------------------------------------
-- users.works_on_site
-- ---------------------------------------------------------------------------
-- An office account that also works on site. It may hold a PIN, it may be
-- assigned to a job, and it appears in the lists that pick people for work.
--
-- WHY A COLUMN AND NOT A ROLE. The role answers "what may this person do in
-- the office", and for an owner the answer is everything; there is no role
-- that means owner-and-worker. foreman is the closest and it is a demotion --
-- it cannot reach settings, billing or payroll. A second user row is worse: it
-- splits one human across two identities, and the PIN lookup is by email
-- address, which would then match two rows.
--
-- WHY IT IS NOT JUST "has a pin_hash". Because the PIN routes need to decide
-- whether to ISSUE one, and inferring the answer from whether one already
-- exists is the exact shape of the bug that let anybody put a PIN on an
-- administrator: an account with no PIN permanently satisfies "no PIN yet".
-- This is a decision, recorded once, by somebody already holding an
-- authenticated session for that company.
--
-- THE TWO ROWS THAT ALREADY DO THIS. Production holds one admin and one
-- superadmin with a PIN, both the owner's, one with thirteen real shifts on
-- it. They pre-date the control and the previous commit deliberately left them
-- working. They are marked here, which is what makes them supported rather
-- than grandfathered: Forgot PIN works for them again, and nothing else
-- changes for them.
--
-- ---------------------------------------------------------------------------
-- companies.vertical_set_at
-- ---------------------------------------------------------------------------
-- Null means nobody has actually answered "what does your team do" -- the
-- column has held 'install' since the row existed, because it is NOT NULL with
-- a default, so its value could never say whether it was chosen or assumed.
-- The question moves out of the setup wizard and is asked the first time
-- somebody opens a screen whose wording depends on it. Existing companies are
-- stamped: they have been using the product under an answer, and asking them
-- again would be a worse guess than the one they are already living with.

begin;

alter table public.users
  add column if not exists works_on_site boolean not null default false;

comment on column public.users.works_on_site is
  'An office account that also works on site: may hold a PIN, may be assigned to jobs, appears in worker pickers. Set by the owner from the dashboard, never by an unauthenticated route. Field roles do not need it.';

-- The owner accounts that already work this way. Narrow on purpose: an office
-- account that has a PIN today got it before the control existed, and the
-- product has been letting them work.
update public.users
   set works_on_site = true
 where pin_hash is not null
   and role in ('admin', 'superadmin', 'support');

alter table public.companies
  add column if not exists vertical_set_at timestamptz;

comment on column public.companies.vertical_set_at is
  'When somebody actually answered what the team does. Null means the vertical is still the default rather than a choice, and the question has not been asked yet.';

-- Everyone who signed up before this has lived under an answer; do not ask again.
update public.companies
   set vertical_set_at = coalesce(onboarding_completed_at, created_at, now())
 where vertical_set_at is null;

commit;

notify pgrst, 'reload schema';

-- Verify:
--   select role, count(*) filter (where works_on_site) from users group by role;
--   select count(*) from companies where vertical_set_at is null;  -- 0
