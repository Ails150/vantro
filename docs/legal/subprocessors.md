# Sub-processors

Every third party that receives Vantro customer data, why, and where.

**Generated from the code, not from memory.** The list below was produced by
scanning both repositories for outbound hosts and for SDKs that reach a service
without a literal URL, then confirming each one against what the code actually
sends. The method is at the bottom so it can be re-run.

Last verified: **16 September 2026**.

> **Draft for solicitor review.** This is an accurate technical record of what
> the software does. It has not been reviewed by a lawyer, and the Article 28
> wording a customer needs is in `dpa.md`, which is also a draft.

---

## The list

| Sub-processor | What it processes | Region | Basis |
|---|---|---|---|
| **Supabase** | Everything: the Postgres database, authentication, and every personal-data table | **EU (Frankfurt, `eu-central-1`)** | Core hosting. Confirmed from the project ref's region. |
| **Vercel** | Serves the web app and runs every API route. Request logs, IP addresses | **EU (`lhr1`/`dub1` for functions)** | Application hosting. Function regions confirmed from the deployment. |
| **Cloudflare R2** | Photographs, receipts, RAMS PDFs, walkthrough audio, audit-pack archives | **EU jurisdiction** | Object storage. See *Confirming the R2 region* below. |
| **Cloudflare Stream** | Walkthrough and QA video | Cloudflare global | Video transcoding and delivery. |
| **Resend** | Outbound email: invites, password resets, weekly reports, audit packs. Recipient addresses and message bodies | US | Transactional email. **Worth noting: names and email addresses leave the EU here.** |
| **Stripe** | Billing. Company name, billing email, card handled entirely by Stripe | US / global | Payments. Card data never reaches Vantro. |
| **Sentry** | Error reports and performance traces. See *What Sentry must never see* | EU (`de` region) | Error monitoring. |
| **Expo (EAS)** | Push notification tokens and delivery, via `exp.host`. Builds the mobile app | US | Push and mobile builds. |
| **Google Maps Platform** | Address autocomplete and geocoding. Typed addresses and job coordinates | US / global | Address lookup. |
| **Anthropic** | Diary text and walkthrough transcripts sent for classification and summary | US | AI features. **Free-text a worker wrote leaves the EU.** |
| **Google Gemini** | Same as Anthropic, on the paths that use it | US / global | AI features. |

### Not sub-processors, despite appearing in the code

- **gov.uk** — named in the original brief, but **nothing calls it.** UK bank
  holidays are seeded into `public_holidays` by a migration, not fetched. There
  is no outbound request to any gov.uk host in either repository.
- **`wa.me`** — a WhatsApp deep link the user taps. Vantro sends nothing to it;
  the link is composed in the browser and opened by the person.
- **`play.google.com`, `apps.apple.com`** — store links in copy.
- **`www.w3.org`** — SVG namespace declarations, not a request.

---

## Confirming the R2 region

The brief asked specifically. It is the **EU jurisdiction**, confirmed rather
than assumed:

```
HeadBucket https://<account>.eu.r2.cloudflarestorage.com  -> 200 OK
HeadBucket https://<account>.r2.cloudflarestorage.com     -> NotFound
```

The bucket resolves only on the jurisdiction-specific EU endpoint. Cloudflare
serves a bucket created in the EU jurisdiction exclusively from that hostname,
so the 404 on the generic endpoint is the proof, not the 200.

`lib/r2-purge.ts` and `lib/audit/archive.ts` both hard-code the `.eu.` endpoint,
so a bucket created elsewhere would fail rather than silently store EU customer
photographs outside the EU.

---

## What Sentry must never see

Sentry receives stack traces from the server and the mobile app. It must never
receive:

- a worker's PIN, or its hash
- a field token or a Supabase access token
- a worker's location

This is asserted by `tests/security/f22-logging.spec.ts` rather than left as an
instruction, because a rule nobody checks is a rule that decays.

---

## Data that leaves the EU

Stated plainly because it is the part a customer's own DPIA will ask about:

| What | To | Why |
|---|---|---|
| Worker names and email addresses | Resend (US) | Every email the product sends |
| Diary text, walkthrough transcripts | Anthropic (US), Google (US) | Classification and summarisation |
| Typed addresses, job coordinates | Google Maps (US) | Address autocomplete |
| Push tokens | Expo (US) | Notification delivery |
| Billing contact | Stripe (US) | Payments |

Everything else — the database, the files, the error traces — stays in the EU.

Transfers rely on the providers' own standard contractual clauses and UK
addendums. **A solicitor should confirm each one is current**; that is not a
check the code can make.

---

## Method

Re-run before any material release:

```bash
# Outbound hosts written as literals
grep -rhoE "https?://[a-zA-Z0-9.-]+\.[a-z]{2,}" app lib scripts components \
  --include=*.ts --include=*.tsx | sed 's|https\?://||' | sort | uniq -c | sort -rn

# Services reached through an SDK, which have no literal URL to find
node -e "const d=require('./package.json'); console.log(Object.keys({...d.dependencies}))"
```

The second command is the one that matters. Supabase, Stripe, Sentry, Anthropic,
Gemini and R2 are all reached through client libraries and **none of them
appears as a URL in the source**, so a grep for hosts alone would have missed
six of the eleven entries above.

## Related

- `docs/legal/dpa.md` — the Article 28 terms these sit under
- `docs/legal/privacy-policy.md`
- `docs/legal/worker-privacy-notice.md` — what a company hands its workers
