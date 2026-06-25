-- 20260625_support_role.sql  -  Vantro
-- Platform "support" role: full admin access across ANY company, flagged
-- separately in the UI, invisible in company Team tabs. Every company a
-- support user opens is recorded for GDPR (user, company, timestamp).
--
-- Run once in the Supabase SQL editor.

-- GDPR access log: one row each time a support user enters a company.
create table if not exists public.support_access_log (
  id uuid primary key default gen_random_uuid(),
  support_user_id uuid not null,         -- users.id of the support user
  support_email text,
  company_id uuid not null,
  company_name text,
  accessed_at timestamptz default now()
);

create index if not exists idx_support_access_log_support on public.support_access_log (support_user_id);
create index if not exists idx_support_access_log_company on public.support_access_log (company_id);

-- Service-role only (routes use the service client, which bypasses RLS).
alter table public.support_access_log enable row level security;

-- users.role has a CHECK constraint (users_role_check) that must permit the new
-- 'support' role. Widen it to include every role the app uses. Safe/idempotent.
alter table public.users drop constraint if exists users_role_check;
alter table public.users add constraint users_role_check
  check (role in ('installer', 'foreman', 'admin', 'superadmin', 'support'));
