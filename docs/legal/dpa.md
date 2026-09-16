# Vantro Data Processing Agreement — DRAFT

> **DRAFT — NOT REVIEWED BY A SOLICITOR. DO NOT PUBLISH.**
> Version 0.1 draft, 16 September 2026. See `docs/legal/README.md`.
>
> There is an existing DPA published as a PDF at
> `public/legal/Vantro_Data_Processing_Agreement.pdf`, linked from the
> compliance modal in the product today. **These two have not been reconciled.**
> Before this is published somebody must decide which governs and withdraw the
> other.

This agreement is made under **Article 28 of the UK GDPR** between:

- **You**, the subscribing company, as **controller**; and
- **[TO CONFIRM: registered company name]**, company number **[TO CONFIRM]**,
  as **processor** ("we", "Vantro").

It forms part of the Terms of Service. Where they conflict on data protection,
this agreement wins.

---

## 1. Who is what

**You are the controller.** Your workers' data is yours. You decided to record
where they are, you set the job sites and the geofences, and you decide who in
your business sees it. You are responsible for having a lawful basis and for
telling your workers — see `worker-privacy-notice.md`.

**We are the processor.** We process that data only to provide the service, and
only on your documented instructions. Using the product is an instruction: when
an admin runs a payroll export, that is you instructing us to process.

We will tell you if we think an instruction breaks data protection law. We will
not obey it in the meantime.

For our own business records — your billing contact, your admins' logins,
support correspondence — **we are the controller**, and the privacy policy
covers that, not this agreement.

## 2. What we process, and for whom

**Categories of data subject:** your workers and installers; your office staff
and admins; where you record them, site visitors and subcontractors' staff.

**Categories of personal data:**

| Category | What it is |
|---|---|
| Identity | Name, initials, email address, role, employee reference |
| Authentication | Password hash (admins), PIN hash (installers), session tokens |
| **Location** | Latitude and longitude at sign-in and sign-out, distance from the job site, whether the worker was inside the geofence, and position traces while signed in (see below) |
| Working time | Sign-in and sign-out times, breaks, lateness against schedule, hours by category |
| Pay | Hourly rate, overtime bands, bonuses, calculated pay |
| Images and media | Site photographs, receipt images, walkthrough video and audio, signatures |
| Free text | Diary entries, incident reports, defect notes, QA comments |
| Device | Push notification token, app version, whether the device is rooted |

**Special category data.** The service is not designed to hold it, and you
should not put it there. But incident reports and diary entries are free text,
and an incident report about an injury is health data whether or not anybody
intended it to be. Treat the incident module as holding special category data
and make sure your Article 9 condition covers it — for UK employers this is
usually Schedule 1 Part 1 paragraph 1 of the Data Protection Act 2018,
employment law obligations.

**Location is the sensitive one.** Not special category in law, but it is the
data your workers did not choose to share and the thing that will generate
complaints. Precisely what is recorded, because a wrong answer here is the one
that ends up at the ICO:

- A fix at **sign-in** and at **sign-out**, stored on the shift record.
- While a worker is signed in, a **150-metre geofence** around the job site,
  which records a position when they leave it and when they return.
- While a worker is signed in, a position **at most once an hour**.
- **Nothing outside the shift window.** Recording runs from sign-in until
  sign-out or the expected finish time, whichever is first. Not before, not
  after, not on a non-working day.

The during-shift traces are held in a separate table with their own **90-day
cap**, applied regardless of the retention policy you choose — they are
telemetry supporting the automatic sign-out rule, not evidence, and retention
is a floor on privacy rather than a licence to keep them.

**Duration:** for as long as you are a customer, plus whatever your retention
policy allows — section 8.

## 3. Our staff

Anybody who can reach your data is bound by confidentiality that survives their
employment. Access is on a need-to-know basis, and support access to a
customer's data is logged.

## 4. Security

Without repeating the whole of `docs/security/`:

- **Tenant isolation** is enforced in the database by row-level security, not
  only in application code, and is tested by a suite that runs in CI.
- **Evidence records are append-only** and hash-chained. No client session can
  update or delete them — the database refuses. Tampering is detectable rather
  than merely prohibited.
- **Credentials.** Passwords and installer PINs are hashed. Field tokens are
  held in the phone's secure hardware storage — the Android keystore or the iOS
  keychain — never in plain application storage. A deactivated worker's token
  stops working immediately.
- **Transport.** TLS everywhere. The mobile app pins the certificate of the API
  it talks to.
- **Two-factor authentication** is available on admin accounts and mandatory
  for our own staff accounts.
- **Error reporting** is scrubbed before it leaves the device or the server:
  tokens, PINs and coordinates are removed. Session replay masks all text and
  images.
- **Penetration testing:** scope and findings in `docs/security/PENTEST-SCOPE.md`.

We will give you what you reasonably need to complete your own DPIA.

## 5. Sub-processors

You give **general written authorisation** for us to appoint sub-processors. The
current list is at **`docs/legal/subprocessors.md`**, published and kept current.

We will tell you **at least 30 days before** adding or replacing one. If you
object on reasonable data protection grounds, tell us within those 30 days and
we will either not make the change for you, offer an alternative, or let you
terminate without penalty and refund the unused part of anything paid.

Every sub-processor is bound by terms no less protective than these, and we
remain liable to you for what they do.

**What you should look at on that list before signing:**

- The database, the application and the object storage are in the **EU**.
- **Email, AI classification, address lookup, push notifications and billing
  involve transfers to the United States.** In plain terms: your workers' names
  and email addresses go to a US email provider, and diary text and walkthrough
  transcripts your workers wrote go to US AI providers. Section 6 covers the
  legal mechanism. Whether you are content with it is your decision as
  controller, and it is the part of this agreement most worth reading twice.

## 6. International transfers

Where personal data leaves the UK, transfers are made under the **UK
International Data Transfer Addendum to the EU Standard Contractual Clauses**,
or an adequacy decision where one applies. `subprocessors.md` records which
applies to each.

The US transfers listed there are a **[TO CONFIRM: whether reliance is on the
UK Extension to the EU-US Data Privacy Framework, or on IDTA plus a transfer
risk assessment, for each US sub-processor. This must be answered per
sub-processor, not in general.]**

## 7. Helping you with your obligations

**Data subject requests.** If a worker contacts us, we will not answer them
directly — we will forward it to you, because you are the controller. The
product gives your admins the tools to do it themselves: export everything held
about a person, and erase them.

**Erasure is not total, and cannot be.** Three things survive, and this is by
design rather than limitation:

1. **Audit packs already issued keep the name that was in them.** They are
   signed and hashed; rewriting one destroys the signature that makes it worth
   anything.
2. **Shift, safety and quality records are kept with the name removed.** They
   are health and safety evidence, which **UK GDPR Article 17(3)** exempts from
   erasure. The record survives; the person is replaced by a stable pseudonym so
   the evidence still hangs together.
3. **Backups** roll off on their own retention schedule and are not rewritten in
   place.

The product tells the admin all three at the moment they erase somebody, so the
answer they give the worker is accurate.

**Breach notification.** We will tell you **without undue delay and in any event
within 24 hours** of becoming aware of a personal data breach affecting your
data, with what we know: what happened, which categories and roughly how many
people, the likely consequences, and what we are doing. We will keep telling you
as we learn more. **The 72-hour notification to the ICO is yours to make** — you
are the controller — and 24 hours is meant to leave you two days to make it.

**DPIAs and prior consultation.** We will give you reasonable assistance.

## 8. Retention and deletion

You set the policy: **keep for ever** (the default), **3 years**, or **6 years**.
Nothing shorter is offered, deliberately — health and safety records carry
statutory minimums, and a subcontractor deleting attendance at twelve months has
destroyed their own defence in a dispute they do not yet know about.

Changing the policy does not purge immediately. There is a **30-day grace
period** and a warning banner, because choosing "3 years" on a company with four
years of history would otherwise destroy a year of records the next time a
nightly job ran.

**Free plan companies keep shift records for 5 days.** This is a product limit,
not a retention policy, and it is worth understanding: if a paid company
cancels, it drops to Free and its shift history starts expiring at five days.

On termination, at your choice, we will delete or return your data within **30
days**, except what we are legally required to keep. Deletion covers the
database, the object storage, the video, and the audit pack archives. The hash
ledger survives; it holds no personal data.

## 9. Audit

You may audit our compliance, once per year, on 30 days' written notice, at your
cost, during business hours, without disrupting the service. We will first offer
our current security documentation and penetration test results, which in most
cases answers it.

If a sub-processor's own certifications answer the question, those count.

## 10. Liability

Liability under this agreement is subject to the limits in the Terms of Service,
**except** as noted in section 9 of those terms regarding a personal data breach
caused by our breach of this agreement. **[TO CONFIRM — see terms.md.]**

## 11. Signing

Accepted electronically. The product records **who accepted, their name, and the
timestamp**, against the company. That record is your evidence of compliance and
your admins can see it in the compliance panel at any time.

---

### Open questions for review

1. **The existing PDF DPA** must be reconciled or withdrawn. Two live versions
   is the worst outcome.
2. **24-hour breach notification** (section 7) is a commitment we have to be
   able to meet. It requires monitoring that actually pages somebody. Confirm
   before signing anybody up to it.
3. **Transfer mechanism per US sub-processor** (section 6) is unfinished and
   cannot be finished by a solicitor alone — it needs the DPF certification
   status of each of Resend, Stripe, Expo, Google and Anthropic checked and
   recorded.
4. **Special category data in incident reports** (section 2). The drafting tells
   the controller to assume it is there. A solicitor should confirm that is the
   right posture rather than trying to exclude it.
5. **Audit rights** (section 9) are drafted narrowly. A larger customer will
   push back.
