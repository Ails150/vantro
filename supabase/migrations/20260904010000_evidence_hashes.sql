-- 20260904010000_evidence_hashes.sql  -  Vantro
-- Phase 1.1 (part 1 of 3): content hashing at write time.
-- Spec: docs/VANTRO_AUDIT_PACK_V2_SPEC.md, "Phase 1 - Evidence integrity".
--
-- WHAT THIS GIVES THE PACK
-- Today the Compliance view computes a SHA-256 in the *browser*, over a summary
-- object built from the report response (components/admin/AuditTab.tsx). That
-- hash proves nothing: it is computed after the fact, from data the server just
-- sent, by code the reader cannot trust, over a shape that changes whenever the
-- report changes. 1.2 deletes it.
--
-- This table replaces it with the only thing that can carry weight: a hash
-- written by the database, inside the same transaction as the row it describes,
-- at the moment of capture. Nothing in the application can write, skip, or
-- backdate one.
--
-- WHAT IT DOES NOT GIVE
-- A hash proves a row has not changed since it was hashed. It does not prove
-- the row was true when written, and for rows that predate this migration it
-- proves only that they have not changed since the backfill below. Those rows
-- are recorded with event = 'backfill' precisely so the pack can tell the two
-- apart and never claim more than it has. Nothing here should be described to a
-- reader as capture-time evidence unless its event is 'created'.
--
-- SCOPE OF THIS FILE
-- Row hashes for the eight evidential tables, on insert. Deliberately NOT here:
--   * append-only enforcement (rejecting UPDATE) -- next migration. Doing it in
--     the same step would be reckless: the obvious reading of "reject UPDATE on
--     evidential fields" would break QA approval, defect resolution, variation
--     approval, walkthrough approval, expense payment and sign-out, all of
--     which work by updating the captured row. That needs its own change, with
--     the mutable workflow fields named one table at a time.
--   * file-byte hashes -- they cannot be seen from a trigger. The upload
--     handlers do that; app/api/expenses/route.ts already hashes receipt bytes
--     with sha256 and is the pattern to follow.

-- ---------------------------------------------------------------------------
-- 1. The table
-- ---------------------------------------------------------------------------
create table if not exists public.evidence_hashes (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid references public.companies(id),
  entity_type     text not null,
  entity_id       uuid not null,

  -- Why a row can be hashed more than once. The spec's model is one hash per
  -- row, but signins capture evidence in two moments: when someone arrives and
  -- again when they leave, and the second write is the one carrying sign-out
  -- GPS. Rather than overwrite the arrival hash -- which would destroy the
  -- thing being proved -- each capture appends its own row.
  event           text not null default 'created'
                  check (event in ('created', 'signed_out', 'backfill')),

  sha256          text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  algorithm       text not null default 'sha256',

  -- Bumped whenever the set of fields fed to the hash changes. Without it, a
  -- later recipe change would silently invalidate every earlier hash and there
  -- would be no way to recompute one. The recipe for each version lives in the
  -- trigger arguments below, which is to say in version control, which is where
  -- the last schema surprise taught us to keep things.
  payload_version integer not null default 1,

  hashed_at       timestamptz not null default now(),
  hashed_by       uuid references public.users(id),

  -- 1.1's correction model: a correcting row points at what it replaces. Set by
  -- the application when it writes a superseding row, not by the trigger.
  supersedes_id   uuid references public.evidence_hashes(id)
);

comment on table public.evidence_hashes is
  'Append-only SHA-256 of each evidential row, written by trigger in the capturing transaction. event=created is capture-time; event=backfill only proves no change since 2026-09-04.';

-- No unique constraint on (entity_type, entity_id) on purpose: this is a log,
-- not a current-state table. Nor on sha256 -- a row that is changed and then
-- changed back is a fact worth keeping, and deduplicating it would hide it.
create index if not exists evidence_hashes_entity_idx
  on public.evidence_hashes (entity_type, entity_id, hashed_at);

-- 1.2 builds a pack manifest from every hash in a company and period.
create index if not exists evidence_hashes_company_time_idx
  on public.evidence_hashes (company_id, hashed_at);

-- ---------------------------------------------------------------------------
-- 2. The trigger function
-- ---------------------------------------------------------------------------
-- Canonical form is jsonb cast to text. jsonb sorts its keys, drops duplicates
-- and normalises numeric and unicode representation on the way in, so the same
-- row yields the same bytes on any connection, in any column order, under any
-- client encoding. If a Postgres upgrade ever changes that rendering,
-- payload_version is the lever -- old hashes stay recomputable under the old
-- recipe rather than silently going bad.
--
-- Fields are removed by DENYLIST, not picked by allowlist. An allowlist would
-- silently stop covering any column added later -- and a column that exists in
-- the database but in nobody's list is exactly the failure this project has
-- already had once. A denylist fails the other way: a new column is evidence
-- until someone decides otherwise, which is the safer default for an audit
-- trail.
--
-- security definer so the hash is written even when the caller's own grants
-- would not let them write evidence_hashes; a capture path must never be able
-- to skip its hash. search_path is pinned because security definer without it
-- is a privilege escalation.
create or replace function public.record_evidence_hash()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  ev           text := tg_argv[0];
  pver         integer := tg_argv[1]::integer;
  actor_column text := tg_argv[2];
  excluded     text[] := array[]::text[];
  row_json     jsonb;
  payload      jsonb;
  i            integer;
begin
  for i in 3 .. coalesce(array_length(tg_argv, 1), 0) - 1 loop
    excluded := excluded || tg_argv[i];
  end loop;

  row_json := to_jsonb(new);
  payload  := row_json - excluded;

  insert into public.evidence_hashes
    (company_id, entity_type, entity_id, event, sha256, payload_version, hashed_by)
  values (
    nullif(row_json ->> 'company_id', '')::uuid,
    tg_table_name,
    (row_json ->> 'id')::uuid,
    ev,
    encode(sha256(convert_to(payload::text, 'UTF8')), 'hex'),
    pver,
    case when actor_column = '' then null
         else nullif(row_json ->> actor_column, '')::uuid end
  );

  return null;  -- after trigger; return value is ignored
end;
$fn$;

comment on function public.record_evidence_hash() is
  'Trigger: hashes the row minus its denylisted columns into evidence_hashes. Args: event, payload_version, actor column, then the denylist.';

-- ---------------------------------------------------------------------------
-- 3. The triggers, one per evidential table
-- ---------------------------------------------------------------------------
-- What is denylisted, and why. Three kinds of column are excluded:
--   (a) notification and scheduling bookkeeping -- reminder timestamps, export
--       markers. Not evidence about the work; they change for reasons that have
--       nothing to do with what happened on site.
--   (b) AI-derived fields -- summaries, sentiment, transcripts, detections.
--       Regenerable from the evidence, and regenerated in practice. Hashing
--       them would make a model re-run look like tampering.
--   (c) workflow state written after capture -- review, approval, resolution,
--       payment. These are what the append-only migration has to keep
--       permitting, and a capture hash that changed every time a reviewer
--       clicked approve would be worthless. They are not unaudited: audit_log
--       records who did them, and 1.4 puts that in the pack.
-- Everything else -- who, when, where, accuracy, distance, the text, the file
-- reference, the money -- is evidence and is hashed.

drop trigger if exists signins_evidence_hash on public.signins;
create trigger signins_evidence_hash
  after insert on public.signins
  for each row execute function public.record_evidence_hash(
    'created', '1', 'user_id',
    'admin_reminder_sent_at', 'end_notif_sent_at', 'reminder_sent_at',
    'last_gps_ping_at', 'payroll_export_id', 'payroll_exported_at',
    'needs_review', 'flagged', 'flag_reason',
    'auto_closed', 'auto_closed_reason',
    'departed_early', 'early_departure_minutes', 'hours_worked',
    'expected_sign_out_time'
  );

-- The second capture moment. Fires only on the transition into signed out, so a
-- later payroll export or flag does not append a hash. Same denylist, so the
-- two hashes differ exactly by the sign-out evidence.
drop trigger if exists signins_evidence_hash_signout on public.signins;
create trigger signins_evidence_hash_signout
  after update of signed_out_at on public.signins
  for each row
  when (old.signed_out_at is null and new.signed_out_at is not null)
  execute function public.record_evidence_hash(
    'signed_out', '1', 'user_id',
    'admin_reminder_sent_at', 'end_notif_sent_at', 'reminder_sent_at',
    'last_gps_ping_at', 'payroll_export_id', 'payroll_exported_at',
    'needs_review', 'flagged', 'flag_reason',
    'auto_closed', 'auto_closed_reason',
    'departed_early', 'early_departure_minutes', 'hours_worked',
    'expected_sign_out_time'
  );

-- location_logs: nothing is excluded. Every column is capture evidence,
-- including within_range and distance_from_site_metres -- those record what the
-- app decided at the time, which is itself the thing an auditor questions.
-- This is the highest-volume table in the schema (6 MB of index on user_id
-- alone), so one evidence_hashes row per ping is the cost being accepted here.
-- If that proves too expensive the spec's own answer is to hash the batch per
-- sign-in on sign-out instead; that is a payload_version bump, not a redesign.
drop trigger if exists location_logs_evidence_hash on public.location_logs;
create trigger location_logs_evidence_hash
  after insert on public.location_logs
  for each row execute function public.record_evidence_hash(
    'created', '1', 'user_id'
  );

drop trigger if exists diary_entries_evidence_hash on public.diary_entries;
create trigger diary_entries_evidence_hash
  after insert on public.diary_entries
  for each row execute function public.record_evidence_hash(
    'created', '1', 'user_id',
    'ai_alert_type', 'ai_processed', 'ai_summary', 'ai_variation_detected',
    'video_ai_summary', 'video_ai_summary_at',
    'reply', 'replied_at', 'replied_by'
  );

drop trigger if exists qa_submissions_evidence_hash on public.qa_submissions;
create trigger qa_submissions_evidence_hash
  after insert on public.qa_submissions
  for each row execute function public.record_evidence_hash(
    'created', '1', 'user_id',
    'state', 'reviewed_at', 'reviewed_by', 'rejection_note',
    'video_ai_summary', 'video_ai_summary_at'
  );

drop trigger if exists defects_evidence_hash on public.defects;
create trigger defects_evidence_hash
  after insert on public.defects
  for each row execute function public.record_evidence_hash(
    'created', '1', 'user_id',
    'status', 'resolution_note', 'resolved_at', 'resolved_by'
  );

drop trigger if exists variations_evidence_hash on public.variations;
create trigger variations_evidence_hash
  after insert on public.variations
  for each row execute function public.record_evidence_hash(
    'created', '1', 'raised_by',
    'ai_confidence', 'ai_detected',
    'status', 'notes', 'approved_at', 'approved_by', 'approved_value',
    'invoiced_at'
  );

drop trigger if exists walkthroughs_evidence_hash on public.walkthroughs;
create trigger walkthroughs_evidence_hash
  after insert on public.walkthroughs
  for each row execute function public.record_evidence_hash(
    'created', '1', 'installer_id',
    'ai_flags', 'ai_sections', 'ai_sentiment', 'ai_summary', 'ai_themes',
    'transcript_full', 'integrity_hash',
    'approval_status', 'approved_at', 'approved_by', 'rejected_reason',
    'processing_attempts', 'processing_completed_at', 'processing_error',
    'processing_started_at', 'processing_status'
  );

drop trigger if exists expenses_evidence_hash on public.expenses;
create trigger expenses_evidence_hash
  after insert on public.expenses
  for each row execute function public.record_evidence_hash(
    'created', '1', 'user_id',
    'status', 'paid_at', 'paid_in_week_starting',
    'review_note', 'reviewed_at', 'reviewed_by',
    'idempotency_key'
  );

-- ---------------------------------------------------------------------------
-- 4. Backfill
-- ---------------------------------------------------------------------------
-- Every row that already exists gets a hash, marked 'backfill' so it can never
-- be passed off as capture-time. hashed_at is now() -- deliberately not the
-- row's own created_at, which would be a lie about when the hash was taken.
--
-- Each payload here must match its trigger's denylist exactly, or a backfilled
-- row will appear to have changed the first time anyone recomputes it.
insert into public.evidence_hashes
  (company_id, entity_type, entity_id, event, sha256, payload_version, hashed_by)
select
  nullif(t.row_json ->> 'company_id', '')::uuid,
  t.entity_type,
  (t.row_json ->> 'id')::uuid,
  'backfill',
  encode(sha256(convert_to((t.row_json - t.excluded)::text, 'UTF8')), 'hex'),
  1,
  nullif(t.row_json ->> t.actor_column, '')::uuid
from (
  select 'signins' as entity_type, to_jsonb(s) as row_json, 'user_id' as actor_column,
         array['admin_reminder_sent_at','end_notif_sent_at','reminder_sent_at',
               'last_gps_ping_at','payroll_export_id','payroll_exported_at',
               'needs_review','flagged','flag_reason','auto_closed',
               'auto_closed_reason','departed_early','early_departure_minutes',
               'hours_worked','expected_sign_out_time'] as excluded
    from public.signins s
  union all
  select 'location_logs', to_jsonb(l), 'user_id', array[]::text[]
    from public.location_logs l
  union all
  select 'diary_entries', to_jsonb(d), 'user_id',
         array['ai_alert_type','ai_processed','ai_summary','ai_variation_detected',
               'video_ai_summary','video_ai_summary_at','reply','replied_at',
               'replied_by']
    from public.diary_entries d
  union all
  select 'qa_submissions', to_jsonb(q), 'user_id',
         array['state','reviewed_at','reviewed_by','rejection_note',
               'video_ai_summary','video_ai_summary_at']
    from public.qa_submissions q
  union all
  select 'defects', to_jsonb(f), 'user_id',
         array['status','resolution_note','resolved_at','resolved_by']
    from public.defects f
  union all
  select 'variations', to_jsonb(v), 'raised_by',
         array['ai_confidence','ai_detected','status','notes','approved_at',
               'approved_by','approved_value','invoiced_at']
    from public.variations v
  union all
  select 'walkthroughs', to_jsonb(w), 'installer_id',
         array['ai_flags','ai_sections','ai_sentiment','ai_summary','ai_themes',
               'transcript_full','integrity_hash','approval_status','approved_at',
               'approved_by','rejected_reason','processing_attempts',
               'processing_completed_at','processing_error',
               'processing_started_at','processing_status']
    from public.walkthroughs w
  union all
  select 'expenses', to_jsonb(e), 'user_id',
         array['status','paid_at','paid_in_week_starting','review_note',
               'reviewed_at','reviewed_by','idempotency_key']
    from public.expenses e
) t
where not exists (
  select 1 from public.evidence_hashes h
   where h.entity_type = t.entity_type
     and h.entity_id = (t.row_json ->> 'id')::uuid
);

-- ---------------------------------------------------------------------------
-- 5. RLS
-- ---------------------------------------------------------------------------
-- Same posture as audit_credits: on, with no policies. Every reader is a server
-- route holding the service role, which bypasses RLS, so a leaked anon key
-- cannot enumerate what evidence exists or when it was taken. The /verify
-- endpoint in 1.2 answers from the server and returns no evidence content.
alter table public.evidence_hashes enable row level security;

notify pgrst, 'reload schema';

-- Verify:
--   select event, entity_type, count(*) from evidence_hashes
--    group by 1,2 order by 1,2;      -> all 'backfill' immediately after
--   select count(*) from evidence_hashes where sha256 !~ '^[0-9a-f]{64}$';  -> 0
--   select relrowsecurity from pg_class where relname = 'evidence_hashes';  -> t
