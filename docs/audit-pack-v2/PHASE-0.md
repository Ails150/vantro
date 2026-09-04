# Phase 0 — Fix what is broken

Branch: `audit-pack-v2-phase-0` (8 commits, one per spec item, off `master` at 15cca75).
Not deployed. Not merged.

Spec: `docs/VANTRO_AUDIT_PACK_V2_SPEC.md`. Note the spec lives at that path, not
`docs/audit-pack-v2/SPEC.md`. This summary is written to the path the spec's own
definition of done names (`docs/audit-pack-v2/PHASE-N.md`), so the two now
disagree. Moving the spec into `docs/audit-pack-v2/` would settle it — not done
here, as it is your file.

---

## Build status — read this first

`npm run build` **fails on this repo at `master`, before any Phase 0 change**.
It is not something Phase 0 introduced and not something Phase 0 fixes:

```
Error: Node.js subprocess crashed while evaluating loaders [next/dist/build/babel/loader]
Node.js process exited with exit code: 0xc0000409     (stack buffer overrun)
Import traces: ./components/admin/UpgradeAIAuditPack.tsx -> AuditTab -> AdminDashboard -> app/admin/page.tsx
```

Reproduced twice at baseline. So the spec's "build passes after every commit"
could not be honoured literally. The gate used instead, after every commit:

```
NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit
```

Clean at baseline and clean after all 8 commits. (The raised heap is required —
plain `npx tsc --noEmit` dies with a V8 OOM on this repo.)

**This means Phase 0 has had no runtime verification.** Type checking will not
catch a wrong Supabase column name, a missing embed, or a null shape, and 0.8
moved every audit query. Before merging, this branch needs a Vercel preview
deploy and one real job generated through all four views. See "Needs a human"
below.

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
- Job select gains `status`, `completed_at`, `completed_by`,
  `geofence_radius_metres`, `gps_source`, `distance_from_site_km`, `site_id` —
  what v2 previously got from `select *`.
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
- 0.7: §2 gains a **Sign-in location** column, a 112×64 static map thumbnail per
  shift linking to full size, coordinates on the link title. Falls back to "—"
  with no maps key.
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

## Needs a human

1. **Runtime verification before merge.** The local build is broken (above), so
   nothing here has been executed. 0.8 rewrote every audit query. Deploy this
   branch to a Vercel preview and generate one real job in Daily, Progress,
   Iteration and Compliance, plus one share link. Highest-risk items, all
   invisible to `tsc`:
   - `checklist_templates`, `reviewed_by` and `reviewed_at` actually existing
     and being selectable on `qa_submissions` in production;
   - the job select's new columns (`site_id`, `gps_source`,
     `distance_from_site_km`) existing on every company's `jobs` table — if any
     is missing, PostgREST fails the whole select and the pack returns "Job not
     found";
   - walkthroughs still resolving through the shared layer's embed syntax.

2. **The broken build itself.** Worth its own fix before Phase 1 — Phase 1 adds
   Postgres triggers, an Ed25519 signing path and a PDF generator, none of which
   can be trusted behind a build you cannot run. It is a Windows/babel-loader
   crash, so it may not reproduce in CI; check whether Vercel builds `master`
   green today.

3. **Static map cost (0.7).** The Compliance view now renders one Google Static
   Maps request per shift, per view. A 200-shift job is 200 billed requests
   each time someone opens the tab, and they are not cached. If that matters,
   Phase 1.3's archive step should snapshot the map images once per pack
   instead.

4. **Map styling is now the report route's.** v2's red-marker 400×200 maps are
   gone in favour of the teal 320×200 ones. Cosmetic, but it is a visible change
   to anyone who had seen the v2 style. Nobody had, since neither was ever
   rendered — flagging it only because it is a silent choice.

5. **Sign-out location maps stay unrendered.** The spec said "one per shift", so
   only `map_in_url` is shown. `map_out_url` is still computed and discarded.
   It belongs with 2.1/2.2 attendance detail; confirm that is where you want it.

6. **Spec vs summary path** — see the note at the top.

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
```

Phase 1 not started, per instruction.
