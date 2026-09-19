-- 20260919100000_variations_workflow.sql  -  Vantro
--
-- Variations and dayworks, from the phone to a signed line on a payment
-- application.
--
-- THE FLOW
--   1. A worker raises one from the job screen: what changed, photographs,
--      hours, materials, and what they think it cost.            status pending
--   2. An admin prices it and approves it (or rejects it).       status approved
--   3. One click emails the main contractor a link.              status sent
--   4. The main contractor signs it, or declines it, on that
--      page.                                          status signed / declined
--   5. Signed ones are added to a payment application for the
--      job, one line each.                                       status invoiced
--
-- The variations table already exists, with its capture hash, amendment
-- recorder and immutability guard (20260904010000, 20260904020000), and nine
-- AI-detected rows in it. This widens it rather than starting a second table:
-- the audit pack already renders a variations register from it, and two
-- registers would disagree.
--
-- DAYWORKS ARE A KIND OF VARIATION, NOT A TABLE. A daywork sheet is the same
-- record -- labour, plant and materials on work outside the contract, signed by
-- the main contractor's representative -- valued by time and materials rather
-- than by a quoted price. Same capture, same signature, same line on the
-- application. `kind` separates them and they are numbered separately (VO-001,
-- DW-001), because that is how both sides refer to them on site.
--
-- WHAT IS HASHED
--   * The worker's capture: the variations row, by the existing trigger, now at
--     payload_version 2 (below). Includes the photos' storage paths, the hours,
--     the materials and the worker's figure.
--   * The photographs' bytes: by the upload handler (lib/evidence.ts), keyed by
--     storage path, exactly as incidents do.
--   * Each link sent: variation_shares, on insert.
--   * The main contractor's decision: variation_signatures, on insert, event
--     'signed' for a signature. The row carries document_sha256 -- the hash of
--     exactly what the signer was shown, INCLUDING the price, which the capture
--     hash deliberately does not cover. That is what makes the price evidence:
--     it is not hashed when an admin types it, it is hashed when the other side
--     agrees to it.
--   * Each payment application line, on insert.
--
-- The admin's price and approval stay OUT of the capture hash, as review state
-- does on every other evidential table: a capture hash that changed whenever
-- somebody priced the work would say the worker's record had been altered,
-- which is the opposite of the truth.

begin;

-- ---------------------------------------------------------------------------
-- 1. Widen variations
-- ---------------------------------------------------------------------------
alter table public.variations
  add column if not exists kind          text not null default 'variation',
  add column if not exists number        integer,
  add column if not exists photo_urls    text[] not null default '{}',
  add column if not exists photo_paths   text[] not null default '{}',
  add column if not exists labour_hours  numeric,
  add column if not exists materials     text,
  add column if not exists sent_at       timestamptz,
  add column if not exists sent_by       uuid references public.users(id) on delete set null,
  add column if not exists sent_to_email text,
  add column if not exists signed_at     timestamptz,
  add column if not exists declined_at   timestamptz,
  add column if not exists decline_reason text;

comment on column public.variations.kind is
  'variation (priced change) or daywork (time and materials). Numbered separately per job.';
comment on column public.variations.number is
  'Per job and kind: VO-001, DW-001. Assigned by trigger on insert and part of the capture hash.';
comment on column public.variations.estimated_value is
  'What the person who raised it thinks it cost, in pounds. Evidence; hashed.';
comment on column public.variations.approved_value is
  'The price the company puts to the main contractor, in pounds. Review state, not in the capture hash -- bound instead by variation_signatures.document_sha256 when it is signed.';

alter table public.variations drop constraint if exists variations_status_check;
alter table public.variations add constraint variations_status_check
  check (status in ('pending', 'approved', 'rejected', 'sent', 'signed', 'declined', 'invoiced'));

alter table public.variations drop constraint if exists variations_kind_check;
alter table public.variations add constraint variations_kind_check
  check (kind in ('variation', 'daywork'));

alter table public.variations drop constraint if exists variations_money_check;
alter table public.variations add constraint variations_money_check
  check ((estimated_value is null or estimated_value >= 0)
     and (approved_value is null or approved_value >= 0)
     and (labour_hours is null or (labour_hours >= 0 and labour_hours <= 10000)));

alter table public.variations drop constraint if exists variations_text_len;
alter table public.variations add constraint variations_text_len
  check (char_length(description) between 1 and 8000
     and (materials is null or char_length(materials) <= 4000)
     and (decline_reason is null or char_length(decline_reason) <= 4000));

-- A priced variation always has a price. "Approved" with no figure is how a
-- register ends up totalling to something nobody agreed.
alter table public.variations drop constraint if exists variations_approved_needs_price;
alter table public.variations add constraint variations_approved_needs_price
  check (status not in ('approved', 'sent', 'signed', 'invoiced') or approved_value is not null);

-- Existing rows get numbers in the order they were raised, so the register the
-- pack prints reads the same before and after.
--
-- The v1 amendment recorder comes off FIRST. Left on, this update would widen
-- each row's payload and append an 'amended' hash to all nine -- a record that
-- the evidence changed, written by a migration. It is recreated at v2 below,
-- after the v2 backfill has given it something correct to compare against.
drop trigger if exists variations_evidence_amendment on public.variations;

with numbered as (
  select id, row_number() over (partition by job_id, kind order by created_at, id) as n
    from public.variations
   where number is null
)
update public.variations v set number = numbered.n
  from numbered where numbered.id = v.id;

alter table public.variations alter column number set not null;

create unique index if not exists variations_job_kind_number
  on public.variations (job_id, kind, number);
create index if not exists variations_company_status
  on public.variations (company_id, status, created_at desc);

-- Number on insert. Locked per job and kind, so two workers raising at the same
-- moment cannot both be given VO-004.
create or replace function public.variation_assign_number()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $fn$
begin
  if new.number is null then
    perform pg_advisory_xact_lock(hashtextextended('variation:' || new.job_id::text || ':' || new.kind, 0));
    select coalesce(max(number), 0) + 1 into new.number
      from public.variations
     where job_id = new.job_id and kind = new.kind;
  end if;
  return new;
end;
$fn$;

drop trigger if exists variations_assign_number on public.variations;
create trigger variations_assign_number
  before insert on public.variations
  for each row execute function public.variation_assign_number();

-- ---------------------------------------------------------------------------
-- 2. Once it has left the building, it is frozen
-- ---------------------------------------------------------------------------
-- After a link has gone to the main contractor, nothing they could have read
-- may change: not the worker's account, not the price. A variation that could
-- be re-priced after it was sent is a signature on a number nobody saw. The
-- signature's document hash would catch it after the fact; this stops it
-- happening at all.
create or replace function public.variation_freeze_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $fn$
begin
  if old.status in ('sent', 'signed', 'invoiced') and (
       new.job_id         is distinct from old.job_id
    or new.kind           is distinct from old.kind
    or new.number         is distinct from old.number
    or new.description    is distinct from old.description
    or new.photo_urls     is distinct from old.photo_urls
    or new.photo_paths    is distinct from old.photo_paths
    or new.labour_hours   is distinct from old.labour_hours
    or new.materials      is distinct from old.materials
    or new.estimated_value is distinct from old.estimated_value
    or new.approved_value is distinct from old.approved_value
    or new.raised_by      is distinct from old.raised_by
    or new.created_at     is distinct from old.created_at
  ) then
    raise exception
      'variation % has been sent to the main contractor and can no longer be changed', old.id
      using errcode = 'integrity_constraint_violation';
  end if;

  -- A signature is final. Signed goes forward to invoiced and nowhere else;
  -- invoiced goes back to signed only when it is taken off a draft application.
  if old.status = 'signed' and new.status not in ('signed', 'invoiced') then
    raise exception 'variation % is signed; it cannot move to %', old.id, new.status
      using errcode = 'integrity_constraint_violation';
  end if;
  if old.status = 'invoiced' and new.status not in ('invoiced', 'signed') then
    raise exception 'variation % is on a payment application; it cannot move to %', old.id, new.status
      using errcode = 'integrity_constraint_violation';
  end if;
  if new.signed_at is distinct from old.signed_at and old.signed_at is not null then
    raise exception 'variation % signed_at is write-once', old.id
      using errcode = 'integrity_constraint_violation';
  end if;
  return new;
end;
$fn$;

drop trigger if exists variations_freeze on public.variations;
create trigger variations_freeze
  before update on public.variations
  for each row execute function public.variation_freeze_guard();

-- ---------------------------------------------------------------------------
-- 3. Capture hash, payload version 2
-- ---------------------------------------------------------------------------
-- Adding columns changes to_jsonb(row) for every existing row, so under the
-- old triggers the first status change after this migration would append an
-- 'amended' hash to all nine rows -- a record saying the evidence changed when
-- nobody touched it. So the recipe is versioned: payload_version 2 is the
-- widened row minus the widened denylist, and every existing row gets a v2
-- 'backfill' hash chained to its v1 hash. The v1 hashes stay recomputable by
-- dropping the columns this migration added.
--
-- The denylist is the old one plus the new workflow columns. Everything the
-- worker supplied -- including kind, number and the photo paths -- is hashed.
drop trigger if exists variations_evidence_hash on public.variations;
create trigger variations_evidence_hash
  after insert on public.variations
  for each row execute function public.record_evidence_hash(
    'created', '2', 'raised_by',
    'ai_confidence', 'ai_detected',
    'status', 'notes', 'approved_at', 'approved_by', 'approved_value',
    'invoiced_at',
    'sent_at', 'sent_by', 'sent_to_email', 'signed_at', 'declined_at', 'decline_reason'
  );

insert into public.evidence_hashes
  (company_id, entity_type, entity_id, event, sha256, payload_version, hashed_by, supersedes_id)
select
  v.company_id,
  'variations',
  v.id,
  'backfill',
  encode(sha256(convert_to((to_jsonb(v) - array[
    'ai_confidence','ai_detected','status','notes','approved_at','approved_by',
    'approved_value','invoiced_at','sent_at','sent_by','sent_to_email',
    'signed_at','declined_at','decline_reason'])::text, 'UTF8')), 'hex'),
  2,
  v.raised_by,
  (select h.id from public.evidence_hashes h
    where h.entity_type = 'variations' and h.entity_id = v.id
    order by h.hashed_at desc, h.id desc limit 1)
from public.variations v;

-- Same denylist as the capture trigger above, or an untouched row appears
-- amended the moment it is priced.
create trigger variations_evidence_amendment
  after update on public.variations
  for each row execute function public.record_evidence_amendment(
    '2', 'raised_by',
    'ai_confidence', 'ai_detected',
    'status', 'notes', 'approved_at', 'approved_by', 'approved_value',
    'invoiced_at',
    'sent_at', 'sent_by', 'sent_to_email', 'signed_at', 'declined_at', 'decline_reason'
  );

-- ---------------------------------------------------------------------------
-- 4. Links sent to the main contractor
-- ---------------------------------------------------------------------------
-- The token itself is never stored: a leaked table must not be a set of
-- working signature links. Only its sha256 is, as client_portal_access does.
-- document_sha256 is the hash of what the link shows, fixed at the moment it
-- was sent; the sign route refuses if the variation no longer hashes to it.
create table if not exists public.variation_shares (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies(id) on delete cascade,
  variation_id     uuid not null references public.variations(id) on delete cascade,
  token_hash       text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  sent_to_email    text not null check (char_length(sent_to_email) between 3 and 320),
  document_sha256  text not null check (document_sha256 ~ '^[0-9a-f]{64}$'),
  created_by       uuid references public.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  expires_at       timestamptz not null,
  revoked_at       timestamptz,
  first_viewed_at  timestamptz,
  last_viewed_at   timestamptz,
  view_count       integer not null default 0
);

create index if not exists variation_shares_variation
  on public.variation_shares (variation_id, created_at desc);

drop trigger if exists variation_shares_evidence_hash on public.variation_shares;
create trigger variation_shares_evidence_hash
  after insert on public.variation_shares
  for each row execute function public.record_evidence_hash(
    'created', '1', 'created_by',
    'revoked_at', 'first_viewed_at', 'last_viewed_at', 'view_count'
  );

drop trigger if exists variation_shares_immutable on public.variation_shares;
create trigger variation_shares_immutable
  before update on public.variation_shares
  for each row execute function public.enforce_evidence_immutability(
    '6', 'id', 'company_id', 'variation_id', 'token_hash', 'document_sha256', 'sent_to_email'
  );

-- ---------------------------------------------------------------------------
-- 5. The main contractor's decision
-- ---------------------------------------------------------------------------
-- Append-only, never updated. A signature that could be edited is not one. At
-- most one signature per variation; a decline may be followed by a re-priced
-- resend and a second decision.
create table if not exists public.variation_signatures (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies(id) on delete cascade,
  variation_id     uuid not null references public.variations(id) on delete cascade,
  share_id         uuid not null references public.variation_shares(id) on delete cascade,
  decision         text not null check (decision in ('signed', 'declined')),
  signer_name      text not null check (char_length(trim(signer_name)) between 2 and 200),
  signer_position  text check (signer_position is null or char_length(signer_position) <= 200),
  signature_svg    text check (signature_svg is null or char_length(signature_svg) between 32 and 200000),
  decline_reason   text check (decline_reason is null or char_length(decline_reason) <= 4000),
  -- What they were shown, hashed. Covers the price.
  document_sha256  text not null check (document_sha256 ~ '^[0-9a-f]{64}$'),
  -- The value they agreed to, in pence, copied out of the document so a
  -- reader does not have to recompute the hash to see the figure.
  agreed_pence     bigint check (agreed_pence is null or agreed_pence >= 0),
  ip_address       text,
  user_agent       text,
  decided_at       timestamptz not null default now(),

  constraint variation_signatures_signed_has_mark
    check (decision <> 'signed' or (signature_svg is not null and agreed_pence is not null)),
  constraint variation_signatures_declined_has_reason
    check (decision <> 'declined' or (decline_reason is not null and char_length(trim(decline_reason)) > 0))
);

create or replace function public.reject_variation_signature_update()
returns trigger
language plpgsql
as $fn$
begin
  raise exception 'variation_signatures is append-only: % may not be updated', old.id
    using errcode = 'restrict_violation';
end;
$fn$;

drop trigger if exists variation_signatures_immutable on public.variation_signatures;
create trigger variation_signatures_immutable
  before update on public.variation_signatures
  for each row execute function public.reject_variation_signature_update();

-- 'signed' for a signature, 'created' for a decline: the pack prints the event
-- name, and a refusal filed as "signed" would say the opposite of what happened.
drop trigger if exists variation_signatures_evidence_signed on public.variation_signatures;
create trigger variation_signatures_evidence_signed
  after insert on public.variation_signatures
  for each row when (new.decision = 'signed')
  execute function public.record_evidence_hash('signed', '1', '');

drop trigger if exists variation_signatures_evidence_declined on public.variation_signatures;
create trigger variation_signatures_evidence_declined
  after insert on public.variation_signatures
  for each row when (new.decision = 'declined')
  execute function public.record_evidence_hash('created', '1', '');

-- The decision moves the variation, in the same transaction as the signature.
-- Done by trigger so there is no state where a signature exists and the
-- variation still says it is waiting for one, or the other way round. It also
-- refuses a decision on anything that is not currently out for signature, and
-- a decision through a link that has been revoked, expired, or superseded.
create or replace function public.variation_apply_decision()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v   public.variations%rowtype;
  sh  public.variation_shares%rowtype;
begin
  select * into v from public.variations where id = new.variation_id for update;
  select * into sh from public.variation_shares where id = new.share_id;

  if v.id is null or sh.id is null or sh.variation_id <> v.id or v.company_id <> new.company_id then
    raise exception 'signature does not match its variation' using errcode = 'integrity_constraint_violation';
  end if;
  if v.status <> 'sent' then
    raise exception 'variation % is not awaiting a signature (it is %)', v.id, v.status
      using errcode = 'integrity_constraint_violation';
  end if;
  if sh.revoked_at is not null or sh.expires_at <= now() then
    raise exception 'this link is no longer valid' using errcode = 'integrity_constraint_violation';
  end if;
  if sh.document_sha256 <> new.document_sha256 then
    raise exception 'the document signed is not the document sent' using errcode = 'integrity_constraint_violation';
  end if;

  if new.decision = 'signed' then
    update public.variations
       set status = 'signed', signed_at = new.decided_at
     where id = v.id;
  else
    update public.variations
       set status = 'declined', declined_at = new.decided_at, decline_reason = new.decline_reason
     where id = v.id;
  end if;
  return null;
end;
$fn$;

drop trigger if exists variation_signatures_apply on public.variation_signatures;
create trigger variation_signatures_apply
  after insert on public.variation_signatures
  for each row execute function public.variation_apply_decision();

-- A declined variation can be re-priced and sent again, which needs a second
-- decision row. So the uniqueness that matters is one SIGNATURE per variation;
-- declines may repeat.
alter table public.variation_signatures drop constraint if exists variation_signatures_variation_id_key;
create unique index if not exists variation_signatures_one_signed
  on public.variation_signatures (variation_id) where decision = 'signed';
create index if not exists variation_signatures_variation
  on public.variation_signatures (variation_id, decided_at desc);

-- ---------------------------------------------------------------------------
-- 6. Payment applications
-- ---------------------------------------------------------------------------
-- Deliberately small. An application here is a numbered list of lines for one
-- job, draft until someone marks it submitted. It does not model the gross
-- valuation, retention deduction or previous certificates of a full interim
-- application -- it is where captured extras go so they cannot be forgotten.
create table if not exists public.payment_applications (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  job_id        uuid not null references public.jobs(id) on delete cascade,
  number        integer not null,
  status        text not null default 'draft' check (status in ('draft', 'submitted')),
  created_by    uuid references public.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  submitted_at  timestamptz,
  submitted_by  uuid references public.users(id) on delete set null,
  constraint payment_applications_number unique (job_id, number),
  constraint payment_applications_submitted_needs_who
    check (status <> 'submitted' or (submitted_at is not null and submitted_by is not null))
);

-- At most one draft per job, so "add to payment application" has one answer.
create unique index if not exists payment_applications_one_draft
  on public.payment_applications (job_id) where status = 'draft';
create index if not exists payment_applications_company
  on public.payment_applications (company_id, created_at desc);

create table if not exists public.payment_application_lines (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  application_id  uuid not null references public.payment_applications(id) on delete cascade,
  source          text not null check (source in ('variation', 'expense')),
  variation_id    uuid references public.variations(id) on delete restrict,
  expense_id      uuid references public.expenses(id) on delete restrict,
  description     text not null,
  amount_pence    bigint not null check (amount_pence >= 0),
  created_by      uuid references public.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  constraint payment_application_lines_one_source check (
    (source = 'variation' and variation_id is not null and expense_id is null)
    or (source = 'expense' and expense_id is not null and variation_id is null)
  )
);

-- Money is applied for once. These two indexes are what "not yet on a payment
-- application" means, and what stops the same variation being claimed twice.
create unique index if not exists payment_application_lines_variation
  on public.payment_application_lines (variation_id) where variation_id is not null;
create unique index if not exists payment_application_lines_expense
  on public.payment_application_lines (expense_id) where expense_id is not null;
create index if not exists payment_application_lines_application
  on public.payment_application_lines (application_id);

drop trigger if exists payment_application_lines_evidence_hash on public.payment_application_lines;
create trigger payment_application_lines_evidence_hash
  after insert on public.payment_application_lines
  for each row execute function public.record_evidence_hash('created', '1', 'created_by');

-- Lines are never edited. They may be removed only while their application is
-- a draft; once submitted, the application is what was sent.
create or replace function public.payment_application_line_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $fn$
begin
  if tg_op = 'UPDATE' then
    raise exception 'payment application lines are not edited; remove and re-add while the application is a draft'
      using errcode = 'restrict_violation';
  end if;
  if exists (select 1 from public.payment_applications a
              where a.id = old.application_id and a.status = 'submitted') then
    raise exception 'payment application % has been submitted; its lines are fixed', old.application_id
      using errcode = 'restrict_violation';
  end if;
  return old;
end;
$fn$;

drop trigger if exists payment_application_lines_guard on public.payment_application_lines;
create trigger payment_application_lines_guard
  before update or delete on public.payment_application_lines
  for each row execute function public.payment_application_line_guard();

-- Submitted is final.
create or replace function public.payment_application_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $fn$
begin
  if old.status = 'submitted' and (new.status <> 'submitted'
     or new.job_id is distinct from old.job_id or new.number is distinct from old.number) then
    raise exception 'payment application % has been submitted and cannot be changed', old.id
      using errcode = 'restrict_violation';
  end if;
  if new.company_id is distinct from old.company_id then
    raise exception 'payment application % cannot move company', old.id
      using errcode = 'integrity_constraint_violation';
  end if;
  return new;
end;
$fn$;

drop trigger if exists payment_applications_guard on public.payment_applications;
create trigger payment_applications_guard
  before update on public.payment_applications
  for each row execute function public.payment_application_guard();

-- ---------------------------------------------------------------------------
-- 7. Add everything eligible for a job to its draft application, atomically
-- ---------------------------------------------------------------------------
-- One transaction: find or open the draft, add every signed variation and
-- daywork and every approved or paid expense on the job not already on an
-- application, and move the variations to invoiced. Doing this from the route
-- as separate writes would leave a line with no status change, or a status
-- change with no line, on any failure between the two.
create or replace function public.add_to_payment_application(
  p_company_id uuid,
  p_job_id     uuid,
  p_user_id    uuid
) returns table (application_id uuid, application_number integer, lines_added integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
#variable_conflict use_column
declare
  app_id   uuid;
  app_num  integer;
  added    integer := 0;
  n        integer;
begin
  if not exists (select 1 from public.jobs j where j.id = p_job_id and j.company_id = p_company_id) then
    raise exception 'job % is not in company %', p_job_id, p_company_id
      using errcode = 'insufficient_privilege';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('payapp:' || p_job_id::text, 0));

  select a.id, a.number into app_id, app_num
    from public.payment_applications a
   where a.job_id = p_job_id and a.status = 'draft';

  if app_id is null then
    select coalesce(max(a.number), 0) + 1 into app_num
      from public.payment_applications a where a.job_id = p_job_id;
    insert into public.payment_applications (company_id, job_id, number, created_by)
    values (p_company_id, p_job_id, app_num, p_user_id)
    returning id into app_id;
  end if;

  insert into public.payment_application_lines
    (company_id, application_id, source, variation_id, description, amount_pence, created_by)
  select v.company_id, app_id, 'variation', v.id,
         (case when v.kind = 'daywork' then 'DW-' else 'VO-' end)
           || lpad(v.number::text, 3, '0') || ' ' || left(v.description, 300),
         s.agreed_pence,
         p_user_id
    from public.variations v
    join public.variation_signatures s on s.variation_id = v.id and s.decision = 'signed'
   where v.company_id = p_company_id
     and v.job_id = p_job_id
     and v.status = 'signed'
     and not exists (select 1 from public.payment_application_lines l where l.variation_id = v.id);
  get diagnostics n = row_count;
  added := added + n;

  update public.variations v
     set status = 'invoiced', invoiced_at = now()
   where v.company_id = p_company_id
     and v.job_id = p_job_id
     and v.status = 'signed'
     and exists (select 1 from public.payment_application_lines l where l.variation_id = v.id);

  insert into public.payment_application_lines
    (company_id, application_id, source, expense_id, description, amount_pence, created_by)
  select e.company_id, app_id, 'expense', e.id,
         'Expense: ' || e.category || coalesce(' - ' || left(e.note, 280), ''),
         round(e.amount * 100)::bigint,
         p_user_id
    from public.expenses e
   where e.company_id = p_company_id
     and e.job_id = p_job_id
     and e.status in ('approved', 'paid')
     and not exists (select 1 from public.payment_application_lines l where l.expense_id = e.id);
  get diagnostics n = row_count;
  added := added + n;

  return query select app_id, app_num, added;
end;
$fn$;

-- Taking a line back off a draft. The variation returns to signed; its
-- signature is untouched.
create or replace function public.remove_payment_application_line(
  p_company_id uuid,
  p_line_id    uuid
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_id uuid;
begin
  delete from public.payment_application_lines l
   where l.id = p_line_id and l.company_id = p_company_id
  returning l.variation_id into v_id;

  if not found then
    raise exception 'line % not found', p_line_id using errcode = 'no_data_found';
  end if;

  if v_id is not null then
    update public.variations set status = 'signed', invoiced_at = null
     where id = v_id and company_id = p_company_id and status = 'invoiced';
  end if;
end;
$fn$;

revoke all on function public.add_to_payment_application(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.remove_payment_application_line(uuid, uuid) from public, anon, authenticated;
grant execute on function public.add_to_payment_application(uuid, uuid, uuid) to service_role;
grant execute on function public.remove_payment_application_line(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 8. RLS: server only
-- ---------------------------------------------------------------------------
-- Every read and write of these four tables goes through a route that checks
-- who is asking, with the service role. RLS on and no policy means a browser
-- session with the anon key reaches none of it -- which matters most for
-- variation_shares, whose rows are the means of signing.
alter table public.variation_shares          enable row level security;
alter table public.variation_signatures      enable row level security;
alter table public.payment_applications      enable row level security;
alter table public.payment_application_lines enable row level security;

commit;

notify pgrst, 'reload schema';

-- Verify:
--   select number, kind, status from variations order by job_id, kind, number;
--   select event, payload_version, count(*) from evidence_hashes
--    where entity_type = 'variations' group by 1, 2;     -- 9 v2 backfills
--   -- an untouched old row does not look amended on its next status change:
--   update variations set status = 'rejected' where id = '...';
--   select event from evidence_hashes where entity_id = '...' order by hashed_at desc limit 1;  -> backfill
