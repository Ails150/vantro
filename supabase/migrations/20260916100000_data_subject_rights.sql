-- 20260916100000_data_subject_rights.sql  -  Vantro
--
-- UK GDPR Articles 15 and 17: a worker's right to a copy of their data, and
-- their right to have it erased.
--
-- ERASURE HERE MEANS ANONYMISATION, NOT DELETION, AND THAT IS A CONSIDERED
-- POSITION RATHER THAN A CONVENIENCE.
--
-- Deleting a worker's rows would destroy evidence that is not only about them.
-- A sign-in record is also proof that a site was manned that morning. A RAMS
-- signature is proof the method statement was briefed before work started. A
-- QA sign-off is a quality record a client may rely on years later, and it sits
-- inside a signed audit pack with a merkle root over it. Removing those rows
-- would silently invalidate packs already issued to third parties and would
-- destroy other people's records in order to satisfy one person's request.
--
-- Article 17(3) allows exactly this: erasure does not apply where processing is
-- necessary for compliance with a legal obligation or for the establishment or
-- defence of legal claims. Health and safety records are both.
--
-- So what is erased is the IDENTITY, not the EVENT. users.name becomes a
-- pseudonym, the contact details and the PIN hash go, and every evidence row
-- keeps its shape, its timestamps and its hash. "Someone was on site at 07:31"
-- survives; "that someone was Marek" does not.
--
-- WHAT THIS HONESTLY DOES NOT REACH
-- An audit pack generated BEFORE anonymisation has the worker's name inside a
-- manifest that is signed and hashed. Rewriting it would break the signature,
-- which is the one thing making the pack worth anything. Those packs keep the
-- name. That is a real limit, it is the correct trade, and it is written down
-- here and surfaced in the UI rather than quietly ignored.

begin;

-- ---------------------------------------------------------------------------
-- 1. The marker on the user
-- ---------------------------------------------------------------------------
alter table public.users
  add column if not exists anonymised_at timestamptz,
  add column if not exists anonymised_by uuid references public.users(id) on delete set null;

comment on column public.users.anonymised_at is
  'Set when this person exercised their right to erasure. Their evidence rows survive with their identity removed. Null means an ordinary active or suspended worker.';

-- An anonymised worker must never be able to sign in again: the row exists only
-- to keep foreign keys honest. Enforced here rather than trusted to the route,
-- because a PIN left on an anonymised row is a live credential attached to a
-- person who has asked to be forgotten.
alter table public.users
  drop constraint if exists users_anonymised_has_no_credentials;
alter table public.users
  add constraint users_anonymised_has_no_credentials
  check (
    anonymised_at is null
    or (pin_hash is null and auth_user_id is null and is_active = false)
  );

-- ---------------------------------------------------------------------------
-- 2. The record that a request was made and answered
-- ---------------------------------------------------------------------------
--
-- Article 30 expects a controller to be able to show what it did and when.
-- "We exported Marek's data on the 14th and anonymised him on the 21st" has to
-- be answerable from the system rather than from somebody's inbox.
--
-- Deliberately NOT deleted when the subject is anonymised: the log records that
-- a request was handled, which is the controller's own accountability record,
-- and it holds no personal data beyond an id that no longer resolves to a name.
create table if not exists public.data_subject_requests (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,

  -- The person the request was ABOUT. Kept on delete set null so that erasing
  -- the company does not orphan the log, and so that a hard-deleted user row
  -- does not take the record of the request with it.
  subject_id    uuid references public.users(id) on delete set null,

  -- Denormalised on purpose. After anonymisation the subject's name is gone
  -- from users, and "which request was this" still has to be answerable -- but
  -- only for an EXPORT, where no identity was removed. An erasure stores null
  -- here, because keeping the name would defeat the erasure it is recording.
  subject_label text,

  kind          text not null check (kind in ('export', 'erasure')),

  -- Who actioned it.
  actioned_by   uuid references public.users(id) on delete set null,
  actioned_at   timestamptz not null default now(),

  -- Free text: what format was given, what was explained to the subject.
  notes         text
);

create index if not exists data_subject_requests_company_idx
  on public.data_subject_requests (company_id, actioned_at desc);

comment on table public.data_subject_requests is
  'Accountability log for UK GDPR Article 15 and 17 requests. An erasure row deliberately stores no subject_label.';

alter table public.data_subject_requests enable row level security;

-- No policies: reached only through the service client behind an admin check,
-- matching pay_rules and mfa_recovery_codes.

commit;
