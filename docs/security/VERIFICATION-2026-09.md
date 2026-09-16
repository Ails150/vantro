# Security verification pass — September 2026

The 24-test pass, finished. Every test is a Playwright spec under
`tests/security/` and runs in CI on every commit, so nothing here is a
point-in-time result.

**Seven real vulnerabilities were found and fixed.** Two of them were
authentication bypasses. One was introduced by a fix earlier in the same pass,
and one was introduced by me and caught by the suite before it reached anybody.

---

## The table

| # | Test | Result | Fix |
|---|---|---|---|
| A1 | Tenant isolation, admin session, every route | pass | — |
| A2 | Tenant isolation, field token | pass | — |
| A3 | **Signed media URLs** | **FAILED** | `40219d3` |
| A4 | Audit pack share links | pass | — |
| A5 | RLS with the anon key, every table | pass | — |
| A6 | Role escalation | pass | — |
| B7 | **PIN lockout, and the sign-in lookup** | **FAILED** | `b1f2160` |
| B8 | Field token forgery, tamper, `alg:none` | pass | — |
| B9 | **Magic links** | **FAILED** | `5189fde` |
| B10 | 2FA across the admin surface | pass | — |
| B11 | Anonymous access to every route | pass | — |
| C12 | Id fuzzing | pass | — |
| C13 | Text fields | pass | — |
| C14 | **File uploads** | **FAILED** | `41c32f7` |
| C15 | Webhook signatures | pass | — |
| D16 | Evidence append-only | pass (fixed earlier) | `db36f25` |
| D17 | Hash chain and merkle root | pass | — |
| E18 | Secrets in tree, history, client bundle | pass | — |
| E19 | Security headers, CSP | pass | — |
| E20 | Dependency audit | pass | — |
| F21 | Audit log coverage | pass | — |
| F22 | **What reaches Sentry** | **FAILED** | `4dbc12c` |
| F23 | **Rate limits** | **FAILED** | `e94703f`, `b1a0450`, `b6e0882` |
| F24 | Admin email change notice | n/a — no such feature | — |

---

## The seven findings

### 1. Any signed-in user could have any stored file signed for them — A3

`/api/media` took `path` from the query string and handed it to
`createSignedUrl` with the service role. The only check was "are you signed
in", so an administrator of one company could mint a working one-hour URL for
any object in the private media bucket — every site photograph, receipt, RAMS
PDF and QA image belonging to every other customer.

Proven against production before the fix: 200, with a signed URL that fetched
the file.

**Deleted rather than scoped.** Nothing called it — not the web app, not the
mobile app, not a script. The only references anywhere were Next's own
generated route types. There is also nothing to scope it against: a storage
path carries no ownership, which is why every legitimate signer derives the
path from a row it has already authorised.

### 2. An email address was used as a search pattern — B7

    POST /api/installer/auth  { "email": "...-%@vantro.test", "pin": "1234" }
    -> 200 { "token": "eyJhbGciOi..." }

A working 90-day field token for an account the caller could not name.

**Not SQL injection**, which is why it survived a read-through. PostgREST
parameterises everything and no quote ever escapes. What it does not do is stop
a value being interpreted as a *pattern*: `.ilike("email", input)` sends the
input as a LIKE pattern, where `%` means anything. The email was never a
filter. It was a search.

Everything protecting that route — the per-IP limit, the per-account limit, the
five-strike lockout, the single error message, the dummy bcrypt comparison for
constant timing — assumes the address identifies one row. The per-account limit
was even keyed on the submitted string, so every new pattern came with a fresh
allowance of guesses.

Five routes were affected. **`setup-pin` was the worst**: it sets a PIN on any
account that does not yet have one, so a pattern narrowing to a single PIN-less
installer was a complete account takeover with no credential and no knowledge
of who the victim was.

### 3. A real sign-in link could deliver the user to somebody else's site — B9

    NextResponse.redirect(`${origin}${next}`)

reads as safe: the origin is ours, only the tail is attacker-controlled. But
`@` separates userinfo from host, so `next=@evil.example.com` produces a URL
whose **host is evil.example.com** and whose username is `app.getvantro.com`.
Confirmed against production with a real magic-link token.

Free accounts have no password, so the magic link *is* the credential. The
phishing link is therefore a genuine Vantro sign-in link, sent by us, to the
right person, carrying a valid token. It signs them in and then hands them to
an attacker's page. Nothing in the URL is a lie.

Two more screens had the weaker `startsWith("/")` version, which admits
`//evil.example.com`. The third was found by the scanner added with the fix, on
its first run.

### 4. An upload chose its own object key — C14

`/api/upload` took the R2 object key from the request body. A field token was
enough to reach it, so any installer could write to any key in the bucket:

1. Overwrite another company's photograph, if the key could be guessed — and
   keys were `qa/<jobId>/<itemId>/photo_<timestamp>.jpg`.
2. Overwrite their own already-hashed evidence. Detectable, because the ledger
   is append-only, but the file is gone.
3. **Overwrite an issued audit pack's archive.** `CLOUDFLARE_R2_ARCHIVE_BUCKET`
   is not set in production — checked, not assumed — so the archive falls back
   to the same bucket under `audit-archive/<companyId>/`. The only reason a
   pack issued last year can still be verified was writable by any installer.

The route also wrote the client-declared `Content-Type` to a bucket with a
public URL, and had no size limit at all.

### 5. The web sent admin session cookies to the error tracker — F22

All three web Sentry configs shipped with `sendDefaultPii: true` — the setting
that sends request headers. On this product that means the `Cookie` header
carrying a complete working Supabase session, and the `Authorization` header
carrying a 90-day field token. `tracesSampleRate` was `1`, so it was never
limited to crashes: every request made a transaction and every transaction
carried them.

The **edge** config is the worst of the three, because it initialises Sentry
for middleware, which runs on every request in the product.

This is the same finding as the mobile app's, in the repository fixed second.
Finding it there and not looking here was the mistake.

### 6. The rate limiter did not limit — F23

Three bugs, in sequence, each found by the test written for the one before:

- It counted and then inserted as two round trips. Twelve concurrent requests
  got four through a limit of three. It held against a human clicking a button
  and dissolved against a script.
- Moving both into one plpgsql function did **not** fix it. A function body is
  not a critical section; at READ COMMITTED the `SELECT` takes a snapshot and
  locks nothing. The window shrank from milliseconds to microseconds — rare
  enough to look absent, fully available to a script.
- The advisory lock that fixed it made the queue real, so a burst on one key
  exceeded the client abort and the limiter **failed open under exactly the
  load it exists for**. Measured, not guessed: 30 concurrent checks, slowest
  1.64s against a 2s abort.

The table also had no index and no cleanup — every check was a sequential scan
over every hit ever recorded, on the hot path, getting slower daily.

### 7. My own rate limit would have stopped a site starting work — F23

Found by running the whole suite together rather than spec by spec.

`/api/installer/auth` carries no `Authorization` header — obtaining a credential
is what it is for — so every PIN sign-in landed in the anonymous bucket added
two commits earlier: 20 a minute per address. Twenty workers arriving at seven
in the morning behind one site's router would have been unable to start work.

That is the exact failure the IP ceiling was set to 600 to avoid. The trap went
back in one layer down, and the suite caught it before anybody hit it.

---

## What could not be tested from here, and why

- **What Sentry actually ingests.** That needs a Sentry API token the suite does
  not have. The scrubber is driven with the payload shapes the SDK produces and
  the configs are asserted to call it — the two halves that can fail
  independently — but nobody has watched the wire.
- **The mobile app on a real device.** Root detection, certificate pinning and
  the keystore are unit-tested; only a rooted handset with a proxy exercises
  them.
- **Rate limiting over real HTTP at the edge.** The only way to prove a limiter
  over HTTP is to send enough traffic to trip it, and there is nowhere good to
  send it: against production it is a denial of service on paying customers,
  against a dev server it proves a dev server was running. The gate is driven
  as a function instead, with a source assertion tying it to the request path.
- **Cloud dashboard configuration** — Supabase, Cloudflare, and the Google API
  key restrictions. Not reachable from a runner.
- **F24, the admin email change notice.** There is no email-change feature. The
  test that exists fails the day somebody adds one without the notice.

## A residual, stated rather than closed

The field sign-in has a `checkOnly` branch that answers "does this address have
an account". Everything else in that route works to avoid disclosing exactly
that — one error message, one status code, a dummy bcrypt comparison so the
timing matches.

It cannot be closed on the server: the app uses it to choose between "enter your
PIN" and "set one up", and a worker at a site gate shown the wrong one is stuck.
Closing it means always asking for the PIN and offering setup on failure, which
is a mobile change.

What is fixed is the sweep. Each address now costs the same budget as a sign-in
attempt, so a list cannot be walked from rotating IPs.

## Where it stands

**206 tests, all passing, run against production.** Plus 401 unit tests in the
web repo and 63 in the mobile repo.

## Six tests that were wrong, and what about

Worth recording at least as much as the findings. A security suite that cries
wolf gets switched off, and this one cried wolf six times — twice while
accusing code that was working perfectly.

1. **B7 accused a working lockout, three times.** Three controls on that route
   all answer "no" and the spec could not tell them apart: the per-address
   limiter, the per-IP limiter, and the lockout itself. The third attempt failed
   because the address `api.ipify.org` reports is not necessarily the one the
   server saw — the two connections can take different families.
2. **C13 asserted the API escapes `<` as `<`.** It does not, and does not
   need to: inside `application/json` a script tag is four characters of string
   data. That was an implementation detail wearing a security test's clothes.
3. **B9 asserted `@evil.example.com` comes back as the fallback.** It comes back
   as `/@evil.example.com` — a path on our own origin, and safe, because the
   leading slash is exactly what the bug was missing. The test asserted a
   particular implementation and would have failed a correct fix.
4. **Two scanners flagged their own fixes** for quoting the vulnerable call in
   order to explain it. A scanner that flags the fix for describing the bug is
   one somebody disables.
5. **C15 tripped the control it was there to protect.** It sends bad signatures
   on purpose, and the webhook now counts exactly that — ten an hour, because
   Stripe's signature does not fail to verify. Run as part of the whole suite it
   exhausted the bucket, got 429 where it expected 400, and reported the
   signature check broken. Two controls that both answer "no" have to be taken
   apart before either can be measured.
6. **A1 accused four routes of a cross-tenant leak, twice, for different
   reasons.** First it attacked with `TENANT_B.id` and also treated that id as
   evidence, so any route echoing back the id it was given scored as a
   disclosure — intermittently, since whether a route echoes depends on which
   validation path it takes. Then, with that fixed, it failed every run on
   "[TEST] Kev Armstrong" being returned by `/api/admin/team`.

   Kev Armstrong works for ten companies. The two test tenants were built from
   the same generated name list: forty of tenant B's forty-one worker names
   also exist in tenant A. Markers are identifiers only now — a uuid, or a
   string the spec generated itself — and the sweep creates a witness row whose
   id and name are never sent, so a marker coming back could only have come
   from reading the other tenant.
