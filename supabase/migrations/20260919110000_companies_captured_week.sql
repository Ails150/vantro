-- 20260919110000_companies_captured_week.sql  -  Vantro
--
-- The Friday "what you captured this week" email's per-week marker, the same
-- shape as last_weekly_report_week (20260911150000).
--
-- The cron fires at 16:00 and 17:00 UTC so that one of them is 17:00 in London
-- whichever side of the clock change it is; this is what stops the other
-- firing, or a retry, sending a second copy. It is written only after the
-- provider accepts the send, so a failure retries rather than being dropped.

begin;

alter table public.companies
  add column if not exists last_captured_week date;

comment on column public.companies.last_captured_week is
  'Monday of the most recent week whose Friday "what you captured" email was sent (Suite). Set by /api/cron/captured-week.';

commit;

notify pgrst, 'reload schema';
