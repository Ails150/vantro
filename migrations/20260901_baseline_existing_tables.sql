-- Baseline: sites, job_visits, visit_assignments, signins, jobs
--
-- These five tables were created directly in the Supabase SQL editor and have
-- never been in version control. docs/phase2-multisite-audit.md reconstructed
-- them by reading the application code, and several of those reconstructions
-- turned out to be wrong. This file replaces guesswork with the live shape.
--
-- HOW THIS WAS PRODUCED, AND WHAT IT CANNOT SEE
--
-- Source: the project's own PostgREST OpenAPI description
-- (GET <project>/rest/v1/ with the service role key), read on 2026-09-01.
-- That is authoritative for: table and column names, data types, nullability,
-- primary keys, foreign key targets, and column defaults.
--
-- It does NOT expose: unique constraints, check constraints, non-PK indexes,
-- partial indexes, triggers, or row level security policies. Anything in this
-- file about those is therefore ABSENT, not "known to be absent".
--
-- To close that gap, run docs/schema.sql in the SQL editor and commit the CSV,
-- then extend this file. Until then, treat uniqueness as unverified: notably,
-- nothing here confirms whether visit_assignments(visit_id, user_id) is unique,
-- and app/api/admin/visit-assignments/route.ts guards it with a read then
-- insert, which races.
--
-- The statements below are written IF NOT EXISTS so this file is safe to run
-- against the live database. On the existing project every one is a no-op; its
-- value is as the committed record and as the shape a fresh environment gets.

-- ---------------------------------------------------------------------------
-- sites
-- ---------------------------------------------------------------------------
create table if not exists sites (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id),
  name        text not null,
  address     text not null,
  postcode    text,
  client_name text,                 -- free text; there is no sites.client_id
  notes       text,
  lat         double precision,
  lng         double precision,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- job_visits  -- the dated schedulable unit
-- ---------------------------------------------------------------------------
create table if not exists job_visits (
  id                  uuid primary key default gen_random_uuid(),
  job_id              uuid not null references jobs(id),
  company_id          uuid not null references companies(id),
  start_at            timestamptz not null,
  end_at              timestamptz,
  address             text,             -- a visit can carry its own location,
  lat                 double precision, -- independent of the job's
  lng                 double precision,
  stage               text,
  notes               text,
  status              text not null default 'scheduled',
  created_by          uuid references users(id),
  created_at          timestamptz default now(),
  updated_at          timestamptz default now(),
  completed_at        timestamptz,
  cancelled_at        timestamptz,
  cancellation_reason text
);
-- No site_id. A visit cannot point at a site.

-- ---------------------------------------------------------------------------
-- visit_assignments  -- who is on a visit; already many rows per visit
-- ---------------------------------------------------------------------------
create table if not exists visit_assignments (
  id          uuid primary key default gen_random_uuid(),
  visit_id    uuid not null references job_visits(id),
  user_id     uuid not null references users(id),
  company_id  uuid not null references companies(id),
  start_at    timestamptz,   -- exists, but no write path populates it
  end_at      timestamptz,   -- same
  role        text,
  assigned_at timestamptz default now(),
  assigned_by uuid references users(id)
);

-- ---------------------------------------------------------------------------
-- signins
-- ---------------------------------------------------------------------------
create table if not exists signins (
  id                        uuid primary key default gen_random_uuid(),
  job_id                    uuid not null references jobs(id),
  user_id                   uuid not null references users(id),
  company_id                uuid not null references companies(id),
  lat                       double precision not null,
  lng                       double precision not null,
  accuracy_metres           integer,
  distance_from_site_metres integer,
  within_range              boolean not null,
  signed_in_at              timestamptz default now(),
  signed_out_at             timestamptz,
  device_info               text,
  sign_out_lat              double precision,
  sign_out_lng              double precision,
  sign_out_accuracy_metres  integer,
  sign_out_distance_metres  integer,
  sign_out_within_range     boolean,
  hours_worked              numeric,
  auto_closed               boolean default false,
  auto_closed_reason        text,
  flagged                   boolean default false,
  flag_reason               text,
  expected_sign_out_time    time,
  departed_early            boolean default false,
  early_departure_minutes   integer,
  signed_out_method         text default 'manual',
  signed_out_source         text,
  needs_review              boolean default false,
  reminder_sent_at          timestamptz,
  admin_reminder_sent_at    timestamptz,
  payroll_exported_at       timestamptz,
  payroll_export_id         uuid,
  last_gps_ping_at          timestamptz,
  crew_headcount            integer not null default 1,
  end_notif_sent_at         timestamptz
);
-- No visit_id. A shift attaches to a job, not to a visit.

-- ---------------------------------------------------------------------------
-- jobs
-- ---------------------------------------------------------------------------
create table if not exists jobs (
  id                        uuid primary key default gen_random_uuid(),
  company_id                uuid not null references companies(id),
  name                      text not null,
  address                   text not null,
  lat                       double precision,
  lng                       double precision,
  template_id               uuid references checklist_templates(id),
  status                    text default 'pending',
  contract_value            numeric,
  created_by                uuid references users(id),
  created_at                timestamptz default now(),
  completed_at              timestamptz,
  checklist_template_id     uuid references checklist_templates(id),
  start_time                time default '08:00:00',
  sign_out_time             time,
  client_id                 uuid references clients(id),
  last_signin_reminder_date date,
  site_id                   uuid references sites(id),
  required_trades           text[] not null,
  start_date                date,
  end_date                  date,
  budget_hours              numeric,
  tags                      text[],
  distance_from_site_km     numeric,
  contractor                text,
  geofence_radius_metres    integer,
  gps_source                text,
  archived_at               timestamptz,
  archived_by               uuid references users(id)
);


-- ---------------------------------------------------------------------------
-- Corrections to docs/phase2-multisite-audit.md
--
-- That document reconstructed these tables from application code. Against the
-- live schema, four of its findings are wrong:
--
-- 1. "jobs.site_id is missing." It EXISTS, as a nullable FK to sites. No code
--    writes it, which is why a repo grep only found it in a comment. The gap
--    is a write path and a backfill, not a column.
--
-- 2. "No clients or accounts parent table exists anywhere." A clients table
--    EXISTS (id, company_id, name, email, phone, address, portal_enabled), and
--    jobs.client_id references it. What is missing is sites.client_id: sites
--    still group nothing, and sites.client_name is still free text.
--
-- 3. "visit_assignments has no start_at, so installer/jobs/route.ts:19 errors
--    or returns nothing." The column EXISTS and is nullable. No write path
--    populates it, so it is always null and the .gte('start_at', today) filter
--    excludes every row. Same broken outcome, different cause, different fix.
--
-- 4. "Nothing models crew size." signins.crew_headcount EXISTS, integer, not
--    null, default 1.
--
-- Still confirmed missing, as the document says: job_visits.site_id,
-- signins.visit_id, sites.client_id, and any recurrence at all. There is no
-- visit_schedules, no visits and no contracts table in the database.
-- ---------------------------------------------------------------------------
