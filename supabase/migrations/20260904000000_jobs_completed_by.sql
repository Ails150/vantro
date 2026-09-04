-- 20260904000000_jobs_completed_by.sql  -  Vantro
--
-- jobs.completed_by -- who marked the job complete.
--
-- WHY
-- The column is referenced by application code that predates this branch, and
-- has never existed on the live table:
--
--   * app/api/audit/v2/action/route.ts, action "mark_complete", writes
--     completed_by: userId alongside status and completed_at. That update
--     fails against the live schema, so the Mark complete button in the audit
--     actions panel returns a 500. Broken in production today.
--   * app/api/audit/v2/route.ts reads job.completed_by to name the person on
--     the Compliance view's "Final sign-off" row. Under select("*") the field
--     is merely undefined, so that row has only ever been able to say
--     Completed / Pending -- never who signed off.
--
-- Naming it in an explicit select took the entire audit pack down once, because
-- PostgREST rejects the whole select on a single unknown column. See
-- docs/audit-pack-v2/PHASE-0.md, "The completed_by near miss". This migration
-- removes the reason the column was missing; it does not remove the reason
-- lib/audit/data.ts stays on select("*"), which is defence against the next
-- piece of schema drift, not against this one.
--
-- SHAPE
-- Nullable uuid referencing users(id) with no ON DELETE clause, matching the
-- two user FKs already on this table -- jobs.created_by and jobs.archived_by.
-- Deleting a user therefore fails while any job still names them, rather than
-- silently blanking the audit trail, which is the behaviour an audit pack
-- wants. No index: completed_by is never a filter or join key on jobs, only a
-- single-row lookup into users.
--
-- BACKFILL: none, deliberately. Jobs already marked complete carry completed_at
-- but no record of who, and there is nowhere to recover it from -- the write
-- has been failing, so the information was never stored. Those rows keep
-- completed_by null and their Final sign-off row keeps rendering "-". Only jobs
-- completed after this deploy will name a person.
--
-- Idempotent, and additive: nothing reads the column in a way that breaks while
-- it is null, so this is safe to apply before or after any code deploy.

alter table public.jobs
  add column if not exists completed_by uuid references public.users(id);

comment on column public.jobs.completed_by is
  'User who marked the job complete. Written by the audit mark_complete action alongside status and completed_at. Null for every job completed before 2026-09-04, when the column was added.';

-- PostgREST caches the schema. Without this the new column stays invisible to
-- the REST API until the next reload, and mark_complete keeps failing.
notify pgrst, 'reload schema';
