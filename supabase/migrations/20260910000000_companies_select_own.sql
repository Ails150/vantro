-- companies: SELECT for the authenticated role, scoped to your own company.
--
-- WHY THIS EXISTS
--
-- public.companies had RLS enabled and no SELECT policy for `authenticated`,
-- which is a deny. Every read through an RLS-scoped (browser/session) client
-- returned zero rows, and `.single()` then left `company` as null rather than
-- raising. Null is falsy, so each company-derived gate silently read as "off":
--
--   * company.ai_audit_enabled read as undefined, so the Audit tab showed the
--     GBP 79 paywall to companies that had already paid for it.
--   * trialExpiredAndUnpaid could never become true, so the trial paywall
--     never fired.
--
-- app/admin/page.tsx works around this today by reading the company with the
-- SERVICE client, scoped by hand to the caller's own company id. That is safe
-- but it means RLS is not the thing enforcing tenancy on this table - the
-- correctness of every call site is. This policy puts the guarantee back in
-- the database, so a future call site that forgets the manual scoping fails
-- closed instead of leaking another tenant's row.
--
-- SCOPING
--
-- Membership is resolved through public.users.auth_user_id -> auth.uid(), the
-- same join every other policy in this repo uses. A user sees exactly the
-- company on their own row.
--
-- superadmin is included, as in every other role array here, and is the one
-- role that crosses company boundaries: support and platform staff need to
-- read any tenant. Note the check is `u.role = 'superadmin' OR company match`,
-- so an ordinary admin is still confined to their own row.
--
-- DELIBERATELY NOT INCLUDED
--
-- No `alter table public.companies enable row level security` here. Evidence
-- says RLS is already on for this table (that is why reads returned nothing).
-- If it somehow were not, switching it on in the same migration that adds a
-- read policy would immediately deny every INSERT and UPDATE that currently
-- succeeds - company creation at signup, plan changes from the Stripe webhook -
-- because no write policy exists yet. Turning RLS on is a separate, deliberate
-- migration that has to add the write policies in the same breath.
--
-- Also no SELECT policy for INSERT/UPDATE/DELETE: writes to companies all run
-- through the service client today, which bypasses RLS. Adding write policies
-- without auditing those call sites would be guesswork.

begin;

-- Idempotent: re-running the migration replaces the policy rather than failing.
drop policy if exists companies_select_own on public.companies;

create policy companies_select_own
  on public.companies
  for select
  to authenticated
  using (
    exists (
      select 1
        from public.users u
       where u.auth_user_id = auth.uid()
         and u.role = any (
               array['admin'::text, 'foreman'::text, 'superadmin'::text,
                     'support'::text, 'field'::text, 'installer'::text,
                     'subcontractor'::text]
             )
         and (u.role = 'superadmin'::text or u.company_id = public.companies.id)
    )
  );

commit;

-- Verify. Expect one row, cmd = SELECT, roles = {authenticated}:
--   select policyname, cmd, roles
--     from pg_policies
--    where schemaname = 'public' and tablename = 'companies';
--
-- And confirm RLS is actually on, or the policy above is inert:
--   select relrowsecurity
--     from pg_class c join pg_namespace n on n.oid = c.relnamespace
--    where n.nspname = 'public' and c.relname = 'companies';
--
-- Once this is live, the service-client read in app/admin/page.tsx can go back
-- to the RLS-scoped client. Leave it until this is confirmed in production.
