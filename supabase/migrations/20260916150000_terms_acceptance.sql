-- Record that the company accepted the Terms of Service.
--
-- The DPA columns already exist and are reused as they are: dpa_accepted_at,
-- dpa_accepted_by_name, dpa_accepted_by_user_id, dpa_version. Nothing is built
-- beside them.
--
-- The terms get their own three columns rather than sharing the DPA's, and that
-- is the whole judgement in this migration. They are two different documents
-- with two different version histories. Accepting a DPA is not accepting terms
-- of service, and if the terms are reissued at 1.1 while the DPA stays at 1.0,
-- a single shared timestamp cannot say which of them the company has agreed to.
-- One column would make the record cheaper to write and worthless as evidence,
-- which is the opposite of the point of keeping it.
--
-- There is no accepted_ip column, deliberately. The evidential question is who
-- agreed and when, and the name, the user id and the timestamp answer it. An IP
-- address is personal data that would have to be justified, disclosed in the
-- privacy policy and erased on request, in exchange for almost nothing.

alter table public.companies
  add column if not exists terms_accepted_at timestamptz,
  add column if not exists terms_accepted_by_name text,
  add column if not exists terms_version text;

comment on column public.companies.terms_accepted_at is
  'When the Terms of Service were accepted. Set at signup from the checkbox, and never cleared -- a withdrawn acceptance is a cancelled subscription, not a null timestamp.';
comment on column public.companies.terms_accepted_by_name is
  'The name of the person who accepted, captured at the moment of acceptance. Stored rather than joined: the user row can be renamed, deactivated or anonymised under a GDPR erasure, and the acceptance record has to survive all three.';
comment on column public.companies.terms_version is
  'Which version of the terms was accepted. Without it the timestamp only proves that something was agreed to.';

-- Existing companies signed up before there was a checkbox. They are left NULL
-- rather than backfilled with a fabricated timestamp: a consent record invented
-- by a migration is worse than no record, because it looks like evidence.
-- The compliance panel shows the gap so an admin can accept and close it.
