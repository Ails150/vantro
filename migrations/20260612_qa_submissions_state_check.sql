-- Broaden qa_submissions.state CHECK constraint to allow pass / fail / na.
--
-- Run in Supabase SQL Editor:
--   https://supabase.com/dashboard/project/lmobuqxmtkctqqwbspoz/sql
-- Date: 2026-06-12
--
-- Background: the existing constraint allowed only
--   ('pending','submitted','approved','rejected').
-- The installer QA screen submits state='pass'/'fail' (pass_fail items) and now
-- 'na' (not-applicable). Those were rejected by the DB (error 23514) while the
-- /api/qa route swallowed the error and returned success -> answers silently lost.
-- (I-Glaze's live checklist is entirely pass/fail items.)
--
-- This is additive; no existing row violates the new constraint (all current
-- rows are state='submitted').

alter table public.qa_submissions
  drop constraint if exists qa_submissions_state_check;

alter table public.qa_submissions
  add constraint qa_submissions_state_check
  check (state in ('pending', 'submitted', 'pass', 'fail', 'na', 'approved', 'rejected'));

-- Verify:
-- select conname, pg_get_constraintdef(oid)
-- from pg_constraint
-- where conrelid = 'public.qa_submissions'::regclass and conname = 'qa_submissions_state_check';
