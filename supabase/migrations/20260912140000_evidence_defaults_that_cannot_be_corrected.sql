-- 20260912140000_evidence_defaults_that_cannot_be_corrected.sql  -  Vantro
--
-- The other two instances of the bug that produced the weekend push storm.
--
-- THE PATTERN
-- enforce_evidence_immutability's write-once check permits null -> value only.
-- A column with a non-null DEFAULT is never null, so write-once on it cannot
-- protect anything -- it can only refuse. That is what killed auto sign-out for
-- eight days (see 20260912090000). An audit of every write-once column across
-- the eight tables the append-only triggers cover found three more with
-- defaults, of which these two matter:
--
--   expenses.receipt_mime      default 'image/jpeg'
--   walkthroughs.recorded_at   default now()
--
-- (expenses.submitted_at also defaults to now(); it is left alone. Nothing
-- writes it, its default is genuinely correct, and "when the claim was
-- submitted" is exactly the sort of value that should not be editable.)
--
-- Neither is a live failure today, because nothing UPDATEs them. Both are
-- corrupting data on the way IN, and the write-once guard is what makes the
-- corruption permanent.
--
-- expenses.receipt_mime
--   app/api/expenses/route.ts did `file.type || "image/jpeg"`. A client that
--   sends no MIME type has its PDF receipt recorded as a JPEG, for good: the
--   guard refuses the correction. Guessing was never the right behaviour --
--   the route now refuses the upload and says so. With nothing guessing, the
--   column no longer needs a default, and since it describes the file rather
--   than being evidence about the claim, it comes off the write-once list so a
--   genuine correction is possible.
--
-- walkthroughs.recorded_at
--   The insert passes new Date() -- the UPLOAD time. The mobile queue has held
--   the real recording time all along (walktalk-queue.ts, recordedAt) and
--   simply never sent it. For a clip recorded on site with no signal and
--   uploaded that evening, the row claims the wrong hour of the wrong part of
--   the day, and the guard makes that permanent. The client now sends the real
--   time and the server requires it. recorded_at STAYS write-once: when a
--   walkthrough happened is evidence, unlike what MIME type its file is.
--   Dropping the default turns an omitted value into a loud NOT NULL violation
--   instead of a plausible-looking lie.

begin;

-- expenses --------------------------------------------------------------
alter table public.expenses alter column receipt_mime drop default;

drop trigger if exists expenses_immutable on public.expenses;
create trigger expenses_immutable
  before update on public.expenses
  for each row execute function public.enforce_evidence_immutability(
    '2', 'id', 'company_id',
    'receipt_url', 'submitted_at', 'user_id'
  );

-- walkthroughs ----------------------------------------------------------
-- Write-once list unchanged; only the default goes.
alter table public.walkthroughs alter column recorded_at drop default;

commit;

notify pgrst, 'reload schema';

-- Verify:
--   select column_name, column_default from information_schema.columns
--    where (table_name, column_name) in
--          (('expenses','receipt_mime'), ('walkthroughs','recorded_at'),
--           ('signins','signed_out_method'));
--     -> column_default null for all three
--
--   -- receipt_mime is correctable again:
--   update expenses set receipt_mime = 'application/pdf' where id = '<scratch>';
--     -> 1 row, and an event='amended' hash appended
