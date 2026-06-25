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

-- The 'support' role is a free-text value in users.role (there is no central
-- role enum). If a CHECK constraint on users.role exists, it must be widened to
-- permit 'support' — this surfaces it so you can update it in Supabase.
do $$
declare c record;
begin
  for c in
    select con.conname, pg_get_constraintdef(con.oid) as def
    from pg_constraint con
    join pg_class t on t.oid = con.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public' and t.relname = 'users' and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%role%'
  loop
    raise notice 'users.role CHECK constraint % may need to allow ''support'': %', c.conname, c.def;
  end loop;
end $$;
