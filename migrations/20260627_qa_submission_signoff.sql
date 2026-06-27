-- 20260627_qa_submission_signoff.sql  -  Vantro
-- Per-item Fieldwire-style sign-off fields on QA submissions:
--   installer fills installer_initials + installer_date (auto from their account),
--   supervisor (RFL) fills rfl_initials + rfl_date, plus a remedial_action note.
-- Hold-point items must have rfl_initials before the checklist can be approved.
--
-- Run once in the Supabase SQL editor.

alter table public.qa_submissions
  add column if not exists installer_initials text,
  add column if not exists installer_date date,
  add column if not exists rfl_initials text,
  add column if not exists rfl_date date,
  add column if not exists remedial_action text;

notify pgrst, 'reload schema';
