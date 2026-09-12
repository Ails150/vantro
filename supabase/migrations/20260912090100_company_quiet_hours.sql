-- 20260912090100_company_quiet_hours.sql  -  Vantro
--
-- Per-company notification quiet hours (rule 5).
--
-- Defaults are 19:00 -> 06:00 local and no weekend pushes, which is the
-- behaviour asked for. They are defaults, not law: a company running night
-- shifts sets its own window, and one that genuinely rosters Saturdays turns
-- notification_weekend_push on.
--
-- The window is stored as two local times rather than a range type because it
-- normally wraps midnight, and every consumer already works in company-local
-- minutes-since-midnight. Comparison lives in lib/notifications/rules.ts
-- (isQuietHour), which handles the wrap.
--
-- Note the interaction with the weekend rule: a worker who IS rostered for a
-- Saturday still gets their pushes even with notification_weekend_push off.
-- The flag governs unscheduled weekend days, which is where the noise was.

alter table public.companies
  add column if not exists notification_quiet_start time not null default '19:00',
  add column if not exists notification_quiet_end   time not null default '06:00',
  add column if not exists notification_weekend_push boolean not null default false;

comment on column public.companies.notification_quiet_start is
  'Local time pushes stop. Window wraps midnight when end <= start.';
comment on column public.companies.notification_quiet_end is
  'Local time pushes resume (exclusive).';
comment on column public.companies.notification_weekend_push is
  'Allow pushes on Sat/Sun even when the worker is not rostered that day.';
