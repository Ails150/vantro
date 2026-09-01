-- users.role: 'installer' -> 'field', visit_assignments.role: -> 'operative'
--
-- "Installer" is construction-only language in a product that also serves
-- cleaning, security and facilities. This migrates the stored values.
--
-- ROW COUNTS BEFORE (live, 2026-09-01):
--   users.role = 'installer'        416
--   users.role = 'admin'              5
--   users.role = 'foreman'           11
--   users.role = 'superadmin'         2
--   users.role = 'field'              0
--   visit_assignments.role = 'installer'  14 of 17
--
-- ORDER OF DEPLOY MATTERS. Ship the code that accepts both values first
-- (lib/roles.ts, FIELD_ROLES), then run this. The reverse order signs out
-- every field worker until the deploy lands, because role gates app access.
--
-- Rolling back is the same statement with the values swapped. Nothing else
-- depends on the old string once lib/roles.ts is in place.

begin;

-- users.role
update users
   set role = 'field'
 where role = 'installer';

-- visit_assignments.role describes what someone is on a visit, not their
-- account role, so it takes the crew word rather than 'field'.
update visit_assignments
   set role = 'operative'
 where role = 'installer';

alter table visit_assignments
  alter column role set default 'operative';

commit;

-- Verify: both should be zero.
--   select count(*) from users where role = 'installer';
--   select count(*) from visit_assignments where role = 'installer';
--
-- And the field population should equal the 416 above:
--   select role, count(*) from users group by role order by 2 desc;
