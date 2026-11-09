# Scheme registration: worked example

One test job, taken end to end before shipping. Every value below came from a
real run on 9 November 2026.

**What this does and does not prove.** The scheme is a simulator, because no API
docs or sandbox could be found for FENSA or Certass. This proves Vantro's side
of the flow. It proves nothing about either scheme's real API.

## How to run it

```
npx playwright test --project=unit tests/unit/scheme-registration.spec.ts
```

The SQL side runs the real migration on an in-process Postgres:

```
npm i --prefix <empty-dir> @electric-sql/pglite@0.2.17
node docs/schemes/check-migration.mjs \
  <empty-dir>/node_modules/@electric-sql/pglite/dist/index.js \
  supabase/migrations/20261109103752_scheme_registration.sql
```

Results: all tests in that file passed, and 26 of 26 SQL checks passed. Postgres
ran on one connection, so the double claim was tested one call after the other.
The row lock that handles truly simultaneous calls was not exercised.

## The run on the real database

A headless browser, signed in as the Apexify admin, against a production build
pointed at the production database, on job "SIMULATED TEST scheme registration"
(`1592f677-773e-4300-bd00-7489df18d3f3`).

| Step | Result |
|---|---|
| Settings: wrong key | Refused on screen, nothing saved |
| Settings: `sim_` key | Validated, sealed, last four shown |
| Job card | Saved, with `SIM-REJECT` in the address |
| Sign-off | Job complete, registration `failed` with the reason |
| Today | Reason, "Register by 30 Nov 2026", Retry |
| Address fixed, Retry clicked | `SIM-FENSA-9FDAF4326A`, panel cleared |
| Retry and sign-off repeated | Same number, one record, one evidence hash |
| Audit Pack | Certificate section with the TEST RECORD banner |
| Homeowner | Not emailed (`skipped_simulator`) |
| Empty `SCHEME_SIM_COMPANIES` | Routes 404, nothing on Settings or Today |

The sign-off was posted to the route the Mark complete button uses. That button
only appears once a job has deliverables, and the test job has none.

## The test job

| Field | Value |
|---|---|
| Job | `22222222-2222-2222-2222-222222222222`, "14 Test Road windows" |
| Company plan | Full Suite |
| Scheme, member | FENSA, M1234 (key `sim_test_key`, sealed with AES-256-GCM) |
| Property | 14 Test Road, Belfast |
| Work | Replacement windows: 6 windows, 1 door |
| Completion date | 2 November 2026 |
| Homeowner | homeowner@example.com |

## The happy path

| Step | What happens | Result |
|---|---|---|
| 1. Job is signed off | `mark_complete` sets the status, then calls `registerJob` | Sign-off stands whatever follows |
| 2. Claim | `claim_scheme_registration` locks the row | `pending` to `registering` |
| 3. Checks | Plan, job details, availability, active connection, key opens | All pass |
| 4. Register | Simulator is called with the job id as the idempotency key | `SIM-FENSA-05D17100B3` |
| 5. Record | One `scheme_registrations` row, no homeowner name or email | Evidence hash written by trigger, event `created` |
| 6. Job updated | Number and environment saved | `registered` |
| 7. Email | Simulated, so the homeowner is not contacted | `skipped_simulator` |
| 8. Audit Pack | Certificate section with a "TEST RECORD" banner; row is in the manifest | Printed and covered |
| 9. Today | Nothing needs anyone | Panel is empty |

Sign-off again, a double tap and a stale Retry each returned `registered`. The
scheme was called **once** and there was **one** record.

## When it goes wrong

| Case | Status | Today shows | Retry |
|---|---|---|---|
| Scheme refuses (`SIM-REJECT` in the address) | `failed` | "FENSA refused this job: ...", register by 23 November 2026 | Allowed. Succeeded once the address was fixed |
| Timeout after the scheme accepted (`SIM-TIMEOUT`) | `unknown` | "Check its portal before retrying" | Refused until the admin confirms it is not on the portal |
| Process dies mid-call | `unknown` after 3 minutes | Same as above | Same as above |
| Scheme accepted, Vantro could not save | `unknown` | The number, and "Do not register it again" | Same as above |
| Details missing | `failed` | Every missing field, named. The scheme is not called | Allowed once fixed |
| Below Full Suite | `failed` | "on the Full Suite plan". The scheme is not called | Fails until upgraded |
| Signed off, never attempted | `pending` | "Registration has not run" | Allowed |
| Homeowner email fails | `registered` | "Registered, but the homeowner has not been told" | Resends the email only |

## Before any real job is registered

1. Get API docs and test credentials from FENSA, and find out whether Certass
   has an API at all. Certass may only take file uploads.
2. Confirm what comes back. It may be a job reference and not a certificate
   number.
3. Add the driver to `LIVE_DRIVERS` in `lib/schemes/driver.ts` and run this
   example against the scheme's sandbox.
4. The owner confirms. Only then set `SCHEME_MODE=live`.

Until step 3, `SCHEME_MODE=live` reaches nothing.

## Settings

| Variable | Purpose |
|---|---|
| `SCHEME_KEY_ENCRYPTION_KEY` | 32 random bytes, base64. Seals saved API keys |
| `SCHEME_SIM_COMPANIES` | Comma separated company ids. Any company not listed sees nothing of this feature, in any environment, until a live driver exists |
| `SCHEME_TEST_EMAIL` | Optional. Where simulated confirmation emails go |
| `SCHEME_MODE` | `live` is refused until a live driver exists |
