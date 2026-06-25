-- 20260625_jobs_gps_source.sql  -  Vantro
-- Tracks how a job's GPS location was set, for the dashboard indicator:
--   null / no lat-lng  -> unanchored (no GPS yet)
--   'installer'        -> anchored by the first installer to sign in
--   'manual'           -> set/verified by an admin (address or map pin)
--
-- Run once in the Supabase SQL editor.

alter table public.jobs
  add column if not exists gps_source text;
