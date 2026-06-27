-- 20260627_checklist_items_hold_point.sql  -  Vantro
-- Flags checklist items that are HOLD POINTs (require supervisor sign-off),
-- e.g. parsed from imported Fieldwire-style PDF checklists.
--
-- Run once in the Supabase SQL editor.

alter table public.checklist_items
  add column if not exists hold_point boolean not null default false;

notify pgrst, 'reload schema';
