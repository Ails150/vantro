# Rotating the third-party keys

Written because a rotation was asked for and could not be done from a terminal:
rolling a Stripe key needs the Stripe dashboard, and replacing it needs Vercel's
environment settings. Both are browser sessions nobody should be automating.
This is the procedure, against this deployment rather than in general.

**First, the thing that decides how urgent this is: no key has ever been
committed.** Full history across every branch, checked against exact key shapes:

| Shape | Occurrences in git history |
|---|---|
| `sk_live_…` | 0 |
| `sk_test_…` | 0 |
| `whsec_…` | 0 |
| `re_…_…` (Resend) | 0 |

A looser `re_` pattern matches four times and all four are ordinary identifiers
— `re_count`, `re_minutes`, `re_paywall`, `re_start…`. The same false-positive
class as the Hermes bytecode that once made the mobile repo look compromised.

So this is **scheduled hygiene, not incident response**. If that changes — a key
pasted into a chat, a laptop lost, a contractor offboarded — do it immediately
and in the order below, which is chosen so the service never runs on a key that
does not exist.

---

## What exists

From `vercel env ls production`:

| Variable | Scope | Age | Notes |
|---|---|---|---|
| `STRIPE_SECRET_KEY` | Production, Preview, **Development** | ~173 days | Never rotated |
| `STRIPE_WEBHOOK_SECRET` | Production, Preview, Development | ~169 days | Never rotated |
| `RESEND_API_KEY` | Production, Preview | ~176 days | Never rotated |
| `STRIPE_PRICE_ID`, `STRIPE_PRICE_STARTER`, `STRIPE_PRICE_GROWTH`, `STRIPE_PRICE_SCALE`, `STRIPE_PRICE_AI_AUDIT_PACK` | mixed | 138–173 days | Not secrets. See *Leftovers*. |

**There is no SendGrid key, and no SendGrid integration.** All outbound email
goes through Resend — `lib/weekly-report-send.ts`, `app/api/signup/initiate`,
`app/api/invite`, `lib/email-alerts.ts`. If a rotation request names SendGrid,
it is about a different system.

### Two things worth fixing while you are in there

**`STRIPE_SECRET_KEY` is scoped to Development.** Anyone who runs `vercel env
pull` on a laptop gets a live payment key on disk. It is needed at build and
runtime in Production and Preview; Development only needs it if somebody is
testing checkout locally, and then it should be a *test* key. Narrow the scope,
or point Development at `sk_test_`.

**The price variables are leftovers.** `STRIPE_PRICE_STARTER`, `_GROWTH` and
`_SCALE` are from the old Starter/Growth/Scale pricing. The plans are now Free,
Payroll and Suite, read from `STRIPE_PRICE_PAYROLL` and `STRIPE_PRICE_SUITE`
(`lib/billing.ts`). They are not secrets and leaking one costs nothing, but a
stale variable is a thing somebody will eventually wire up by mistake.

---

## Stripe secret key

Order matters. Stripe lets both keys work during the overlap, so nothing breaks
if you follow it — and everything breaks if you revoke first.

1. Stripe dashboard → Developers → API keys → **Roll** the secret key. Choose an
   expiry for the old key of **24 hours**, not immediate. That window is what
   makes this safe.
2. Copy the new key. Update it in Vercel for **Production and Preview**
   (`vercel env rm STRIPE_SECRET_KEY production`, then `add`, or use the
   dashboard). Decide the Development question above while you are there.
3. **Redeploy.** Environment changes do not reach running functions until a new
   deployment. `vercel --prod` or an empty commit.
4. Verify before the old key expires:
   - `GET /api/billing/status` as an admin returns the plan without erroring.
   - A checkout session can be created — the signup flow's paid path calls
     `stripe.checkout.sessions.create`.
   - Watch Stripe's dashboard for 401s on the old key. There should be none
     after the redeploy; if there are, something still holds it.
5. Let the old key expire.

## Stripe webhook secret

Separate from the API key and rotated separately. Getting this wrong is quieter
and worse: webhooks fail signature verification, the route answers 400, and
**companies stop being provisioned** while everything looks healthy.

1. Stripe dashboard → Developers → Webhooks → the `app.getvantro.com` endpoint →
   reveal / roll the signing secret.
2. Update `STRIPE_WEBHOOK_SECRET` in Vercel, all scopes that have it.
3. Redeploy.
4. Send a test event from the Stripe dashboard and confirm a 200. A 400 means
   the secret is wrong; `tests/security/c-input-handling.spec.ts` covers the
   refusal path, not the acceptance path, because accepting one needs a real
   signature.
5. Watch for failed webhook deliveries in Stripe for an hour. Stripe retries, so
   a brief mistake is recoverable — but only if somebody looks.

## Resend

1. Resend dashboard → API Keys → create a **new** key with sending permission.
   Do not delete the old one yet.
2. Update `RESEND_API_KEY` in Vercel (Production, Preview).
3. Redeploy.
4. Verify by sending a real email through the product: Settings → *Send this
   week's report now*. It returns the Resend message id in the response, so a
   success is provable rather than assumed.
5. Confirm the message id appears in the Resend dashboard under the **new** key.
6. Delete the old key.

---

## After any rotation

- Re-run the security suite: `npx playwright test --project=security`. E18 checks
  no secret is in the tree, the history or the client bundle; if a new key has
  been pasted somewhere it should not be, that is what catches it.
- Re-run the e2e suite: `npx playwright test --project=chromium`.
- Record the date here. The reason all three keys are ~6 months old is that
  nobody wrote down when they were made.

| Key | Last rotated | By |
|---|---|---|
| `STRIPE_SECRET_KEY` | *(never — created ~173 days before 17 Sep 2026)* | |
| `STRIPE_WEBHOOK_SECRET` | *(never — created ~169 days before)* | |
| `RESEND_API_KEY` | *(never — created ~176 days before)* | |
