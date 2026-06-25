-- 20260625_support_tickets.sql  -  Vantro
-- Support tickets raised by company admins/superadmins, emailed to Aileen.
--
-- Run once in the Supabase SQL editor.

create table if not exists public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  user_id uuid not null,                 -- users.id of the person who raised it
  raised_by_name text,
  raised_by_email text,
  title text not null,
  description text not null,
  screenshot_url text,
  status text not null default 'open' check (status in ('open', 'in_progress', 'resolved')),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_support_tickets_user on public.support_tickets (user_id);
create index if not exists idx_support_tickets_company on public.support_tickets (company_id);

-- Service-role only (the API routes use the service client, which bypasses RLS).
-- Enabling RLS with no policies blocks direct anon/auth access.
alter table public.support_tickets enable row level security;
