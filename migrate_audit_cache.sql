-- migrate_audit_cache.sql  -  Scale 8 / Vantro
-- Run once in the Supabase SQL editor. Creates the cache table the patched
-- audit/v2 route reads/writes. Self-contained; does not touch audit_packs.

create table if not exists public.audit_ai_cache (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null,
  company_id uuid not null,
  cache_key text not null,
  fingerprint text not null,
  exec_summary text,
  red_flags jsonb default '[]'::jsonb,
  deliverable_narratives jsonb default '{}'::jsonb,
  generated_at timestamptz default now(),
  unique (job_id, cache_key)
);

-- Only the service role (used by the API route) should touch this.
-- Enabling RLS with no policies blocks direct anon/auth access; the service
-- client bypasses RLS, so the route keeps working.
alter table public.audit_ai_cache enable row level security;
