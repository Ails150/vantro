-- 20260625_jobs_gps_source.sql  -  Vantro
-- Tracks how a job's GPS location was set, for the dashboard indicator:
--   null / no lat-lng  -> unanchored (no GPS yet)
--   'installer'        -> anchored by the first installer to sign in
--   'manual'           -> set/verified by an admin (address or map pin)
--
-- Run once in the Supabase SQL editor.
-- DROP + ADD (not "add if not exists") to recover from a half-created column,
-- then force PostgREST to reload its schema cache so the API sees it immediately.

ALTER TABLE public.jobs DROP COLUMN IF EXISTS gps_source;
ALTER TABLE public.jobs ADD COLUMN gps_source text;

NOTIFY pgrst, 'reload schema';
