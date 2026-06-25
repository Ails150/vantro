-- 20260625_company_default_shift_times.sql  -  Vantro
-- Global default shift start / sign-out times per company. New jobs pre-fill
-- with these (overridable per job).
--
-- Run once in the Supabase SQL editor.

alter table public.companies
  add column if not exists default_start_time time,
  add column if not exists default_sign_out_time time;
