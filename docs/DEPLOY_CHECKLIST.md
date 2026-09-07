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
