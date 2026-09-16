# Vantro Privacy Policy — DRAFT

> **DRAFT — NOT REVIEWED BY A SOLICITOR. DO NOT PUBLISH.**
> Version 0.1 draft, 16 September 2026. See `docs/legal/README.md`.
>
> A different privacy policy is live today at `/privacy` and as a PDF at
> `public/legal/Vantro_Privacy_Policy.pdf`. **These have not been reconciled.**
> The entity is now settled and consistent across all three: CNNCTD Ltd,
> NI695071, trading as Vantro.

**Who this is for.** This policy covers what *we* do with personal data as a
controller: the people who run the companies that subscribe to Vantro, people
who contact us, and visitors to our website.

**If you are a worker whose employer uses Vantro, this is not the document you
want.** Your employer decides what is recorded about you and why; we only hold
it for them. Ask your employer for their notice — they should have given you one
based on `worker-privacy-notice.md`. Section 7 below tells you what to do if you
cannot get an answer.

---

## 1. Who we are

**CNNCTD Ltd**, a company registered in Northern Ireland under company number
**NI695071**, trading as **Vantro**. Registered office: **[TO CONFIRM]**.

ICO registration: **[TO CONFIRM]**.

Data protection contact: **privacy@getvantro.com**.

Data Protection Officer: **[TO CONFIRM — whether one is required and appointed.
Given the scale and nature of the processing, probably not required, but the
question should be answered rather than left open.]**

## 2. What we collect, and why

### If you run a company that uses Vantro

| What | Why | Lawful basis |
|---|---|---|
| Your name, work email, company name | To create and run your account | Contract |
| Your password hash, and 2FA secret if you enrol | To let you sign in, and to keep others out | Contract |
| Billing contact and VAT details | To bill you | Contract, and legal obligation for tax records |
| Which features you use, and when | To keep the service working and decide what to build | Legitimate interests — running and improving a service you pay for |
| Support emails and their contents | To answer you | Contract |
| IP address and browser details in request logs | Security, abuse prevention and debugging | Legitimate interests — keeping the service secure |

Card details are handled entirely by **Stripe** and never reach us.

### If you visit our website

Request logs, as above. **[TO CONFIRM: whether any analytics or marketing
cookies are in use on the marketing site. If any are, this section needs a
cookie table and the site needs a consent banner, and neither exists in this
draft.]**

### If you email us

Whatever you put in the email, kept while we deal with it and for a reasonable
period afterwards.

## 3. What we do *not* do

- We do not sell personal data. Not to anyone, in any form.
- We do not use your workers' data for advertising.
- We do not use customer data to train AI models for anyone else's benefit.
- We do not build profiles of workers across different employers.
- No automated decision-making with legal or similarly significant effects
  under Article 22.

## 4. Your workers' data

Most of the personal data in Vantro is not about our customers — it is about
their workers. For all of that, **your employer is the controller and we are the
processor**. We process it on their instructions under the Data Processing
Agreement, and we do not decide what is collected, who sees it, or how long it
is kept.

What is recorded, in outline, so nobody has to guess: name and contact details,
sign-in and sign-out times, **location at those moments and while the worker is
signed in** — a 150-metre geofence around the site plus a position at most once
an hour, stopping at sign-out — hours and pay, photographs and other site media,
and free-text entries the worker or their supervisor wrote.
`worker-privacy-notice.md` sets it out properly.

## 5. Who else sees it

The full list, with region and purpose, is published at
`docs/legal/subprocessors.md`. In summary:

- The database, the application servers and the file storage are in the **EU**.
- **Email, AI text classification, address lookup, push notifications and
  billing involve transfers to the United States.**
- Error monitoring is in the EU, and is scrubbed of tokens, PINs and
  coordinates before anything is sent.

Otherwise we disclose personal data only where the law requires it, or to
professional advisers under confidentiality, or to a buyer if the business is
sold — in which case we will tell customers.

## 6. Keeping it

| What | How long |
|---|---|
| Your account, while you are a customer | Until you close it |
| Your account, after you close it | 30 days, then deleted |
| Billing records | 6 years, because HMRC requires it |
| Support correspondence | 2 years |
| Security and request logs | **[TO CONFIRM: the hosting platform's log retention is short — a matter of minutes for some request logs. This should say what is actually true rather than a number that sounds right.]** |
| Your workers' data | Whatever policy their employer set. We do not decide this. |

## 7. Your rights

You can ask us to give you a copy of your data, correct it, delete it, restrict
what we do with it, or object to processing based on legitimate interests. You
can ask for it in a portable format.

Email **privacy@getvantro.com**. We will respond within **one month**.

We will not charge you, and we will not make it difficult.

**If you are a worker** and this is about data your employer holds in Vantro:
ask your employer, because they control it. If they will not answer, tell us at
the same address. We cannot hand over their records — that would be a breach of
our agreement with them — but we can tell you what categories exist, confirm
we have passed your request on, and if they still do not respond, you can
complain to the ICO about them.

You can complain to the **Information Commissioner's Office** at any time:
ico.org.uk, 0303 123 1113.

## 8. Security

Tenant isolation enforced in the database and tested in CI. Evidence records
append-only and hash-chained. Passwords and PINs hashed, never stored readable.
Mobile credentials in hardware-backed secure storage. TLS everywhere, with
certificate pinning in the mobile app. Two-factor authentication available on
admin accounts and mandatory on ours. Error reports scrubbed of tokens, PINs and
location before they leave the device.

Details in `docs/security/`.

## 9. Changes

We will post changes here and, for anything material, email customers at least
30 days beforehand.

---

### Open questions for review

1. ~~Which entity.~~ **Settled: CNNCTD Ltd, company number NI695071, trading as
   Vantro.** Applied here and on the live `/privacy` page, which previously said
   the trading name was Scale 8 Digital. Still open: the registered office
   address and the ICO registration number, neither of which can be invented.
2. **Cookies and analytics.** Section 2 has a gap that has to be closed by
   looking at the marketing site, not by drafting.
3. **Log retention** (section 6) should state the truth. The hosting platform
   keeps request logs for a very short period, which is a security limitation
   worth stating plainly rather than papering over.
4. **The worker escalation route** (section 7) is unusual and is there because
   workers *will* write to us rather than to their employer. Confirm the wording
   does not accidentally accept controller responsibility for their data.
5. **DPO.** Answer the question rather than leaving the heading.
