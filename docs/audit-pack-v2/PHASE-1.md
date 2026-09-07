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
| 1.1 Content hashing at write time | Code done. Migrations **applied and verified** |
| 1.2 Pack manifest and signature | Code done. Migration **applied and verified** |
| 1.3 Permanent evidence | Archive done. PDF: **decided — archive URLs** (spec deviation) |
| 1.4 Admin audit log in the pack | Done |

**All three Phase 1 migrations are applied** as of 2026-09-07:
`20260904010000_evidence_hashes`, `20260904020000_evidence_append_only`,
`20260904030000_audit_packs_manifest`. `supabase migration list --linked`
shows a non-empty `remote` for each, alongside `20260904000000_jobs_completed_by`.

The earlier "not applied" reading was correct at the time and had a single
cause, now fixed: `.env.local` began with four lines of pasted prose (a
`notepad ...` line, two ``` fences and "Paste this in, save it, leave it
open:"), so the CLI aborted while parsing the env file and never reached the
database. Every `db push` and every `to_regclass` check failed for that reason
rather than because the schema was missing. With those lines removed the CLI
connects and the migrations were already there.

Schema verified directly against the linked project, not inferred from the
migration list:

| Check | Result |
|-------|--------|
| `evidence_hashes` / `audit_packs` exist | both |
| Expected columns on each | none missing |
| RLS enabled, zero policies on `evidence_hashes` | `t`, 0 |
| `record_evidence_hash`, `record_location_batch_hash`, `enforce_evidence_immutability`, `record_evidence_amendment` | all present |
| Capture/amendment triggers | 16 across 8 tables |
| Immutability triggers | 8 (`defects`, `diary_entries`, `expenses`, `location_logs`, `qa_submissions`, `signins`, `variations`, `walkthroughs`) |
| `evidence_hashes` rows | 528, all `event='backfill'` |
| Malformed `sha256` | 0 |
| Orphaned amendments / amendments duplicating superseded hash | 0 / 0 |
| Closed sign-ins with no batch hash | 0 |
| `row_count` disagreeing with its trail | 0 |
| `audit_packs` rows | 0 (no pack generated yet) |

So the backfill ran, every hash is well-formed, and no ping falls outside the
scheme. **Packs will now register**; §6 should print the integrity claim rather
than the amber "not registered" block. That transition is the thing to confirm
first in runtime verification — it has not been observed yet, because no pack
has been generated since the migrations landed.

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
6. No server-side PDF — archive URLs instead, the spec's non-preferred branch.
   Decided 2026-09-07; reasoning in 1.3.
7. The archive is durable by convention, not by permission — the write-once
   bucket policy the spec asks for is infrastructure that does not exist yet.

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

## 1.2 Pack manifest and signature

Replaces the browser-computed SHA-256 in `AuditTab.tsx` entirely. That hash is
deleted, along with its dead state.

Both producers register a pack: `/api/audit/v2` (Compliance and the in-app
views) and `/api/audit/report` (client HTML and share links). The report used to
mint its own reference — `VTR-<jobname>-<8 digits of Date.now()>` — which was
never stored and resolvable by nothing. It now prints the registered reference.

Choices worth stating, because each is somewhere Merkle work commonly goes
wrong:

- **Leaves bind identity to content**, not content alone: entity type, subject,
  event, hash. Otherwise two rows with identical payloads collapse into one
  leaf, and a hash re-pointed at another entity goes unnoticed.
- **Leaves are sorted before pairing.** A root that depends on the order
  Postgres happened to return rows in is not reproducible.
- **An odd node is promoted, never duplicated.** Duplicating is the
  CVE-2012-2459 shape, where two different leaf sets yield one root.
- **Canonical JSON sorts keys.** A signature over a manifest re-serialised from
  `jsonb` has to reproduce byte for byte.
- **`/verify` runs three independent checks**, not one: signature over the
  manifest, stored root against the manifest's own, and the root recomputed from
  the evidence rows. They fail differently — the third is the one that catches
  evidence altered *after* the pack was issued.
- **Amendment hashes are included**, not filtered out. Hiding superseded rows
  would hide exactly the corrections 1.1 exists to make visible.
- **Nothing here can fail a pack.** No signing key yields an unsigned pack that
  says so; a failed registration yields a pack that says its reference will not
  resolve. Refusing to render because the integrity layer had a bad day is worse
  than rendering and being honest.

`/verify` returns nothing about the job, site, people or company. A pack
reference travels in insurers' files and assessors' reports, and checking one
must not leak what it was for. Rate limited by IP, shape-checked before it
touches the database.

### `audit_packs` was not a new table

The spec calls it new. It already existed, holding `ai_audit_used`,
`exec_summary`, `red_flags` plus seven columns that are exactly what the spec
asks for, under the same names. Extended rather than replaced — a rival table
would leave two registers of generated packs and the older would rot.

The three extra columns are **kept**. Nothing in the app reads them, but
`audit_packs_job_id_idx` shows 116 index scans, so something reads this table
that a repo grep cannot see. `audit_report_log` is a second, entirely unused
table with a `report_ref` column covering similar ground; left alone, and worth
a deliberate decision rather than a passing one.

### Key provisioning

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

---

## 1.3 Permanent evidence

Every file a pack references is copied server side into

```
audit-archive/<companyId>/<packRef>/<sha256>.<ext>
```

named by the hash of its own bytes, so the filename *is* the integrity claim:
fetch it, hash it, compare to the name. No index to consult, nothing to trust.
R2 `CopyObject` does this without the bytes passing through the process, and a
name that already exists is byte-identical by construction, so it is skipped.

The report then swaps its expiring signed URLs for the archived copies — in one
place, over the shared data, rather than at each point a photo is drawn. A file
whose copy failed keeps its signed URL: it expires, but it works today, which
beats a permanent-looking link to an object that was never written. Failures are
counted onto the pack row.

**Fixed here:** a share link minted a new pack reference on every view, so a
client refreshing the page would see a reference that no longer matched the one
in the email they were sent. A share is one issued pack — the first view fixes
it, later views reuse it. Evidence added afterwards is deliberately not folded
in, because a pack is a claim about a point in time.

### Two things 1.3 does not do

**1. The archive is not write-once yet.** The spec asks for a bucket with no
delete policy for any app role. That is infrastructure, not code: a separate R2
bucket with a scoped token lacking `DeleteObject`, or an object-lock policy on
the prefix. The code writes to `CLOUDFLARE_R2_ARCHIVE_BUCKET` when set and falls
back to the main bucket. **Until that token exists the application can delete
what it just archived, and the archive is durable by convention, not by
permission. Do not describe it as write-once to a customer.**

**2. No server-side PDF.** The spec offers "archive URLs that do not expire, or
(preferred) a PDF generated server side with images embedded". This takes the
first branch. The preferred branch means headless Chromium on Vercel
(`puppeteer-core` + `@sparticuz/chromium`), which is the single most likely
thing to turn the preview red — and `npm run build` cannot be run on this
machine at all, so it would be taken blind at the end of a phase that is already
entirely unverified. That is not the safe choice.

**Decided 2026-09-07: stay on archive URLs.** Neither renderer is being added.
Chromium would be taken blind, and `@react-pdf/renderer` buys a second renderer
that every future change to the report has to land in twice — drift between the
PDF and the HTML pack would be silent, which is the wrong failure mode for a
document that exists to be trusted. Phase 1 closes on the first branch. This
stays a **recorded deviation from the spec**, not a closed item: the spec's
preferred branch has not been built, and a customer asking for a PDF should be
told the pack is archive URLs.

---

## 1.4 Administrative actions appendix

Fetched in the shared data layer behind `includeAdminLog`, so the Compliance
view and the client HTML cannot drift. Scoped by the entities the job owns, not
just by company, so a busy tenant's log cannot leak another job's activity.

Filtered by denylist, for the same reason the hash payloads are — an allowlist
of "evidential actions" silently drops any action added later.

Where the log is empty both surfaces say so **and say what that does not mean**:
nothing was logged, not that nothing happened. `audit_log` records what the
application chooses to record and is not an account of database access. An empty
table with no caption reads as proof of no activity, which it is not.

---

## Trigger behaviour, verified against live data

Run 2026-09-07 against the linked project, inside a `DO` block ending in an
uncaught `raise` so every probe write was rolled back by construction rather
than by remembering to. Confirmed afterwards: 528 evidence rows unchanged, zero
`amended` rows, probed row uncontaminated. Subject was one `diary_entries` row.

| Probe | Expected | Result |
|-------|----------|--------|
| `update diary_entries set company_id = ...` | refused | raised `23000` — `evidence integrity: diary_entries.company_id is immutable` |
| `update ... set ai_summary = ...` (denylisted) | no amendment | evidence rows 1 → 1, no-op |
| `update ... set entry_text = ...` (evidential) | chained amendment | rows 1 → 2, `event=amended`, `supersedes_id` = prior hash, `ca750e8c` → `a8f1823d` |

This closes the part of runtime verification that can be closed without
generating a pack: the capture, denylist and amendment-chaining logic all fire
correctly on real rows. The denylist result is the one worth keeping — it is the
check that an approval or an AI re-run does not forge an amendment, and it is
the one that silently rots if the two denylists in `20260904010000` and
`20260904020000` ever drift apart.

Still unobserved: `record_location_batch_hash` at sign-out, file hashing via
`lib/evidence.ts`, and everything downstream of a generated pack.

---

## Needs a human

1. ~~Push `20260904030000_audit_packs_manifest.sql`.~~ **Done** — all three
   Phase 1 migrations are applied and schema-verified; see Status.
2. ~~`.env.local` has four lines of pasted prose at the top.~~ **Fixed**
   2026-09-07 — there were five (the blank line between the fences too). The
   file now starts at `NEXT_PUBLIC_SUPABASE_URL=` and the CLI parses it. A
   timestamped `.env.local.bak.*` copy of the original is in the repo root,
   gitignored; delete it once you are happy.
3. ~~The one open decision: server-side PDF.~~ **Decided** 2026-09-07 — staying
   on archive URLs, recorded as a spec deviation in 1.3.
4. **Generate one pack.** This is the only outstanding verification and it
   cannot be done from SQL. Confirm, in order: the pack registers and returns a
   reference; §6 prints the integrity claim rather than the amber "not
   registered" block; `/verify <ref>` passes all three checks; and
   `audit_packs.archive_failed_count` is 0.
5. **The archive is not write-once.** `CLOUDFLARE_R2_ARCHIVE_BUCKET` with a
   token lacking `DeleteObject` is infrastructure work that has not been done.
   Until it is, do not describe the archive as write-once to a customer.
6. **`AUDIT_SIGNING_KEY` has one copy**, in Vercel. Lose it and every signature
   already issued becomes unverifiable. `vercel env pull` is the backup.
