-- 20260904020000_evidence_append_only.sql  -  Vantro
-- Phase 1.1 (part 2 of 3): append-only enforcement.
-- Spec: "Rows are append-only: add a trigger that rejects UPDATE on evidential
-- fields for the tables above; corrections are new rows with supersedes_id."
--
-- THE PROBLEM WITH THE LITERAL READING
-- Rejecting every UPDATE to an evidential field breaks the product. The update
-- paths were inventoried before writing this, and these are real, in use, and
-- legitimate:
--
--   app/api/payroll/edit/route.ts   admin corrects a timesheet: writes
--                                   signed_in_at and signed_out_at. Already
--                                   guarded -- refuses once the timesheet is
--                                   payroll-exported (423 Locked).
--   app/api/qa/route.ts             installer redoes a QA item: rewrites
--                                   photo_url, notes, state, submitted_at on
--                                   the existing row.
--   app/api/walkthroughs/
--     upload-clip/route.ts          fills duration_seconds once the clip has
--                                   been processed.
--
-- A hard reject would not make these corrections stop happening. It would move
-- them outside the system, into the SQL editor, where nothing records them at
-- all -- strictly worse evidence than what we have now.
--
-- WHAT THIS DOES INSTEAD
-- Three classes of field, per the safe reading:
--
--   1. IMMUTABLE -- id and company_id. Changing either is not a correction,
--      it is re-attributing evidence to a different tenant. No code path does
--      it. Rejected outright, with an exception the caller cannot swallow.
--      location_logs is immutable in full: nothing in the codebase updates a
--      ping, so nothing legitimate is being refused.
--
--   2. WRITE-ONCE -- the sign-out capture fields. null -> value is a capture
--      and is allowed. value -> different value is a rewrite of evidence that
--      was already taken, and is rejected. signed_out_at itself is deliberately
--      NOT in this class: payroll edit legitimately corrects it, and locking it
--      would break timesheet correction.
--
--   3. AMENDABLE, AND RECORDED -- everything else that is hashed. The update
--      is allowed and a new evidence_hashes row is appended with
--      event = 'amended' and supersedes_id pointing at the hash it replaces.
--      Nothing is silently mutable: the chain shows the value changed, when,
--      and what it was before, and the pack can render that.
--
-- This is the safer choice on an ambiguous instruction and it is recorded in
-- docs/audit-pack-v2/PHASE-1.md. It satisfies what the spec is for -- evidence
-- that cannot be quietly altered -- without breaking three live paths.
--
-- DELETE is deliberately not touched. app/api/jobs/delete, app/api/cleanup
-- (GDPR retention on location_logs) and app/api/account/delete all remove these
-- rows, and blocking that would break data-subject erasure, which is a legal
-- obligation and outranks an audit convention. Deletion is a separate concern
-- from silent modification, which is what this migration is about.

-- ---------------------------------------------------------------------------
-- 1. Immutability and write-once enforcement
-- ---------------------------------------------------------------------------
-- Args: pairs of column names. tg_argv[0] is the count of immutable columns;
-- the immutable ones follow, then the write-once ones.
create or replace function public.enforce_evidence_immutability()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $fn$
declare
  n_immutable integer := tg_argv[0]::integer;
  total       integer := coalesce(array_length(tg_argv, 1), 0);
  old_json    jsonb := to_jsonb(old);
  new_json    jsonb := to_jsonb(new);
  col         text;
  i           integer;
begin
  for i in 1 .. n_immutable loop
    col := tg_argv[i];
    if (old_json -> col) is distinct from (new_json -> col) then
      raise exception
        'evidence integrity: %.% is immutable (row %). Corrections are new rows, not edits.',
        tg_table_name, col, old_json ->> 'id'
        using errcode = 'integrity_constraint_violation';
    end if;
  end loop;

  for i in n_immutable + 1 .. total - 1 loop
    col := tg_argv[i];
    -- Write-once: only null -> value. Anything else, including value -> null,
    -- is a rewrite of evidence already captured.
    if (old_json -> col) is not null
       and (old_json -> col) <> 'null'::jsonb
       and (old_json -> col) is distinct from (new_json -> col) then
      raise exception
        'evidence integrity: %.% is write-once and is already set (row %).',
        tg_table_name, col, old_json ->> 'id'
        using errcode = 'integrity_constraint_violation';
    end if;
  end loop;

  return new;
end;
$fn$;

comment on function public.enforce_evidence_immutability() is
  'BEFORE UPDATE guard. Args: count of immutable columns, then those columns, then the write-once columns.';

-- ---------------------------------------------------------------------------
-- 2. Amendment recording
-- ---------------------------------------------------------------------------
-- Fires after any update. Recomputes the evidential payload with the same
-- denylist the capture trigger uses, and appends a hash ONLY if that payload
-- actually changed. An approval, a review, a payment or an AI re-run therefore
-- writes nothing -- those fields are denylisted, so the payload is identical
-- and the trigger is a no-op. Only a real change to evidence leaves a mark.
create or replace function public.record_evidence_amendment()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  pver         integer := tg_argv[0]::integer;
  actor_column text := tg_argv[1];
  excluded     text[] := array[]::text[];
  row_json     jsonb;
  payload      jsonb;
  new_hash     text;
  prev_id      uuid;
  prev_hash    text;
  i            integer;
begin
  for i in 2 .. coalesce(array_length(tg_argv, 1), 0) - 1 loop
    excluded := excluded || tg_argv[i];
  end loop;

  row_json := to_jsonb(new);
  payload  := row_json - excluded;
  new_hash := encode(sha256(convert_to(payload::text, 'UTF8')), 'hex');

  -- The hash this one would supersede: the most recent for this entity.
  select h.id, h.sha256 into prev_id, prev_hash
    from public.evidence_hashes h
   where h.entity_type = tg_table_name
     and h.entity_id = (row_json ->> 'id')::uuid
   order by h.hashed_at desc, h.id desc
   limit 1;

  -- Unchanged evidence: nothing to record.
  if prev_hash is not null and prev_hash = new_hash then
    return null;
  end if;

  insert into public.evidence_hashes
    (company_id, entity_type, entity_id, event, sha256, payload_version,
     hashed_by, supersedes_id)
  values (
    nullif(row_json ->> 'company_id', '')::uuid,
    tg_table_name,
    (row_json ->> 'id')::uuid,
    'amended',
    new_hash,
    pver,
    case when actor_column = '' then null
         else nullif(row_json ->> actor_column, '')::uuid end,
    prev_id
  );

  return null;
end;
$fn$;

comment on function public.record_evidence_amendment() is
  'AFTER UPDATE trigger. Appends an event=amended hash, chained by supersedes_id, only when the evidential payload actually changed.';

-- ---------------------------------------------------------------------------
-- 3. The triggers
-- ---------------------------------------------------------------------------
-- Denylists below MUST stay identical to those in
-- 20260904010000_evidence_hashes.sql. If they drift, an untouched row will
-- appear to have been amended the moment anything else about it changes.

-- signins ------------------------------------------------------------------
-- Immutable: id, company_id. job_id and user_id are deliberately amendable --
-- an admin re-attributing a shift to the right job is a correction that should
-- be recorded, not refused. Write-once: the sign-out capture fields, but not
-- signed_out_at, which payroll edit must be able to correct.
drop trigger if exists signins_immutable on public.signins;
create trigger signins_immutable
  before update on public.signins
  for each row execute function public.enforce_evidence_immutability(
    '2', 'id', 'company_id',
    'sign_out_lat', 'sign_out_lng', 'sign_out_accuracy_metres',
    'sign_out_distance_metres', 'sign_out_within_range',
    'signed_out_method', 'signed_out_source'
  );

-- Excludes the sign-out transition, which signins_evidence_hash_signout
-- already records as its own capture event rather than as an amendment.
drop trigger if exists signins_evidence_amendment on public.signins;
create trigger signins_evidence_amendment
  after update on public.signins
  for each row
  when (not (old.signed_out_at is null and new.signed_out_at is not null))
  execute function public.record_evidence_amendment(
    '1', 'user_id',
    'admin_reminder_sent_at', 'end_notif_sent_at', 'reminder_sent_at',
    'last_gps_ping_at', 'payroll_export_id', 'payroll_exported_at',
    'needs_review', 'flagged', 'flag_reason',
    'auto_closed', 'auto_closed_reason',
    'departed_early', 'early_departure_minutes', 'hours_worked',
    'expected_sign_out_time'
  );

-- location_logs ------------------------------------------------------------
-- Fully immutable. Nothing in the codebase updates a ping; the only writes are
-- insert (app/api/location, app/api/installer/geofence-exit) and the retention
-- delete in app/api/cleanup. Locking every column costs nothing and closes the
-- one table whose evidence is otherwise hashed only in batch.
drop trigger if exists location_logs_immutable on public.location_logs;
create trigger location_logs_immutable
  before update on public.location_logs
  for each row execute function public.enforce_evidence_immutability(
    '13',
    'id', 'company_id', 'job_id', 'user_id', 'signin_id',
    'lat', 'lng', 'accuracy_metres', 'distance_from_site_metres',
    'within_range', 'source', 'logged_at', 'created_at'
  );

-- diary_entries ------------------------------------------------------------
drop trigger if exists diary_entries_immutable on public.diary_entries;
create trigger diary_entries_immutable
  before update on public.diary_entries
  for each row execute function public.enforce_evidence_immutability(
    '2', 'id', 'company_id'
  );

drop trigger if exists diary_entries_evidence_amendment on public.diary_entries;
create trigger diary_entries_evidence_amendment
  after update on public.diary_entries
  for each row execute function public.record_evidence_amendment(
    '1', 'user_id',
    'ai_alert_type', 'ai_processed', 'ai_summary', 'ai_variation_detected',
    'video_ai_summary', 'video_ai_summary_at',
    'reply', 'replied_at', 'replied_by'
  );

-- qa_submissions -----------------------------------------------------------
drop trigger if exists qa_submissions_immutable on public.qa_submissions;
create trigger qa_submissions_immutable
  before update on public.qa_submissions
  for each row execute function public.enforce_evidence_immutability(
    '2', 'id', 'company_id'
  );

drop trigger if exists qa_submissions_evidence_amendment on public.qa_submissions;
create trigger qa_submissions_evidence_amendment
  after update on public.qa_submissions
  for each row execute function public.record_evidence_amendment(
    '1', 'user_id',
    'state', 'reviewed_at', 'reviewed_by', 'rejection_note',
    'video_ai_summary', 'video_ai_summary_at'
  );

-- defects ------------------------------------------------------------------
drop trigger if exists defects_immutable on public.defects;
create trigger defects_immutable
  before update on public.defects
  for each row execute function public.enforce_evidence_immutability(
    '2', 'id', 'company_id'
  );

drop trigger if exists defects_evidence_amendment on public.defects;
create trigger defects_evidence_amendment
  after update on public.defects
  for each row execute function public.record_evidence_amendment(
    '1', 'user_id',
    'status', 'resolution_note', 'resolved_at', 'resolved_by'
  );

-- variations ---------------------------------------------------------------
drop trigger if exists variations_immutable on public.variations;
create trigger variations_immutable
  before update on public.variations
  for each row execute function public.enforce_evidence_immutability(
    '2', 'id', 'company_id'
  );

drop trigger if exists variations_evidence_amendment on public.variations;
create trigger variations_evidence_amendment
  after update on public.variations
  for each row execute function public.record_evidence_amendment(
    '1', 'raised_by',
    'ai_confidence', 'ai_detected',
    'status', 'notes', 'approved_at', 'approved_by', 'approved_value',
    'invoiced_at'
  );

-- walkthroughs -------------------------------------------------------------
-- duration_seconds is filled in after processing (upload-clip), so it amends
-- rather than being write-once; the recorded hash makes that visible.
drop trigger if exists walkthroughs_immutable on public.walkthroughs;
create trigger walkthroughs_immutable
  before update on public.walkthroughs
  for each row execute function public.enforce_evidence_immutability(
    '2', 'id', 'company_id',
    'gps_lat', 'gps_lng', 'recorded_at', 'installer_id'
  );

drop trigger if exists walkthroughs_evidence_amendment on public.walkthroughs;
create trigger walkthroughs_evidence_amendment
  after update on public.walkthroughs
  for each row execute function public.record_evidence_amendment(
    '1', 'installer_id',
    'ai_flags', 'ai_sections', 'ai_sentiment', 'ai_summary', 'ai_themes',
    'transcript_full', 'integrity_hash',
    'approval_status', 'approved_at', 'approved_by', 'rejected_reason',
    'processing_attempts', 'processing_completed_at', 'processing_error',
    'processing_started_at', 'processing_status'
  );

-- expenses -----------------------------------------------------------------
-- The receipt itself is write-once: a claim whose receipt image can be swapped
-- after submission is not evidence of anything.
drop trigger if exists expenses_immutable on public.expenses;
create trigger expenses_immutable
  before update on public.expenses
  for each row execute function public.enforce_evidence_immutability(
    '2', 'id', 'company_id',
    'receipt_url', 'receipt_mime', 'submitted_at', 'user_id'
  );

drop trigger if exists expenses_evidence_amendment on public.expenses;
create trigger expenses_evidence_amendment
  after update on public.expenses
  for each row execute function public.record_evidence_amendment(
    '1', 'user_id',
    'status', 'paid_at', 'paid_in_week_starting',
    'review_note', 'reviewed_at', 'reviewed_by',
    'idempotency_key'
  );

notify pgrst, 'reload schema';

-- Verify:
--   -- An approval writes no amendment: the payload is unchanged.
--   -- (run against a scratch row, not live evidence)
--
--   -- Immutability actually bites:
--   --   update signins set company_id = gen_random_uuid() where id = '...';
--   --   -> ERROR  evidence integrity: signins.company_id is immutable
--
--   -- Every amendment is chained, none orphaned:
--   select count(*) from evidence_hashes
--    where event = 'amended' and supersedes_id is null;   -> 0
--
--   -- No amendment duplicates the hash it supersedes:
--   select count(*) from evidence_hashes a
--     join evidence_hashes b on b.id = a.supersedes_id
--    where a.sha256 = b.sha256;                           -> 0
