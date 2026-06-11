-- Fix job_checklists RLS: add SELECT + DELETE policies, and an INSERT policy
-- that includes superadmin (cross-company). Replaces the lone admin/foreman
-- INSERT policy. job_checklists has no company_id -> route via jobs.company_id.
--
-- Run in Supabase SQL Editor:
--   https://supabase.com/dashboard/project/lmobuqxmtkctqqwbspoz/sql
-- Date: 2026-06-11
--
-- Background: table had RLS enabled with only ONE policy
--   "Company admins can insert job_checklists" (INSERT, admin/foreman, own company).
-- No SELECT/DELETE policy => deny for everyone via RLS-subject (browser) clients:
--   * superadmin INSERT denied (role not in array) -> ticking never persisted
--   * DELETE denied for ALL roles -> unticking never worked for anyone
-- Reads were unaffected because the app reads via the service client (RLS bypass).

alter table public.job_checklists enable row level security;

-- Drop the old insert-only policy
drop policy if exists "Company admins can insert job_checklists" on public.job_checklists;

-- Clean re-create (idempotent)
drop policy if exists job_checklists_select on public.job_checklists;
drop policy if exists job_checklists_insert on public.job_checklists;
drop policy if exists job_checklists_delete on public.job_checklists;

-- Shared predicate: admin/foreman limited to their own company's jobs;
-- superadmin allowed across ALL companies.
create policy job_checklists_select on public.job_checklists
  for select
  to authenticated
  using (
    job_id in (
      select j.id from public.jobs j
      where exists (
        select 1 from public.users u
        where u.auth_user_id = auth.uid()
          and u.role = any (array['admin'::text, 'foreman'::text, 'superadmin'::text])
          and (u.role = 'superadmin' or u.company_id = j.company_id)
      )
    )
  );

create policy job_checklists_insert on public.job_checklists
  for insert
  to authenticated
  with check (
    job_id in (
      select j.id from public.jobs j
      where exists (
        select 1 from public.users u
        where u.auth_user_id = auth.uid()
          and u.role = any (array['admin'::text, 'foreman'::text, 'superadmin'::text])
          and (u.role = 'superadmin' or u.company_id = j.company_id)
      )
    )
  );

create policy job_checklists_delete on public.job_checklists
  for delete
  to authenticated
  using (
    job_id in (
      select j.id from public.jobs j
      where exists (
        select 1 from public.users u
        where u.auth_user_id = auth.uid()
          and u.role = any (array['admin'::text, 'foreman'::text, 'superadmin'::text])
          and (u.role = 'superadmin' or u.company_id = j.company_id)
      )
    )
  );

-- Verify:
-- select policyname, cmd, roles from pg_policies
-- where tablename = 'job_checklists' order by cmd;
