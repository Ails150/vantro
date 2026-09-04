# Two migration directories, and which one is authoritative

`supabase/migrations/` — **CLI-managed, and where new migrations go.**
Applied with `npx supabase db push --linked`. Filenames must be
`<14-digit timestamp>_name.sql`; the CLI records each one in the remote
`supabase_migrations.schema_migrations` table, so `supabase migration list
--linked` will tell you what has actually run. The first file here is
`20260904000000_jobs_completed_by.sql`.

`migrations/` (this directory) — **historical, hand-run.** Every file here was
pasted into the Supabase SQL editor by a human. The database has no record of
which ones ran or when, and `supabase migration list --linked` reported an
empty remote history on 2026-09-04, before the first push. Treat these as a
changelog, not as a replayable sequence. `20260901_baseline_existing_tables.sql`
is the closest thing to a schema snapshot, generated from the live PostgREST
description on 2026-09-01 -- but read its header for what it cannot see
(constraints, indexes, triggers, RLS).

Do not add new files here. Nothing back-fills these into the CLI's history, so a
`db push` will not skip them; running the two directories as one sequence
against a fresh database would need the history repaired first
(`supabase migration repair`).

## Note on `supabase db push` in this repo

The CLI's config loader parses `.env.local` and fails on it:

```
LegacyDbConfigLoadError: failed to parse environment file: .env.local
```

The file's first four lines are pasted prose (`notepad C:\vantro\.env.local`,
a fenced block, "Paste this in, save it, leave it open:"). Next.js's dotenv
parser skips lines with no `=`, which is why the app has never noticed. Delete
those four lines and the CLI works from the repo root. Until then, pass
`--workdir` pointing at a directory that holds only a copy of `supabase/`.
