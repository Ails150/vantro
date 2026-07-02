-- Vantro email alerts - per-company configurable rate limit
-- Run in Supabase SQL Editor: https://supabase.com/dashboard/project/lmobuqxmtkctqqwbspoz/sql
-- Date: 2 July 2026
--
-- Idempotent: safe to run whether or not these columns already exist.

-- 1. Per-company rate-limit window in minutes. 0 = no throttling (default).
alter table public.companies
  add column if not exists alert_email_rate_limit_minutes integer not null default 0;

-- 2. Track which installer (user) triggered each alert send, so the rate limit
--    can be keyed per recipient + job + triggering installer. Two different
--    installers raising blockers on the same job both send.
alter table public.email_alert_sends
  add column if not exists triggered_by uuid;

-- 3. Index to support the rate-limit lookup (recipient + job + installer + time).
create index if not exists idx_email_alert_sends_job_trigger_time
  on public.email_alert_sends (job_id, triggered_by, sent_at desc);

-- Verify after running:
-- select column_name, data_type, column_default
-- from information_schema.columns
-- where (table_name = 'companies' and column_name = 'alert_email_rate_limit_minutes')
--    or (table_name = 'email_alert_sends' and column_name = 'triggered_by');
