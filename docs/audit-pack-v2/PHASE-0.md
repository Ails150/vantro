# Phase 0 — Fix what is broken

Branch: `audit-pack-v2-phase-0` (8 commits, one per spec item, off `master` at
15cca75, plus three follow-ups). Pushed to `origin`; a Vercel **preview** is
built from it. Not merged, not in production.

Spec: `docs/VANTRO_AUDIT_PACK_V2_SPEC.md`. Note the spec lives at that path, not
`docs/audit-pack-v2/SPEC.md`. This summary is written to the path the spec's own
definition of done names (`docs/audit-pack-v2/PHASE-N.md`), so the two now
disagree. Moving the spec into `docs/audit-pack-v2/` would settle it — not done
here, as it is your file.

---

## Build status — read this first

**Vercel builds this branch green.** Preview
`dpl_ERH96hi7fE5Zu6mTmeGSUbisEXVp`, target preview, status Ready, 355 output
items, from commit `656b12d`. Alias:
`https://vantro-git-audit-pack-v2-phase-0-ails150s-projects.vercel.app`.

So the local failure below is **environment only** — a Windows/babel-loader
crash on this machine, not a defect in the repo or in Phase 0. CI is the
authority; the local `npm run build` is not.

<details>
<summary>The local crash, for the record</summary>

`npm run build` fails on this machine at `master`, before any Phase 0 change:

```
Error: Node.js subprocess crashed while evaluating loaders [next/dist/build/babel/loader]
Node.js process exited with exit code: 0xc0000409     (stack buffer overrun)
Import traces: ./components/admin/UpgradeAIAuditPack.tsx -> AuditTab -> AdminDashboard -> app/admin/page.tsx
```

Reproduced twice at baseline.
</details>

The per-commit gate was therefore
`NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit` — clean at baseline
and after every commit. (The raised heap is required; plain `npx tsc --noEmit`
dies with a V8 OOM on this repo.)

**A green build is not runtime verification, and that distinction cost us
once already.** `tsc` and the Vercel build both passed while 0.8 carried a
select that would have failed on every request — see "The `completed_by`
near miss" below. The pack has still never been generated against real data.

---

## What changed, file by file

### `lib/audit/data.ts` — the shared data layer (0.8)

Now the single producer for every audit surface.

- New optional 6th argument `options: FetchAuditDataOptions`
  (`signedUrlTtl`, `includeWalkthroughs`, `walkthroughView`). The existing
  positional call in the report route is untouched and behaves identically.
- `signOne` / `signMany` take a TTL argument, defaulting to 1 hour. v2 passes
  24 hours, so both producers keep the media URL lifetime they had.
- `MAPS_KEY` now falls back across `GOOGLE_MAPS_STATIC_KEY` →
  `GOOGLE_MAPS_API_KEY` → `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`. The two producers
  had been written against different env var names, so whether a map existed
  depended on which route you came through. Map styling is now the report
  route's (zoom 17, scale 2, teal marker, 320x200); v2's old styling (zoom 16,
  red, 400x200) is gone.
- Job select: briefly an explicit column list, now back to `select("*")` —
  see "The `completed_by` near miss" below for why that is deliberate.
- Company select gains `ai_audit_trial_ends_at`, `geofence_radius_metres`.
- QA select gains `template_id`, `reviewed_by`, `reviewed_at`. The layer now
  also resolves `checklist_templates` (name) and `reviewed_by_name`.
  `reviewed_by` is a second FK to `users`, so the `users!user_id` embed cannot
  reach it — it needs the separate lookup.
- `checklist_items` select gains `template_id`, `sort_order`.
- Walkthroughs: queried only when `includeWalkthroughs` is set, with
  `walkthroughView` deciding approved-only (client/external) vs
  processing-ready (internal). `AuditData.walkthroughs` is `[]` otherwise, so
  the client HTML report runs no extra query until 3.6 renders them.

### `app/api/audit/v2/route.ts`

- 0.1: sign-in select gains `sign_out_distance_metres` (via the shared layer).
- 0.6: selects the company geofence radius, calls
  `resolveGeofenceRadius(job, company)` from `lib/geofence-server`, returns it
  as `onSite.geofenceRadiusMetres`.
- 0.8: local `staticMapUrl` / `signOne` / `signMany` deleted. Six query blocks
  replaced by one `fetchAuditData` call. Deliverables, sign-off register,
  on-site stats, the AI-cache fingerprint and the 14-day timeline all derive
  from the shared arrays. `fullEvidence` now also carries `defects`.
- Net: 557 → ~430 lines.

### `app/api/audit/route.ts` — **deleted** (0.8)

v1. Its only consumer was the Full Evidence accordion. Nothing else in the repo
fetched `/api/audit`.

### `components/admin/AuditTab.tsx`

- 0.1: Compliance §2 "Dist In" reads `distance_from_site_metres`, not the
  v1-only `distance_metres` alias, which never reached this view. Both distance
  columns had rendered "—" on every row.
- 0.2: §3 "Approver" / "Approved at" read `signedOffBy` / `signedOffAt` to match
  what v2 emits. Both had rendered "—" on every item.
- 0.3: new §3.\<n+1\> **Sign-off register** — deliverable, item, who, when, from
  the `signoffs` array that every view had been using only as a count. Numbered
  after the per-deliverable blocks so §4–§6 keep their numbers.
- 0.4: `refreshAI()` sends `regenerate: true`. It previously re-POSTed without
  it, took the `audit_ai_cache` hit path, and returned the identical summary —
  the button was a no-op whenever the fingerprint still matched.
- 0.5: the 96-line dead Client view behind `{false && (...)}` deleted. Walk &
  Talks caption no longer claims approved walkthroughs "appear in client and
  compliance audit reports" — they appear in neither; it now states Internal
  only, and points at 3.6.
- 0.6: sworn statement prints `onSite.geofenceRadiusMetres` instead of a
  hardcoded 150m. See the note below — the sentence changed further.
- 0.7: a **Sign-in location** map column was added to §2, then reverted (see
  0.7 below). No map is rendered per view. `staticMapUrl` and the
  `map_in_url` / `map_out_url` fields stay in the shared data layer, which is
  where 1.3 will archive them once per pack.
- 0.8: `report` state and the v1 fetch removed; `generate()` makes one request.
  Full Evidence reads `reportV2.onSite.fullLog` / `fullEvidence.qa` /
  `fullEvidence.diary`.

---

## Two judgement calls made inside Phase 0

**1. The sworn statement lost a claim, not just a number (0.6).**
It read: "All sign-in/out times are recorded with GPS coordinates within 150m of
the registered job site." Swapping 150 for the real radius would have left a
claim the data contradicts — `geofenceCompliance` is routinely below 100%, and
out-of-range sign-ins exist by design. It now reads: events are measured against
this job's geofence radius of Xm, and the proportion inside it is stated in
section 2. Fully computed prose is 1.2's job; this is the smallest change that
stops the pack swearing to something false.

**2. The Full Evidence QA counter was silently wrong (0.8).**
It counted `q.result === "pass"` — the v1 alias for `state`. Real states are
`approved` / `rejected` / `submitted` / `pass` / `fail` / `na`, so every
approved item counted as neither pass nor fail. Repointing it at v2 meant
choosing a counting rule; it now matches the HTML report
(`approved || pass`, `rejected || fail`). This changes numbers a user sees.

---

## The `completed_by` near miss

0.8 replaced v2's `select("*")` on `jobs` with an explicit column list, and put
`completed_by` in it — the field the existing `finalSignoff` code reads.

**`jobs.completed_by` does not exist.**
`migrations/20260901_baseline_existing_tables.sql` was generated from the
project's own PostgREST OpenAPI description with the service role key on
2026-09-01, which is authoritative for column names, and lists every `jobs`
column. `completed_by` is not among them. The three columns flagged as risky in
the first draft of this document — `site_id`, `gps_source`,
`distance_from_site_km` — are all present. The danger was somewhere else.

PostgREST rejects the **whole** select on one unknown column, so
`fetchAuditData` would have returned null and every audit surface — all four
in-app views and the client share link — would have answered "Job not found".
Under `select("*")` the field was merely `undefined`, which is why it had never
surfaced. Fixed in `c517aea` by returning to `select("*")` for jobs, with a
comment recording why that is deliberate rather than lazy.

Two things this exposed that are **not fixed**, because they are outside Phase 0:

- **`mark_complete` is broken in production.** `app/api/audit/v2/action/route.ts`
  writes `completed_by: userId`. That write fails against the live schema, so
  the "Mark complete" button in the actions panel returns a 500.
- **`finalSignoff.by` has always been null.** The Compliance §1 "Final sign-off"
  row can therefore only ever say Completed/Pending, never who completed it.

Both need the same decision: add `completed_by uuid references users(id)` to
`jobs`, or drop the write and the lookup. Adding the column fixes both and is
what the code clearly intends.

**Resolved on 2026-09-04.** `supabase/migrations/20260904000000_jobs_completed_by.sql`
adds the column and was applied to the linked project (`vantro-dev`,
`lmobuqxmtkctqqwbspoz`) with `supabase db push`. Verified against the live
schema: `completed_by` is present and nullable, with FK `jobs_completed_by_fkey`
to `users(id)`. No code change was needed -- `mark_complete`'s write and the
`finalSignoff` lookup were already written against this shape. Existing
completed jobs keep `completed_by` null; there was nowhere to backfill from, so
only jobs completed after this deploy will name a person. `lib/audit/data.ts`
stays on `select("*")` -- the column existing removes this instance of drift,
not the class of it.

The general lesson, worth carrying into Phase 1: an explicit select over a table
whose schema is not in version control converts silent drift into total
failure. Five of these tables (`sites`, `job_visits`, `visit_assignments`,
`signins`, `jobs`) were created by hand in the Supabase editor and only
back-documented on 2026-09-01.

---

## Needs a human

1. **Runtime verification before merge — still outstanding.** Nothing here has
   been generated against real data. Attempted and blocked:
   - the browser test could not run: the Claude Chrome extension is not
     connected, and the preview sits behind Vercel SSO;
   - a direct read-only schema probe against Supabase was blocked by the
     permission classifier (it reads `SUPABASE_SERVICE_ROLE_KEY` from
     `.env.local` and queries production). The probe script is still at
     `<scratchpad>/probe.mjs` and needs one approval to run.

   Remaining risks, all invisible to `tsc` and to a green build:
   - `checklist_templates`, `reviewed_by`, `reviewed_at` on `qa_submissions`
     (each was already selected explicitly pre-0.8, so these are low risk);
   - walkthroughs resolving through the shared layer's embed syntax;
   - the `companies` select's `ai_audit_trial_ends_at` and
     `geofence_radius_metres` (both selected explicitly elsewhere in the repo,
     so also low risk).

2. **Map styling is now the report route's.** v2's red-marker 400×200 maps are
   gone in favour of the teal 320×200 ones. Cosmetic, and nobody had seen
   either since neither was ever rendered — flagging it only because it is a
   silent choice that 1.3 will bake into the archive.

3. **Spec vs summary path** — see the note at the top.

---

## Not touched (correctly out of Phase 0 scope)

The browser-side `crypto.subtle` chain-of-custody digest and the section 6 prose
are untouched; both are 1.2's. Walkthroughs are still absent from the client and
compliance packs — 0.5 only corrected the copy that claimed otherwise; 3.6 makes
it true. Variations remain in the client HTML only.

---

## Commits

```
e0042c2  fix(audit): render real sign-in distances in Compliance view          0.1
101fb27  fix(audit): align Compliance approver fields with v2 payload          0.2
f37550a  feat(audit): render the sign-off register in the Compliance view      0.3
21852e4  fix(audit): make "Refresh AI" actually regenerate                     0.4
aa6411a  chore(audit): delete the dead Client view, correct walkthrough copy   0.5
56ec9d1  fix(audit): sworn statement reads the job's real geofence radius      0.6
2b4cb4b  feat(audit): render sign-in location maps in the Compliance view      0.7
a73ff32  refactor(audit): one data layer for every audit producer, delete v1   0.8
1985f1a  docs(audit): Phase 0 summary
656b12d  Revert "feat(audit): render sign-in location maps..."             (0.7 undone)
c517aea  fix(audit): don't let one missing job column kill every pack      (0.8 followup)
```

### 0.7 revisited

The spec's decision for 0.7 was "render, small, one per shift, in the Compliance
view only", and `2b4cb4b` did that. It was then **reverted**: rendering per view
meant one Google Static Maps request per shift every time the tab opened,
uncached and billed, which is the wrong place to spend it. Maps are generated at
pack generation only and archived once per pack in 1.3.

What that leaves: `staticMapUrl` and the per-sign-in `map_in_url` /
`map_out_url` fields remain in `lib/audit/data.ts`, still computed on every
fetch and still rendered nowhere — the state 0.7 originally set out to fix. That
is deliberate for now, and 1.3 is what closes it. If 1.3 slips, this is again
dead computation.

Phase 1 not started, per instruction.
