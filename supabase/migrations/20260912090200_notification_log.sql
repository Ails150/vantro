-- 20260912090200_notification_log.sql  -  Vantro
--
-- There was no push log. When a worker asked "why did my phone buzz 170 times
-- this weekend", the only way to answer was to read the cron source, infer what
-- it would have done, and check it against surviving row state -- Vercel logs
-- retain for minutes, and the Expo send is fire-and-forget with the response
-- discarded. This table is the answer to that question next time.
--
-- It records SUPPRESSIONS as well as sends. A push that did not go out because
-- it was 2am on a Saturday is the more interesting row: it is the evidence the
-- rules are working, and without it a quiet weekend is indistinguishable from a
-- broken cron.
--
-- DEDUPE
-- dedupe_key is what "once per shift, not repeated" is enforced with. The
-- partial unique index covers sent rows only, so a shift can be evaluated and
-- suppressed on every five-minute tick without the index fighting it, while a
-- second SEND for the same key is refused by the database rather than by
-- whichever caller remembered to check first. Key shapes:
--
--   signin_reminder   signin_reminder:<job_id>:<local_date>
--   end_of_shift      end_of_shift:<signin_id>
--   signout_reminder  signout_reminder:<signin_id>
--   auto_signout      auto_signout:<signin_id>
--
-- All four are per-user because user_id is part of the index. Keying the
-- sign-in reminder on the job alone was the old behaviour and it meant the
-- first worker reminded on a job silenced everyone else assigned to it.

create table if not exists public.notification_log (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies(id) on delete cascade,
  user_id           uuid not null references public.users(id) on delete cascade,
  job_id            uuid references public.jobs(id) on delete set null,
  signin_id         uuid references public.signins(id) on delete set null,
  -- 'signin_reminder' | 'end_of_shift' | 'signout_reminder' | 'auto_signout'
  kind              text not null,
  dedupe_key        text not null,
  -- true = handed to Expo. false = evaluated and deliberately not sent.
  sent              boolean not null,
  -- Why it was sent, or why it was not. Comes from lib/notifications/rules.ts
  -- so the reason in the log is the same string the decision was made on.
  reason            text not null,
  title             text,
  body              text,
  -- Whatever else the decision turned on: minutes from shift start, dwell,
  -- fix count, the local time and day it was evaluated at.
  context           jsonb,
  created_at        timestamptz not null default now()
);

-- The dedupe guarantee. Only sent rows participate.
create unique index if not exists notification_log_sent_dedupe
  on public.notification_log (user_id, kind, dedupe_key)
  where sent;

-- "Every notification for this worker in the last 48 hours", which is the
-- query that could not be answered.
create index if not exists notification_log_user_recent
  on public.notification_log (user_id, created_at desc);

create index if not exists notification_log_company_recent
  on public.notification_log (company_id, created_at desc);

-- Written only by the service role from the cron and the API routes. No policy
-- is granted, so RLS on with zero policies means an anon or authenticated key
-- reads nothing -- these rows say where a named person was and when.
alter table public.notification_log enable row level security;

comment on table public.notification_log is
  'Every push decision: sent and suppressed, with the rule that decided it. Also the dedupe ledger for once-per-shift notifications.';

notify pgrst, 'reload schema';

-- Verify:
--   select kind, reason, count(*) from notification_log
--    where created_at > now() - interval '48 hours' group by 1, 2 order by 3 desc;
--   select relrowsecurity from pg_class where relname = 'notification_log';  -> t
