# Production deploy checklist

Run top to bottom. Any gate that is not green stops the deploy.

## Before the push

1. `git status` clean, or every untracked file accounted for. `vantro.env.local`
   is ignored as of 2026-09-07; `.env*` does not match that name, so check any
   new env-shaped file is actually covered before `git add -A`.
2. List what is ahead of master. `git branch` alone does not tell you — a branch
   can be 0 ahead and fully merged:
   ```
   for b in $(git for-each-ref --format='%(refname:short)' refs/heads); do
     echo "$b  ahead=$(git rev-list --count master..$b)"
   done
   ```
3. Check for work that exists only as untracked files. This has bitten us once:
   the PAYG credit migrations sat untracked from 2 Sep to 7 Sep and no merge
   would ever have picked them up. `git status --porcelain -uall`.
4. Migrations. `npx supabase migration list --linked` — every local must have a
   remote. `npx supabase db push --linked --dry-run` must say `upToDate: true`.
   - The CLI only knows `supabase/migrations/`. Files in the older top-level
     `migrations/` were hand-run and have no push history; verify those against
     the live schema directly, not with the CLI.
   - If the CLI fails to parse `.env.local`, it aborts *before connecting* and
     prints one line of JSON. That is not evidence a migration is missing.
5. `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit` → exit 0. The
   raised heap is required; plain `tsc` OOMs on this repo.
6. `npm run build` → exit 0.
7. Record the current production deployment so a rollback target exists:
   `npx vercel inspect app.getvantro.com` — note the deployment URL and id.

## The push

`git push origin master`, then wait for that commit's Vercel deploy to reach
Ready. A push is not done until the deploy is green.

## Smoke test

Run against https://app.getvantro.com on the new build. Report each line pass or
fail.

| # | Check |
|---|---|
| 1 | Admin login loads the Apexify dashboard |
| 2 | Open one Apexify job |
| 3 | Mark complete succeeds |
| 4 | Generate Audit Pack — Internal view opens, evidence hash on page one |
| 5 | Generate Audit Pack — Client view opens, evidence hash on page one |
| 6 | Generate Audit Pack — Compliance view opens, evidence hash on page one |
| 7 | PAYG credit balance visible in billing |

### Known fail: line 7

`/billing` is a static "Your trial has ended" paywall. The credits schema is
live on the database (`audit_credits`, `audit_credit_ledger`,
`consume_audit_credit()`), but no application code reads it — `grep -ri credit
app/billing/` is empty. The UI was never built. **Do not roll back for line 7.**
It fails identically on every build, old and new.

### Rollback

Roll back if line 3 fails, or if any of lines 4-6 fail:

```
npx vercel rollback <previous-deployment-url> --yes
npx vercel inspect app.getvantro.com     # confirm the alias moved back
```

## Notes carried from the Phase 1 audit work

Lines 4-6 are the real risk on any deploy touching the audit pack. The
append-only triggers, evidence hashing and manifest signing were verified as
*schema* only — as of commit `a4d6894` nothing had been observed firing on a
live write. Generating a pack is the first thing that exercises them.

---

# Run log

## 2026-09-07 — audit-pack-v2 Phase 0 + Phase 1 to production

**Shipped:** `15cca75..f81335b` (28 commits). Final deployment
`vantro-trvx0coa9` / `dpl_6cxRTeAos1brvhxq7zGVVjS4PDok`, Ready.
Gates before push: `tsc --noEmit` exit 0, `npm run build` exit 0, all four
`supabase/migrations` applied, `db push --dry-run` reported `upToDate: true`.

**Smoke test: PASS** (reported by the operator running the browser).

| # | Check | Result |
|---|---|---|
| 1 | Admin login loads the Apexify dashboard | pass |
| 2 | Open one Apexify job | pass — Kentford |
| 3 | Mark complete succeeds | pass |
| 4-6 | Audit Pack views | pass — Compliance pack **VTR-2026-9B052A71** generated, integrity section and signature present |
| 7 | PAYG credit balance visible in billing | **known fail**, as expected — see above |

Lines 1-3 and the Compliance pack were confirmed directly. The Internal and
Client views were covered by the operator's overall pass rather than reported
individually; if that distinction matters to you, re-run those two.

**This was the first audit pack generated since the Phase 1 migrations landed.**
Manifest signing and the Merkle root had never executed in production before
this run -- `a4d6894` and `60f5be2` had verified the schema and the triggers on
live data, but no pack had been produced. VTR-2026-9B052A71 is the first
end-to-end proof. The §6 registered-pack block finally has a real subject.

### What cost the most time, and what to check first next time

**Check which company you are signed in as before debugging anything.** Roughly
an hour went into a paywall that was not a bug: the session was signed in as the
I-Glaze admin while the flag was being set on Apexify. `AuditTab` was rendering
correctly for the company actually being viewed. `/api/debug/whoami` was built
to answer this and deleted afterwards; the cheap version is to confirm the
company name in the UI first.

**A missing PaywallOverlay does not prove `company` is null.** It was read that
way during this deploy and the reading was wrong: `notActive` is only
`!status || 'trial' || 'cancelled' || 'past_due'`, so a company on
`pending_card` correctly shows no overlay with a perfectly normal company row.

**`vercel logs` on this project cannot see `console.log`.** It returns
request-level entries with `source: "edge-middleware"` and an empty `logs`
array. Server-side diagnosis needs an endpoint that returns JSON, not stdout.

**`supabase db query` does not exist.** The `db` subcommands are `diff`, `dump`,
`push`, `pull`, `reset`. For ad-hoc reads and writes use PostgREST with the
service role key, scoped by primary key. `db dump` needs Docker.

**Deleting a route breaks the typecheck until you clear the generated
validators.** Remove `.next/types/validator.ts` and `.next/dev/types/validator.ts`.

### Open items from this deploy

- `cec2104` changed the admin page to read `companies` with the service client.
  Its commit message states there is no SELECT policy on `public.companies` for
  the authenticated role. **That was never confirmed** and the I-Glaze finding
  removes the evidence for it. Check the actual policies before trusting it.
- Apexify `00695d96` carries three hand-edits from this session:
  `ai_audit_enabled` false -> true, `subscription_status` cancelled -> active,
  `trial_ends_at` 2026-06-05 -> 2027-06-29. The last two disagree with Stripe,
  where `sub_1TRTPnEduionOKenQC34R0hP` is cancelled. Any
  `customer.subscription.*` webhook will overwrite both and set
  `ai_audit_enabled` back to false (`webhook/route.ts:94`).
- `public.companies` has RLS on and no policy defined in any migration in this
  repo -- they were set by hand in the Supabase dashboard. Worth an audit.
