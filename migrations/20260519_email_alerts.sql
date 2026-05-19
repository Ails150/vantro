-- Vantro email alerts - schema migration
-- Run in Supabase SQL Editor: https://supabase.com/dashboard/project/lmobuqxmtkctqqwbspoz/sql
-- Date: 19 May 2026

-- 1. Add email_alert_prefs column to users table
-- Default: enabled for all existing admins/foremen so nobody loses alerts when this ships
alter table public.users
  add column if not exists email_alert_prefs jsonb
  default jsonb_build_object('enabled', true, 'blockers', true, 'issues', true);

-- 2. Track email sends for rate limiting (1 email per job per hour per recipient)
create table if not exists public.email_alert_sends (
  id uuid primary key default gen_random_uuid(),
  recipient_email text not null,
  company_id uuid not null,
  job_id uuid,
  alert_type text not null,
  sent_at timestamptz not null default now()
);

create index if not exists idx_email_alert_sends_recipient_job_time
  on public.email_alert_sends (recipient_email, job_id, sent_at desc);

create index if not exists idx_email_alert_sends_sent_at
  on public.email_alert_sends (sent_at);

-- 3. RLS - service role only (this table is server-managed only)
alter table public.email_alert_sends enable row level security;

-- No SELECT/INSERT/UPDATE/DELETE policies = only service role can touch it
-- (Service role bypasses RLS entirely)

-- 4. Cleanup function - drop rows older than 7 days (rate limit window is 1h, we keep 7d for audit)
create or replace function public.cleanup_email_alert_sends()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.email_alert_sends where sent_at < now() - interval '7 days';
$$;

-- Verify after running:
-- select column_name, data_type, column_default
-- from information_schema.columns
-- where table_name = 'users' and column_name = 'email_alert_prefs';
--
-- select count(*) from public.users where email_alert_prefs is not null;
