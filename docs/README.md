# Vantro Database Schema

Single source of truth for the Vantro Supabase schema.

## Files

| File | Purpose |
|---|---|
| `schema.sql` | The introspection query. Copy/paste into Supabase SQL Editor. |
| `schema.csv` | The dump output. Replace whenever schema changes. |

## Rule

**Before building any feature that touches a new table, read `schema.csv`.**

This is what prevents the trial-and-error rework loops we hit on
30 Apr 2026 (Patches 2.1, 2.2, 5.1, 5.4, M1.5 — 4+ hours lost to wrong
column names that would have been visible here).

## How to refresh

1. Open `schema.sql`, copy the SQL
2. Paste into Supabase SQL Editor: <https://supabase.com/dashboard/project/lmobuqxmtkctqqwbspoz/sql>
3. Click Run
4. Click **Export → Download CSV**
5. Save to `docs/schema.csv` (overwrite)
6. Commit:

```bash
git add docs/schema.csv
git commit -m "chore(schema): refresh schema dump"
```

## When to refresh

- **Always** after a migration or `ALTER TABLE`
- **Weekly** as a habit (every Friday) so it never drifts more than 7 days
- **Before** any feature touches an unfamiliar table
