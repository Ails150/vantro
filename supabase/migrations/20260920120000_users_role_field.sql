-- 20260920120000_users_role_field.sql  -  Vantro
--
-- Let the database store the role the application has been writing for a
-- release: 'field'.
--
-- lib/roles.ts has said since it was written that 'installer' is
-- construction-only language in a product that also serves cleaning, security
-- and facilities, that the stored value is migrating to 'field', and that
-- "everything writes 'field'". Everything does: /api/admin/team, the CSV
-- import and /api/onboarding all pass normaliseRole(), which returns 'field'.
--
-- users_role_check never learned the word:
--
--   CHECK (role = ANY (ARRAY['installer','foreman','admin','superadmin',
--                            'support','subcontractor']))
--
-- So those three routes could not insert anybody. The error surfaced as
-- "Could not add team member" with a constraint violation underneath, and the
-- setup wizard's own "Add your team" step is one of them. Production holds 427
-- field workers and every one of them is 'installer', written by the
-- dashboard's browser-side insert -- not because the other paths were unused,
-- but because they could not succeed.
--
-- This is the missing half of that migration. The value is ADDED, not
-- swapped: both spellings are legal for the compatibility window lib/roles.ts
-- documents, so a half-deployed fleet cannot lock anyone out, and no existing
-- row has to move. Closing the window means dropping 'installer' from this
-- list and from FIELD_ROLES, in that order, once no rows carry it.
--
-- No backfill. Rewriting 427 live rows to prove a point about vocabulary is a
-- risk with no user on the other end of it; reads accept both.

begin;

alter table public.users drop constraint if exists users_role_check;

alter table public.users add constraint users_role_check
  check (role in ('field', 'installer', 'foreman', 'admin', 'superadmin', 'support', 'subcontractor'));

comment on column public.users.role is
  'field (legacy: installer), foreman, subcontractor, admin, superadmin, support. Read through lib/roles.ts, which accepts both field and installer; every write path stores field.';

commit;

notify pgrst, 'reload schema';

-- Verify:
--   select pg_get_constraintdef(oid) from pg_constraint where conname = 'users_role_check';
--   select role, count(*) from users group by role;
