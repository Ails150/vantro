-- 20260625_jobs_distance_from_site.sql  -  Vantro
-- Adds a manual "distance from site" (km) field to jobs, used as a fallback
-- for remote locations that have no address / postcode (so no GPS lat/lng).
-- Purely informational; does not affect geofencing.
--
-- Run once in the Supabase SQL editor.

alter table public.jobs
  add column if not exists distance_from_site_km numeric;
