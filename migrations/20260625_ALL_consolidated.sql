-- ============================================================================
-- Vantro — consolidated schema migration (2026-06-25)
-- Covers every schema change from this session. Fully idempotent: safe to run
-- once or repeatedly. Paste into the Supabase SQL editor and run.
--
-- (Aileen's login data fix was already applied via the service role and is NOT
--  included here — it was a one-off data update, not schema.)
-- ============================================================================

-- ── Jobs: new columns ──────────────────────────────────────────────────────
alter table public.jobs
  add column if not exists distance_from_site_km numeric,    -- remote-site fallback
  add column if not exists contractor text,                  -- contractor company name
  add column if not exists geofence_radius_metres integer,   -- per-job geofence override
  add column if not exists gps_source text;                  -- 'manual' | 'installer' | null

-- ── Companies: global default shift times ──────────────────────────────────
alter table public.companies
  add column if not exists default_start_time time,
  add column if not exists default_sign_out_time time;

-- ── Roles: allow 'support' and 'subcontractor' ─────────────────────────────
alter table public.users drop constraint if exists users_role_check;
alter table public.users add constraint users_role_check
  check (role in ('installer', 'foreman', 'admin', 'superadmin', 'support', 'subcontractor'));

-- ── Support tickets (Support tab) ──────────────────────────────────────────
create table if not exists public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  user_id uuid not null,
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
alter table public.support_tickets enable row level security;

-- ── Support access log (GDPR; for the deferred platform-support feature) ───
create table if not exists public.support_access_log (
  id uuid primary key default gen_random_uuid(),
  support_user_id uuid not null,
  support_email text,
  company_id uuid not null,
  company_name text,
  accessed_at timestamptz default now()
);
create index if not exists idx_support_access_log_support on public.support_access_log (support_user_id);
create index if not exists idx_support_access_log_company on public.support_access_log (company_id);
alter table public.support_access_log enable row level security;

-- ── Allow multiple admins per company: drop any admin-uniqueness index ──────
-- (No-op if none exists. Never touches the single-superadmin index.)
do $$
declare r record;
begin
  for r in
    select ci.relname as idxname
    from pg_index i
    join pg_class  ci on ci.oid = i.indexrelid
    join pg_class  ct on ct.oid = i.indrelid
    join pg_namespace n on n.oid = ct.relnamespace
    where n.nspname = 'public' and ct.relname = 'users'
      and i.indisunique and i.indpred is not null
      and pg_get_expr(i.indpred, i.indrelid) ~* 'role'
      and pg_get_expr(i.indpred, i.indrelid) ~* '''admin'''
      and pg_get_expr(i.indpred, i.indrelid) !~* 'superadmin'
  loop
    execute format('drop index if exists public.%I', r.idxname);
    raise notice 'Dropped admin-limiting unique index: %', r.idxname;
  end loop;
end $$;

-- ── Force PostgREST to reload its schema cache so the API sees new columns ──
NOTIFY pgrst, 'reload schema';
