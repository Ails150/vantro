# Holiday and time off

How a worker asks for time off, where it lives, and which endpoint owns which
number. Written because a second holiday system was nearly built alongside this
one; if you are about to add `/api/holidays`, read this first.

## There is one system, and it is called time off

Holiday is one `type` among several in a single feature. There is no separate
holiday table, route, or balance. Annual leave, sick, personal, bereavement,
training, unpaid and unavailable are all rows in `time_off_entries`,
distinguished by `type`.

Anything written outside these tables will not reach the manager: approval, the
admin calendar, team scheduling, time reports, the scheduling resolver and the
notification engine all read `time_off_entries` and nothing else.

## Tables

Created directly in Supabase, not by a migration in this repo, so the column
names below are the contract. Get one wrong and the query silently returns
nothing rather than failing (see Gotchas).

| Table | Holds |
| --- | --- |
| `time_off_entries` | One row per request. `user_id`, `company_id`, `type`, `status`, `start_date`, `end_date`, `is_half_day`, `half_day_period`, `notes`, `requested_by`, `approved_at`, `approved_by`, `rejection_reason` |
| `leave_allowances` | Per user, per leave year. **`total_days`**, **`carried_over_days`**, `leave_year_start`, `leave_year_end` |
| `country_configs` | Keyed on **`country_code`**. `default_holiday_days`, `leave_year_start_month`, `leave_year_start_day` |
| `public_holidays` | `country_code`, `holiday_date`, `name` |

`status` is `pending`, `approved`, `rejected` or `cancelled`. Sick leave is
inserted as `approved` when the company has `sick_auto_approve` set; everything
else starts `pending`.

## Endpoints

### Worker (field token, `verifyFieldToken`)

| Route | Purpose |
| --- | --- |
| `GET /api/installer/calendar-context` | Everything the request screen needs in one call: leave year, balance, the worker's own entries, anonymised team counts per day, public holidays, weekly schedule, assigned visits. **This is what the mobile request flow uses.** |
| `GET /api/installer/time-off` | The worker's own entries, most recent first, capped at 50 |
| `POST /api/installer/time-off` | Create a request |
| `GET /api/installer/time-off/balance` | Balance on its own, for callers that do not need the whole calendar |

### Manager

| Route | Purpose |
| --- | --- |
| `GET /api/admin/time-off` | The approval queue |
| `PATCH /api/admin/time-off/[id]` | Approve or reject |

`POST /api/installer/time-off` returns **409** with `code: "overlap"` and a
`conflict` object when the range meets an existing `pending` or `approved`
request. Clients must handle it; it is the expected answer to a double
submission, not a failure.

## The mobile flow

`C:\vantro-mobile`, `app/(installer)/schedule-request/`, three steps:

1. `type.tsx` - what kind of time off
2. `calendar.tsx` - pick a range against `calendar-context`; shows the standing
   balance, marks public holidays, blocks days already spoken for, and refuses
   to continue past the balance
3. `confirm.tsx` - optional half day and note, then `POST /api/installer/time-off`

Entry point: Schedule tab.

## Which number comes from where

`balance.entitlement` is `leave_allowances.total_days + carried_over_days` for
the current leave year, falling back to `country_configs.default_holiday_days`,
falling back to 28.

`balance.used` is approved annual leave only. `balance.pending` is the same for
pending. `balance.remaining` nets off **both**, because a request already with
the manager is spent as far as the next request is concerned.

The leave year comes from the company's `leave_year_start_month` /
`leave_year_start_day`, else the country's, else 1 April.

## Gotchas

**A wrong column name fails silently.** These queries use `maybeSingle()`, so a
column that does not exist returns null rather than raising, and the code falls
through to a default that looks plausible. `calendar-context` asked for
`days_total` (the column is `total_days`) and keyed `country_configs` on `code`
(it is `country_code`). Both resolved to nothing, so the request screen showed
every worker the hard coded 28 day fallback regardless of their real allowance -
and the guard that blocks an over balance request was measuring against it. Fixed
now; the shape of the bug is worth remembering.

**Days are counted as calendar days, not working days.** A Friday to Monday
request costs 4 days, not 2. Weekends and public holidays inside a range are
included, even though public holidays are fetched and shown on the calendar. The
server and the app agree with each other, so the arithmetic is at least
consistent - but it is very likely not what a worker expects, and it is a
deliberate open question rather than an oversight. Changing it means changing
`countDays` in `calendar-context`, `daysBetween` in `time-off/balance`, and
`countDays` in the mobile calendar screen together, and deciding what to do about
already approved rows counted the old way.

**Half days are 0.5 and must be a single day.** `is_half_day` with
`start_date !== end_date` is rejected.

## If you are adding to this

Add a `type`, or a field on `time_off_entries`. Do not add a parallel table: the
approval queue, calendar, resolver and notification engine will not see it, and
the balance will disagree with the admin dashboard depending on which endpoint
you ask.
