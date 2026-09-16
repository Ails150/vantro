-- 20260916090000_mfa_recovery_codes.sql  -  Vantro
--
-- Recovery codes for two-factor.
--
-- SUPABASE AUTH DOES NOT SHIP THESE. It gives you TOTP enrolment, a challenge
-- and a verify, and nothing for the case that actually happens -- somebody's
-- phone is in a skip. Without a way back in, making two-factor mandatory for
-- superadmins would mean a lost phone is a support ticket to us and a company
-- locked out of its own data until we answer it.
--
-- WHAT A RECOVERY CODE DOES HERE, AND WHAT IT DELIBERATELY DOES NOT
--
-- It does NOT raise a session to aal2. It cannot: the assurance level is
-- Supabase's to grant and it only grants it for a real factor. Pretending
-- otherwise would mean minting our own claim of "second factor satisfied",
-- which is exactly the kind of parallel truth this codebase avoids elsewhere.
--
-- Instead, redeeming a code DELETES the authenticator, through the admin API,
-- server side. The account falls back to a password-only session -- and because
-- the policy in lib/mfa.ts requires a factor for superadmins, that person is
-- immediately sent to enrol a new one. So the sequence is: lost phone, redeem a
-- code, set up the new phone. They are never left both locked out and
-- unprotected.
--
-- HASHED, NEVER STORED IN THE CLEAR
-- bcrypt, the same as worker PINs in this schema. A leaked database must not
-- hand somebody ten ready-made bypasses of the whole feature. The consequence
-- is the usual one and is honest: we cannot show a code again after the screen
-- that generated it, and the UI says so before it lets the person move on.
--
-- ONE USE, AND THEN THE WHOLE SET DIES
-- Redeeming a code deletes the factor, so every other code in that set now
-- refers to an authenticator that no longer exists. They are cleared with it
-- rather than left sitting there looking valid. A fresh ten are issued when the
-- next factor is enrolled.

begin;

create table if not exists public.mfa_recovery_codes (
  id             uuid primary key default gen_random_uuid(),

  -- Keyed on the AUTH user, not public.users. This is a property of the
  -- authentication account: it survives a change of role, and it is the id the
  -- admin API needs to delete a factor.
  auth_user_id   uuid not null references auth.users(id) on delete cascade,

  -- bcrypt. Never the code itself.
  code_hash      text not null,

  -- Set when redeemed. Kept rather than deleted so "somebody used a recovery
  -- code on this account" stays answerable afterwards -- that is a security
  -- event and deleting the evidence of it would be the wrong instinct.
  used_at        timestamptz,

  created_at     timestamptz not null default now(),

  constraint mfa_recovery_codes_hash_present check (length(code_hash) > 0)
);

-- The only query: every live code for this account, at redemption time.
create index if not exists mfa_recovery_codes_user_idx
  on public.mfa_recovery_codes (auth_user_id)
  where used_at is null;

comment on table public.mfa_recovery_codes is
  'Single-use codes that REMOVE a user''s TOTP factor, returning them to a password-only session. They do not grant aal2. Hashed with bcrypt; redeeming one clears the rest of the set.';

alter table public.mfa_recovery_codes enable row level security;

-- No policies. Every read and write goes through the service client inside
-- /api/security/*, which is the only place that may compare a code. RLS on with
-- no policy means a leaked anon key reaches none of these hashes.

commit;
