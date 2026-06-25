-- 20260625_jobs_contractor_geofence_and_subcontractor_role.sql  -  Vantro
-- 1) Adds per-job "contractor" (company name) and "geofence_radius_metres"
--    (optional override of the company default) columns to jobs.
-- 2) Allows the new 'subcontractor' team role.
--
-- Run once in the Supabase SQL editor.

alter table public.jobs
  add column if not exists contractor text,
  add column if not exists geofence_radius_metres integer;

-- Allow 'subcontractor' (and keep the previously-added 'support'). Idempotent.
alter table public.users drop constraint if exists users_role_check;
alter table public.users add constraint users_role_check
  check (role in ('installer', 'foreman', 'admin', 'superadmin', 'support', 'subcontractor'));
