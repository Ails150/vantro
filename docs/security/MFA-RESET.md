# Clearing two-factor for a locked-out administrator

What to do when somebody cannot get past `/security/verify`.

This is a runbook for a real emergency — an owner locked out of their own
company's data — so it is written to be followed under pressure by somebody who
has not read it before.

---

## First: are they actually locked out?

Work down this list before touching the database. Three of the four cases below
need no intervention at all.

| Symptom | Fix |
|---|---|
| Has the phone, code is rejected | Phone clock drift. TOTP is time-based; ask them to enable automatic time on the phone and try again |
| Has the phone, wrong account | Authenticator apps show several entries. The Vantro one is labelled `Vantro` |
| Lost the phone, **has** recovery codes | `/security/verify` → "Lost your phone? Use a recovery code". No admin action needed |
| Lost the phone, **no** recovery codes | Continue below |

Only the last row needs this document.

---

## What "clearing two-factor" actually does

It deletes the TOTP factor from the Supabase auth account. Afterwards:

- They sign in with their password alone and reach `aal1`.
- `lib/mfa.ts` sees a superadmin or support user with no factor and sends them
  to `/security/enrol`.
- They set up the new phone and get a fresh set of ten recovery codes.

So this does **not** leave the account unprotected. It puts them back at the
front of the enrolment flow. An ordinary admin — for whom the factor was
optional — simply continues without one until they choose to set it up again.

---

## Do this first: confirm who you are talking to

Removing a second factor on the word of whoever is on the phone defeats the
entire feature. An attacker with a stolen password calling support and asking
for 2FA to be cleared is the most likely way this gets abused, and it is easier
than breaking the cryptography by an enormous margin.

Before touching anything, confirm **at least two** of:

- A call back to a phone number already on file for that company, not one
  supplied during this conversation.
- A second administrator on the same company vouching, contacted independently.
- Details only that person would hold: recent job names, the company's billing
  email, when they last signed in.

Write down what you verified and who authorised it. There is a place for it in
step 4.

---

## Procedure

### 1. Find the auth user

Supabase dashboard → **Authentication** → **Users**, and search the email.

Copy the **User UID**. Everything below keys on it.

If the email is not there, the account is not a Supabase auth user — field
workers sign in with a PIN and a field token and have no second factor to clear.
Check `public.users.role` before going further.

### 2. Delete the factor

Supabase dashboard → **Authentication** → **Users** → click the user.

The **Multi-Factor Authentication** panel on the user detail page lists enrolled
factors. Use **Remove** / the delete control next to the TOTP factor.

If the dashboard build in use does not expose that panel, do the same thing
through the Admin API from a trusted machine. **Never paste the service role key
into a shared terminal, a chat, or a support ticket.**

```bash
# List factors
curl -s -X GET \
  "$SUPABASE_URL/auth/v1/admin/users/$USER_UID/factors" \
  -H "apikey: $SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY"

# Delete the one you found
curl -s -X DELETE \
  "$SUPABASE_URL/auth/v1/admin/users/$USER_UID/factors/$FACTOR_ID" \
  -H "apikey: $SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY"
```

### 3. Clear the stale recovery codes

The codes in `public.mfa_recovery_codes` referred to the factor you just
deleted. Leaving them would leave ten valid-looking keys to a door that has been
rehung, and a fresh set is issued on re-enrolment anyway.

SQL editor:

```sql
delete from public.mfa_recovery_codes
where auth_user_id = '<USER_UID>'
  and used_at is null;
```

Rows with `used_at` set are deliberately **kept**. "Somebody redeemed a recovery
code on this account" is a security event and deleting the record of it is the
wrong instinct.

### 4. Record it

Write down, wherever your support tickets or incident notes live:

- The date and time, and the User UID.
- **What you used to verify identity** — the specific thing, not "confirmed
  identity". "Called the office number on file and spoke to X" is a record;
  "verified" is not.
- Who authorised it.
- That the factor and the unused recovery codes were both removed.

There is deliberately no SQL here. This repository has no table whose purpose is
security-incident notes — `audit_report_log` exists but is unused and undocumented,
and a runbook followed under pressure must not contain a command that might fail
on a column that is not there. If a home for these notes is added later, put it
here and replace this paragraph.

### 5. Tell them what happens next

> Two-factor has been cleared. Sign in with your password as normal and you will
> be asked to set it up again straight away. Have the new phone with you. You
> will be shown ten recovery codes at the end — save them this time, because
> that screen is the only place they ever appear.

---

## Verifying it worked

Ask them to sign in. They should land on `/security/enrol` rather than
`/security/verify`. If they still see the code prompt, the factor did not
delete — re-check step 2 against the correct User UID.

---

## The case with no way out

If the **only** superadmin on the platform is locked out and no second
administrator exists, steps 1–2 still work: they are performed with the Supabase
service role, which is independent of any user's session. There is no state in
which the database becomes unreachable because of this feature.

The genuine single point of failure is access to the Supabase project itself.
That is protected by the Supabase account's own 2FA, which is **not** managed by
anything in this repository. Make sure more than one person can get into the
Supabase organisation.

---

## Why there is no "reset my own 2FA" button

There cannot be one. Anything reachable with only a password would reduce the
second factor to a suggestion — an attacker holding the password would click it.
The recovery codes are the self-service path, and they work precisely because
they are a second secret held somewhere other than the phone. Everything in this
document exists for the case where that second secret was not saved.

## Related

- `lib/mfa.ts` — the policy: who must have a factor and who must use one
- `lib/supabase/middleware.ts` — step-up enforcement, and why it fails open
- `app/api/security/recovery/route.ts` — what redeeming a code actually does
- `supabase/migrations/20260916090000_mfa_recovery_codes.sql` — the schema and
  the reasoning behind hashing and single use
