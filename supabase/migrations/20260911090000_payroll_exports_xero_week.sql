-- Xero timesheet exports: one per company per week, forever.
--
-- Re-exporting a week must UPDATE the timesheet already sent to Xero, never
-- create a second one. Two timesheets for the same employee and week is a
-- double payment, so this is enforced in the database rather than trusted to
-- the route: a retried request, a double-clicked button and two admins
-- exporting at once all collapse onto the same row.
--
-- No new table. payroll_exports already records an export of a date range; a
-- Xero export is one of those whose range happens to be a payroll week, and
-- xero_week_start is what makes it findable again.

alter table payroll_exports
  add column if not exists xero_week_start date;

alter table payroll_exports
  add column if not exists xero_timesheet_ref text;

alter table payroll_exports
  add column if not exists updated_at timestamptz;

-- Partial, so the CSV exports that have no week (xero_week_start null) are
-- untouched and can still be as numerous as they like.
create unique index if not exists payroll_exports_company_xero_week_idx
  on payroll_exports (company_id, xero_week_start)
  where xero_week_start is not null;

comment on column payroll_exports.xero_week_start is
  'Monday of the Europe/London payroll week this Xero timesheet covers. Unique per company: re-exporting updates this row.';
comment on column payroll_exports.xero_timesheet_ref is
  'Stable human reference quoted on the timesheet, e.g. VTR-TS-20260907.';
