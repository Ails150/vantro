# Vantro Audit Pack v2 — Build Spec

Repo: C:\vantro (web, API, pack generation). Mobile changes in C:\vantro-mobile where marked.
Work in the order below. One PR per phase. Build passes after every commit. Do not deploy.
Every phase ends with a written summary of what changed, file by file, and what still needs a human decision.

Target outcome: a contractor can produce, from their phone, in one PDF, everything a CHAS / SafeContractor / SMAS assessor asks for at annual renewal, plus everything a client or insurer asks for after the fact, with evidence integrity that survives cross examination.

---

## Phase 0 — Fix what is broken (no new features)

0.1 Compliance view §2: Dist In and Dist Out read `distance_metres` / `sign_out_distance_metres` but v2 selects `distance_from_site_metres` and no sign-out distance. Select both real columns in v2 and render them.
0.2 Compliance view §3: Approver / Approved at read `approvedBy` / `approvedAt`; v2 emits `signedOffBy` / `signedOffAt`. Align names.
0.3 The `signoffs` array from v2 is fetched and used only as a count. Render it: item, who, when.
0.4 "Refresh AI" must POST with `regenerate: true`.
0.5 Delete the dead Client view block in AuditTab.tsx (gated behind `false`). Client = share link. Remove the UI copy claiming approved walkthroughs appear in client and compliance reports until 3.6 makes it true.
0.6 Compliance sworn statement must read the job's actual geofence radius, never hardcode 150m.
0.7 Static map images built per sign-in are never rendered. Either render them in the attendance section or stop building them. Decide: render, small, one per shift, in the Compliance view only.
0.8 Consolidate: v1 `/api/audit` and v2 `/api/audit/v2` use different queries from the shared data layer `lib/audit/data.ts`. Move both onto the shared data layer so the three producers agree. Delete v1 once the Full Evidence accordion reads from the shared layer.

---

## Phase 1 — Evidence integrity (the credibility layer)

Goal: every claim in the pack is backed by a hash written at the moment of capture, the pack itself is signed server side, and two copies of the same pack can be compared.

1.1 Content hashing at write time
- New table `evidence_hashes` (id, company_id, entity_type, entity_id, sha256, hashed_at, hashed_by, algorithm 'sha256', payload_version).
- On insert of: signins, location_logs (batch per sign-in on sign-out), diary_entries, qa_submissions, defects, variations, walkthroughs, expenses, photos/videos (hash of the file bytes, not the URL).
- Hash a canonical JSON of the row's evidential fields (timestamps, user, GPS, text, file hash). Exclude mutable presentation fields.
- Implement as Postgres triggers for row hashes, and in the upload handler for file bytes (hash the buffer before storing). If a trigger cannot see file bytes, the upload API writes the file hash row.
- Rows are append-only: add a trigger that rejects UPDATE on evidential fields for the tables above; corrections are new rows with `supersedes_id`.

1.2 Pack manifest and signature
- On pack generation (`/api/audit/report` and the Compliance view), build a manifest: pack reference, job id, period, generated_at, list of every evidence_hash id included, and a Merkle root over those hashes.
- Sign the manifest server side with an Ed25519 key held in an env var (`AUDIT_SIGNING_KEY`), never in the browser. Store manifest + signature in new table `audit_packs` (id, company_id, job_id, reference, period_from, period_to, generated_at, generated_by, merkle_root, signature, view_type, share_id nullable).
- Print on page 1: pack reference, Merkle root (first 16 hex + full in appendix), signature, and a line: "Verify at getvantro.com/verify".
- New public endpoint `/verify?ref=` that accepts a pack reference and returns: root, signature valid yes/no, generated_at, evidence count. No evidence content is exposed.
- Remove the browser-side `crypto.subtle.digest` chain-of-custody. Replace section 6 text with what is actually true: what is hashed, when, where stored, how to verify. No prose claims that are not computed.

1.3 Permanent evidence
- On pack generation, copy every referenced photo/video to a write-once bucket `audit-archive/<company>/<pack_ref>/` with the file hash as the filename. Bucket has no delete policy for any app role.
- The shared report and the emailed pack reference archive URLs that do not expire, or (preferred) a PDF is generated server side with images embedded. Decide: generate PDF with embedded images using the existing HTML report as the template. Keep the HTML link as the interactive view.
- Share links: keep 30-day expiry for the interactive view. The PDF is the durable artefact and is attached to the share email.

1.4 Admin audit log in the pack
- Appendix: the `audit_log` rows for the job's period (who did what, when) filtered to evidential actions (approve, resolve, edit, delete attempt). This is the human chain of custody.

---

## Phase 2 — Surface what is already captured (no new data entry)

Render in the Compliance view and the PDF. Client HTML gets a subset (marked C).

2.1 Attendance (C): add GPS accuracy metres in/out, signed_out_method, expected vs actual sign-out time, flags, early departure, auto-close reason. Currently only the client HTML shows flags; Compliance must too.
2.2 Breadcrumb trail: per shift, a compact map with the location_logs path and a table of pings with within_range. This is the strongest attendance evidence in the system and is in no view.
2.3 Photo evidence table (C): every photo with capture timestamp, GPS from diary_entries.lat/lng, file hash, who took it. Add EXIF capture time when present. Thumbnail links to archive copy.
2.4 Defect video: render video where defects.video_url exists.
2.5 QA sign-off fields: installer_initials, installer_date, rfl_initials, rfl_date, remedial_action, hold_point. Render per item. Whole-checklist submissions (job_checklists, checklist_run_items, qa_approvals) rendered as a checklist section, not just individual items.
2.6 Rostered vs actual: from user_shifts and visit_assignments, a table of who was scheduled vs who signed in, per day.
2.7 Subcontractors on the job: firm, contact, assignment dates, crew size. From subcontractors and subcontractor_assignments.
2.8 Alerts and response: each blocker/critical alert with raised_at, read_at, resolved_at, by whom. Shows responsiveness.
2.9 Expenses against the job: amount, VAT, category, receipt image (archived), status. Internal and Compliance only, never Client.
2.10 Variations (C): already in the client HTML. Add to the Compliance view and the in-app Internal view.
2.11 Walkthroughs: approved ones appear in Compliance and Client as the UI copy already promises. Send the view parameter so approval_status gates correctly.
2.12 Job configuration block: geofence radius, GPS source, required trades, company vertical. Printed, not just fetched.
2.13 Multi-site: where signins.visit_id is populated, group attendance by site/visit.

---

## Phase 3 — New capture for SSIP renewal (small mobile additions)

Each item is one screen in vantro-mobile and one section in the pack. Keep entry under 30 seconds.

3.1 Toolbox talks
- Table `toolbox_talks` (id, company_id, job_id nullable, title, delivered_at, delivered_by, notes, sheet_photo_url, hash). `toolbox_talk_attendees` (talk_id, user_id, signed boolean).
- Mobile: New talk → title (pick from a list of common talks or free text), attendees tapped from crew, optional photo of the paper sheet, save. Attendees get a push to tap "I attended".
- Pack: "Toolbox talks, last 6 months" table with attendance.

3.2 Worker certificates / training matrix
- Table `worker_certificates` (id, company_id, user_id, cert_type, issuer, reference, issued_at, expires_at, file_url, verified_by, verified_at, hash).
- cert_type list: CSCS, first aid, working at height, manual handling, asbestos awareness, PASMA, IPAF, SIA licence, BICSc, trade qualification, other.
- Mobile: worker uploads a photo of the card; admin verifies in web.
- Alerts: 30 days before expiry to admin and worker.
- Pack: training matrix, one row per worker on the job, one column per cert type, expiry dates, expired in red.

3.3 Incident and near-miss log
- Table `incidents` (id, company_id, job_id, type: near_miss | injury | dangerous_occurrence | property_damage, occurred_at, reported_by, description, photo_urls, riddor_reportable boolean, riddor_ref, investigation_notes, closed_at, hash).
- Mobile: report incident, 4 taps. Distinct from defects.
- Pack: incident log for the period plus 3-year statistics summary (count by type, RIDDOR count).

3.4 RAMS and COSHH attachments per job
- Table `job_documents` (id, company_id, job_id, doc_type: rams | coshh | permit | other, title, file_url, uploaded_by, uploaded_at, valid_from, valid_to, hash).
- Web upload on the job. Pack: document register with dates, so the pack proves a site-specific RAMS existed for the job and when.

3.5 Site inspections
- Reuse checklists: a checklist template type "site inspection". Pack section "Inspections" listing completed inspections with inspector and date.

---

## Phase 4 — The annual pack

4.1 New pack type: "Accreditation renewal pack", company-scoped not job-scoped, period = last 12 months.
- Sections: company and insurance details (from a new `company_compliance` settings page: H&S policy PDF and review date, competent person name and quals, insurance certs and expiry), training matrix (all workers), toolbox talks (6 months), incident log and 3-year stats, RAMS register across jobs (3 most recent minimum), inspections, subcontractor register, attendance summary.
- Same manifest, signature and archive as the job pack.
- Maps explicitly to SSIP core criteria: print the criterion number next to each section.

4.2 Renewal reminder: company setting `accreditation_renewal_date`; alert at 60 and 30 days with a one-tap "Generate renewal pack".

---

## Phase 5 — Billing hooks (for the PAYG work already planned)

5.1 Job pack generation consumes one `audit_credits` unit; annual pack consumes five. Record the spend on the pack (`audit_packs.credits_used`).
5.2 Free tier: unlimited capture, unlimited in-app Internal view, first job pack free, then credits.

---

## Definition of done per phase

- `npm run build` green.
- Every new table has RLS with superadmin included in role arrays (see repo convention).
- Every new evidential table has a hash trigger and append-only enforcement.
- The Compliance view, client HTML and PDF are generated from the shared data layer only.
- A test job in the Apexify company renders all new sections without error.
- Summary written to `docs/audit-pack-v2/PHASE-N.md`.
