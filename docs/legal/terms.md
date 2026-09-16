# Vantro Terms of Service — DRAFT

> **DRAFT — NOT REVIEWED BY A SOLICITOR. DO NOT PUBLISH.**
> Version 0.1 draft, 16 September 2026. See `docs/legal/README.md`.

These terms are between **CNNCTD Ltd**, a company registered in Northern
Ireland under company number **NI695071**, trading as **Vantro** ("we", "us",
"Vantro"), registered at **[TO CONFIRM: registered office address]**, and the
company that subscribes to the service ("you", "your company").

They do not apply to your workers. A worker who signs in on the mobile app is
using the service on your behalf, under your instructions; what we do with their
data is governed by the **Data Processing Agreement** (`dpa.md`) and described
to them in the **Worker Privacy Notice** (`worker-privacy-notice.md`).

---

## 1. What the service is

Vantro records where and when your workers start and finish work, and keeps the
evidence of it. Depending on your plan it also prices those hours for payroll,
holds site safety and quality records, and produces compliance packs.

It is a record-keeping tool. **It is not legal, payroll, tax or health and
safety advice**, and the presence of a feature is not a statement that using it
makes you compliant with anything. Section 9 says more about this, and it is the
part of these terms most likely to matter to you.

## 2. The plans, and what each costs

| Plan | Price | Billed |
|---|---|---|
| Free | £0 | Never |
| Payroll | £39.99 per month | Monthly, in advance |
| Suite | £99 per month | Monthly, in advance |

Prices exclude VAT, which is added at the prevailing UK rate.

The price is per company, not per worker. Adding installers does not change what
you pay.

**Free is free indefinitely**, not a trial. It is limited: shift records on Free
are kept for **5 days** and then removed. If you need the history, you need a
paid plan — and you need it *before* the five days run out, because we cannot
recover what has already been deleted.

Paid plans include a **30-day trial**. A card is required to start it, nothing
is charged during it, and if you cancel before it ends you are not charged at
all.

## 3. Cancelling

**Monthly rolling. Cancel any time. No notice period. No minimum term.**

Cancel from the Billing tab. Your plan continues to the end of the period you
have already paid for, and then stops. We do not refund part-months, because
there are none to refund — you have had the month.

We do not delete your data when you cancel. The company drops to Free, which
means the Free limits then apply, including the 5-day shift retention. **If you
want your data before that happens, export it before you cancel.** If you want
it deleted, ask us; section 8 covers that.

## 4. Changing the price

We may change prices. If we do, we will give you **at least 30 days' notice by
email to your admin address**, and the new price applies from your next renewal
after that notice. You can cancel in that window and never pay it.

We will not change the price of a period you have already paid for.

## 5. What you are responsible for

**The lawfulness of the tracking.** Vantro records location. You decide to use
it on your workers; that decision is yours and so is the legal basis for it.
Before you roll it out you must tell your workers what is being recorded and
why — `worker-privacy-notice.md` is a template for exactly this — and, where
the law requires it, consult them or their representatives. We provide the tool.
We do not provide the lawful basis.

**The accuracy of what you put in.** Pay rates, job addresses, geofence radii,
break rules and schedules are yours. The pay engine is arithmetic on the numbers
you give it.

**Your users' accounts.** Keeping admin credentials safe, removing people who
have left, and not sharing installer PINs. Deactivating a worker immediately
invalidates their mobile session.

**Not misusing the service.** No attempting to reach another company's data, no
automated scraping, no load testing without asking, no reselling access, and
nothing illegal.

## 6. What we are responsible for

**Providing the service with reasonable skill and care.**

**Security.** Company data is isolated at the database level and that isolation
is tested. Evidence records are append-only and hash-chained so that tampering
is detectable. Passwords are never stored in plain text. `docs/security/` sets
out what has been tested and by whom.

**Availability.** We aim for high availability but **do not offer a contractual
uptime guarantee or service credits** at these prices. If you need an SLA, talk
to us about an enterprise arrangement.

**Telling you about a breach.** If there is a personal data breach affecting
your data we will tell you without undue delay — the DPA sets out the timing and
what we will include.

## 7. Your data is yours

You own the records your company creates in Vantro. We do not sell them, rent
them, or use them to train AI models for anyone else's benefit.

Some features send text to AI services to classify or summarise it — diary
entries and walkthrough transcripts. What goes where is listed in
`subprocessors.md`. Those services are contractually bound not to train on it.

You can export at any time from within the product.

## 8. Deleting your company

Ask us and we will delete your company: the database records, the photographs,
the audio and video, and the audit packs, from every system that holds them.

Three things survive and you should know about them before you ask:

1. **Records we are legally required to keep**, for as long as we are required
   to keep them — chiefly billing records for HMRC.
2. **The hash ledger**, which holds no personal data: a list of hashes proving
   that records which once existed have not been altered.
3. **Backups**, which roll off on their own schedule rather than being rewritten
   in place.

Deletion is not reversible. We will confirm when it is done.

## 9. Limits on our liability — read this

Nothing here limits liability for death or personal injury caused by
negligence, for fraud, or for anything else that cannot lawfully be limited.

Subject to that:

**We are not liable for how you use the records.** If you pay someone the wrong
amount, dismiss someone, defend a claim, or fail an inspection, and Vantro's
records were involved, that is your decision made on your data. We provide
arithmetic and storage. **Check the numbers before you pay anybody.**

**We are not liable for indirect or consequential loss**, lost profit, lost
business, lost goodwill, or loss arising from a claim someone else makes
against you.

**Our total liability in any 12-month period is capped at the fees you paid us
in that period.** On a £99/month plan that is £1,188. You should consider
whether that is enough for how you intend to use the service, and insure
accordingly.

*(This matches what is published at `/legal/terms`. If a minimum floor is wanted
instead — "the greater of the fees paid or £X" — both documents have to change
together.)*

The cap does not apply to our obligations under the DPA in respect of a
personal data breach caused by our breach of it. **[TO CONFIRM: whether the
business accepts this carve-out — it is the single most expensive sentence in
this document.]**

## 10. Suspending or ending your access

We may suspend the service if payment fails and remains unpaid after we have
told you, or if what you are doing threatens the service or other customers. We
will tell you why and, where the problem can be fixed, what would fix it.

We may end this agreement on **30 days' written notice**. If we do, we refund
the unused part of anything you have paid in advance and give you at least that
30 days to export.

## 11. Changing these terms

We may change these terms. Material changes get **at least 30 days' notice by
email to your admin address**, and you can cancel before they take effect.
Changes required by law may take effect sooner if the law requires it.

## 12. The rest

**Whole agreement.** These terms, the DPA, and the plan you selected are the
whole agreement.

**No third party rights.** Nobody outside this agreement can enforce it under
the Contracts (Rights of Third Parties) Act 1999.

**Assignment.** You may not assign without our consent. We may assign on a sale
of the business, and will tell you.

**Governing law.** England and Wales, exclusive jurisdiction of the English
courts. **[TO CONFIRM: CNNCTD Ltd is registered in NORTHERN IRELAND, which has
its own legal system. An NI company may choose English law, and most UK SaaS
does, but it should be a decision rather than a default — and the published
page at /legal/terms currently says England and Wales.]**

**Contact.** CNNCTD Ltd, **[TO CONFIRM: registered office address]** ·
privacy@getvantro.com for data protection · security@getvantro.com for security.

---

### Open questions for review

1. **The liability cap and its carve-out** (section 9) is the commercial
   decision in this document. Everything else is comparatively routine.
2. **Free tier data destruction.** Deleting shift records after 5 days on a free
   plan may destroy records the customer needed and did not realise they were
   losing — particularly on cancellation, when a paid company drops to Free and
   its history starts expiring. Section 3 warns about it. A solicitor should
   say whether a warning is enough, and the product should probably warn again
   at the moment of cancelling.
3. ~~Which entity contracts.~~ **Settled: CNNCTD Ltd, trading as Vantro,
   company number NI695071.** Northern Ireland registration raises the
   governing-law question in section 12.
4. **Consumer law.** These are drafted business-to-business. A sole trader
   subscribing may still get consumer protections; worth confirming whether
   that changes the cancellation terms.
5. **Whether "not legal or H&S advice" (section 1) survives** given the product
   generates compliance packs and RAMS documents that customers will treat as
   exactly that.
