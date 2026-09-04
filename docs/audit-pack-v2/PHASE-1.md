# Phase 1 — Evidence integrity

Branch: `audit-pack-v2-phase-0`, continuing from Phase 0. One commit per item.
Gate before every commit: `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit`
(clean). `npm run build` still crashes on this machine only; Vercel is the
authority — see PHASE-0.md.

Spec: `docs/audit-pack-v2/SPEC.md`. It had never been committed — it sat at
`docs/VANTRO_AUDIT_PACK_V2_SPEC.md`, untracked, so the branch did not carry the
document it is built from. Moved and committed on 2026-09-04 at your request.

---

## Status

| Item | State |
|------|-------|
| 1.1 Content hashing at write time | Written, **not applied** — needs `db push` |
| 1.2 Pack manifest and signature | Not started; signing key is provisioned |
| 1.3 Permanent evidence | Not started |
| 1.4 Admin audit log in the pack | Not started |

---

## 1.1 Content hashing at write time

Three migrations and one library, across two commits.

- `supabase/migrations/20260904010000_evidence_hashes.sql` — the table, the
  capture triggers, the backfill.
- `supabase/migrations/20260904020000_evidence_append_only.sql` — immutability,
  write-once, and amendment recording.
- `lib/evidence.ts`, wired into `app/api/upload/route.ts` and
  `app/api/expenses/route.ts` — file-byte hashes.

### What replaces what

The Compliance view computes a SHA-256 in the browser
(`components/admin/AuditTab.tsx`), over a summary object built from the report
response. It is computed after the fact, from data the server just sent, by code
the reader cannot trust, over a shape that changes whenever the report changes.
It proves nothing. 1.2 deletes it. Until then it is still on screen and still
means nothing.

### Decisions, and why the safe one was taken

**GPS trail is hashed per sign-in, not per ping.** Your call. `location_logs` is
the highest-volume table in the schema and a hash per ping would roughly double
the cost of the hottest write path, for evidence nobody reads a single row of.
Recorded in the migration: a single ping cannot be proved in isolation, pings on
an open sign-in are unhashed until it closes, and a ping written after sign-out
falls outside the batch. The ping count sits inside the hashed payload *and* in
`row_count`, so a truncated trail has to defeat both.

Batching left one gap and it is closed: `location_logs.signin_id` is nullable,
so an orphan ping would be covered by nothing. Those, and only those, keep a
per-row hash.

**Denylist, not allowlist.** An allowlist stops covering any column added later.
A column that exists in the database but in nobody's list is exactly the failure
that took the pack down in Phase 0. A new column is evidence until someone
decides otherwise.

Three kinds of field are excluded: notification bookkeeping; AI-derived fields
(so a model re-run does not read as tampering); and workflow state written after
capture — review, approval, resolution, payment. The last group is not
unaudited: `audit_log` records who did them and 1.4 puts that in the pack.

**Backfilled rows are marked, not disguised.** Every pre-existing row was hashed
as `event = 'backfill'` with `hashed_at = now()`, deliberately not the row's own
`created_at`, which would be a lie about when the hash was taken. A backfill hash
proves no change since 2026-09-04, **not** since capture. The pack must never
present the two as equivalent. Only `event = 'created'` is capture-time evidence.

**Append-only is enforced in three classes, not as a blanket reject.** The
literal reading — reject every UPDATE to an evidential field — breaks three live
paths, inventoried before writing the trigger:

- `app/api/payroll/edit/route.ts` corrects a timesheet (`signed_in_at`,
  `signed_out_at`), already guarded against edits after payroll export;
- `app/api/qa/route.ts` rewrites a QA item on resubmit;
- `app/api/walkthroughs/upload-clip/route.ts` fills `duration_seconds` after
  processing.

A hard reject would not stop those corrections. It would move them into the SQL
editor, where nothing records them at all — strictly worse evidence than we have
now. So:

| Class | Fields | Behaviour |
|---|---|---|
| Immutable | `id`, `company_id` everywhere; all of `location_logs` | UPDATE raises |
| Write-once | sign-out capture fields; expense `receipt_url` / `receipt_mime` / `submitted_at` | null → value allowed, rewrite raises |
| Amended | everything else hashed | allowed, appends `event='amended'` chained by `supersedes_id` |

`signed_out_at` is deliberately **not** write-once — payroll edit must be able to
correct it. `location_logs` is immutable in full because nothing in the codebase
updates a ping.

The amendment trigger recomputes the payload under the same denylist and writes
only if it actually changed, so an approval, review, payment or AI re-run is a
no-op. Only a real change to evidence leaves a mark.

**DELETE is untouched, on purpose.** `app/api/jobs/delete`, `app/api/cleanup`
(GDPR retention on `location_logs`) and `app/api/account/delete` all remove these
rows. Blocking deletion would break data-subject erasure, which is a legal
obligation and outranks an audit convention. Append-only here means *no silent
modification*; deletion is a separate concern and is not solved by this phase.

**File hashes are best-effort, and weaker than the row hashes.** A trigger cannot
see file bytes — by the time a `photo_url` reaches Postgres it is a string, and
hashing a URL proves nothing about the image. `app/api/upload/route.ts` is the
single handler behind every QA, diary and defect photo and video, so the hash is
taken there, after the put, so it never claims a file that was not stored.
`app/api/expenses/route.ts` already computed the identical hash for idempotency
and discarded it; it is now kept.

If the hash write fails the upload still succeeds. The bytes are already in R2;
failing the request would force a re-upload and orphan the object, and breaking
photo capture in the field to write a log row is the wrong trade. The miss is
logged with the path so an unhashed file is findable. **This is application code,
not a trigger — it can be bypassed in a way the row hashes cannot, and the pack
should not describe the two as equally strong.**

File hashes are keyed by `storage_path`, not `entity_id`: the photo is uploaded
before the row referencing it exists. `entity_id` is nullable with a check that
one of the two is present. The link is made from the other side — the row stores
`photo_path`, and that row's own hash covers it.

**RLS: enabled with no policies.** The spec's definition of done asks for
"superadmin included in role arrays". `evidence_hashes` instead follows the
`audit_credits` convention: RLS on, no policies at all, so only the service role
reaches it. That is strictly more restrictive than the spec asks and no server
route loses access. Deliberate.

### Deviations from the spec, in one place

1. `location_logs` hashed in batch per sign-in rather than per row (your call).
2. Append-only implemented as immutable / write-once / amended rather than a
   blanket UPDATE reject (would break three live paths).
3. DELETE not restricted (would break GDPR erasure).
4. `evidence_hashes` has `event`, `row_count`, `storage_path` and a nullable
   `entity_id`, which the spec's column list does not mention. Each is load-
   bearing: two capture moments per sign-in, batch size binding, file hashing,
   and files having no entity at hash time.
5. RLS with no policies rather than superadmin role arrays (stricter).

### Bugs found and fixed on the way

**`geofence-exit` has never written its breadcrumb.** `app/api/installer/
geofence-exit/route.ts` inserted the exit ping without `job_id`, which is NOT
NULL on `location_logs`, so every call failed on a not-null violation — inside a
bare `catch {}` that discarded the error. There is no geofence exit breadcrumb
anywhere in the table. `signin_id` was missing too, which would have left every
exit ping outside the batch. Now inserted *before* the sign-in is closed (closing
it seals the trail into one hash), with both columns, still best-effort but with
the failure logged.

That is the second silent write-failure of the same shape in two days, after
`jobs.completed_by`. Both were invisible to `tsc` and to a green build.

---

## 1.2 Pack manifest and signature — key provisioning

Done ahead of the work, since it needed a credential:

- Ed25519 keypair generated locally with `crypto.generateKeyPairSync`.
- Private key stored as base64 PKCS8 DER in `AUDIT_SIGNING_KEY`, set as a
  **Secret** in Vercel **Production** and **Preview**. Never written to the repo;
  the local copy was deleted after upload.
- Public key (SPKI DER, base64), safe to publish:

  ```
  MCowBQYDK2VwAyEAjMK+8FK6/PfzFw7HHyPuIems86zsceScWpRIfOvqAbg=
  ```

The public key is derivable from the private key at runtime, so it is not stored
as a second env var — one source of truth, no drift. `/verify` will publish it.

**If `AUDIT_SIGNING_KEY` is ever lost, every signature already issued becomes
unverifiable.** Vercel is the only copy. It is recoverable via `vercel env pull`
by a project owner; treat that as the backup and do not rotate casually.

---

## Needs a human

1. **Push the migrations.** `20260904010000` and `20260904020000` are committed
   and unapplied. Nothing downstream can be verified until they land.
2. **`.env.local` still has four lines of pasted prose at the top**, which makes
   the Supabase CLI refuse to parse it. Delete the `notepad ...` line, both
   fences and the "Paste this in" line, leaving the file starting at
   `NEXT_PUBLIC_SUPABASE_URL=`.
3. **Runtime verification is still outstanding**, exactly as at the end of
   Phase 0. Nothing in 1.1 has run against real data.
