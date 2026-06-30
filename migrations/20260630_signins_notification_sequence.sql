-- 20260630_signins_notification_sequence.sql  -  Vantro
-- New time-based shift notification sequence (GPS removed from close logic):
--   1. sign-in reminder  - 10 min before scheduled start   (uses last_signin_reminder_date)
--   2. end-of-shift       - at scheduled end                (new: end_notif_sent_at)
--   3. sign-out reminder  - 15 min after end                (reuses reminder_sent_at)
--   4. auto sign-out      - 30 min after end                (new: signed_out_method)
--
-- end_notif_sent_at  : idempotency flag for the end-of-shift push so the
--                      every-5-min cron only fires it once per shift.
-- signed_out_method  : 'manual' | 'auto' so auto-closed shifts are
--                      distinguishable in payroll / reporting.
--
-- Run once in the Supabase SQL editor.

alter table public.signins
  add column if not exists end_notif_sent_at timestamptz,
  add column if not exists signed_out_method text;
