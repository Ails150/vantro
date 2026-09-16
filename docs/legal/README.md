# Legal documents — drafts

**Every document in this folder is a DRAFT and has not been reviewed by a
solicitor. None of it should be published, linked from the product, or relied
on until it has been.**

They are written here, in the repository, rather than in a word processor, for
one reason: a legal document that contradicts the software is worse than no
document. Keeping the drafts next to the code means the claims in them can be
checked against what the product actually does, and a change to the product
shows up as a change to a file somebody has to reconcile.

| File | What it is | Who it is for |
|---|---|---|
| `terms.md` | Terms of Service — the contract to use Vantro | The subscribing company |
| `dpa.md` | Data Processing Agreement — Article 28 terms | The subscribing company, as controller |
| `privacy-policy.md` | Privacy policy for Vantro's own processing | Anybody, published |
| `worker-privacy-notice.md` | Template notice a customer gives its workers | The worker being tracked |
| `subprocessors.md` | The sub-processor list the DPA refers to | Published; reviewed and current |

`subprocessors.md` is the exception: it was built from the code and the live
infrastructure, and its contents are verified rather than drafted.

## What still has to be filled in

Marked `[TO CONFIRM]` throughout. A solicitor cannot fix these; only the
business can:

- The registered company name, number and address. The published privacy page
  at `/privacy` says **CNNCTD Ltd**; the product is branded **Vantro**. Which
  entity contracts with customers, and whether the other is a trading name,
  has to be settled before any of this is signed.
- Whether a Data Protection Officer is appointed, and if not, the named
  contact for data protection.
- The ICO registration number.
- Governing law and jurisdiction — drafted as England and Wales.
- Whether the liability cap drafted here is the one the business wants.
- Whether CNNCTD Ltd holds professional indemnity or cyber insurance, and at
  what limit.

## Where these documents disagree with what is already published

There are PDFs in `public/legal/` — a Data Processing Agreement and a Privacy
Policy — that predate these drafts and are linked from the compliance modal in
the product today. **They have not been reconciled with these drafts.** Before
anything here is published, somebody has to decide which version governs and
withdraw the other. Two live versions of a DPA is a worse position than one bad
one.

There is no Terms of Service published at all today. `terms.md` is the first.

## Facts these drafts assert about the product

Each of these is checkable in the code, and each would need updating here if it
changed:

- Three tiers: Free (£0), Payroll (£39.99/month), Suite (£99/month) —
  `lib/billing.ts`.
- Paid tiers carry a 30-day trial and a card is required to start it —
  `app/api/signup/initiate/route.ts`.
- Monthly rolling, cancel any time, no notice period — the Stripe subscription
  is monthly with no minimum term.
- Free retains shift records for 5 days — `lib/plan.ts`.
- Retention policy options are: keep for ever (default), 3 years, 6 years, with
  a 30-day grace before the first purge — `lib/retention-policy.ts`.
- Erasure keeps health and safety evidence with the name removed, and does not
  rewrite issued audit packs — `lib/gdpr.ts`, `ERASURE_CAVEATS`.
- Evidence tables are append-only and hash-chained; no client session can write
  to them — migration `20260916140000_evidence_no_client_writes.sql`.
- Location is recorded at sign-in and sign-out, **and while the worker is signed
  in**: a 150-metre geofence around the site, plus a position at most once an
  hour, stopping at sign-out or the expected finish time — `lib/locationTracker.ts`,
  `lib/activeShift.ts` in the mobile repo. Those traces have their own 90-day
  cap — `20260916120000_retention_policy.sql`.
- Database and application hosting are in the EU; object storage is in the EU
  jurisdiction — `docs/legal/subprocessors.md`.
- Email, AI classification, address lookup, push and billing involve transfers
  to the US — same file.
