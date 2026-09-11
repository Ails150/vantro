-- Remember which week's report a company has already been sent.
--
-- The Friday job runs more than once -- Vercel crons are UTC and 17:00 in
-- London is 16:00 UTC for half the year, so the schedule fires at both hours
-- and the handler decides which one is actually 5pm there. Without a marker
-- that would mean two identical emails every summer.
--
-- A date rather than a boolean, so it also answers "did last week's go out?"
-- and makes a re-run after a failure safe: the send is keyed on the week, not
-- on a flag someone has to remember to clear.

alter table companies
  add column if not exists last_weekly_report_week date;

comment on column companies.last_weekly_report_week is
  'Monday of the most recent week whose Friday PDF report was emailed. Set by /api/cron/weekly-report.';
