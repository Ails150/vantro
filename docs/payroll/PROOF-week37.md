# Payroll proof — Northbridge Glazing Ltd, week 37

**Week 37 of 2026: Monday 7 September to Sunday 13 September.**
Produced 16 September 2026 from the live demo tenant, not from test fixtures.

Every figure below comes from rows in the database. The "app" column is computed
by `lib/pay.ts` — the engine the product ships — and the "by hand" column is
worked from the sign-in and sign-out times with a calculator. Where they differ,
it is flagged.

Reproduce with:

```bash
node --experimental-strip-types scripts/payroll-proof.mjs 37
```

---

## Read this first: four things the data shows

Before the arithmetic, because two of them change how you should read it.

### 1. Week 37 is **not** the demo's overtime week

The brief said "take the demo overtime week". The seed designates week index 2
of its six-week window as the long-hours week, and that is **week 34**
(163.9 hours across 15 shifts for these three). Week 37 is an ordinary week
(110.7 hours).

Week 37 is what this document covers, because that is the file that was asked
for, and it is a complete past week. It still exercises overtime: an 08:00–16:30
site day is 8.5 hours, so **every day crosses the 8-hour daily threshold**. If
you want the designated overtime week instead, the same script takes `34`.

### 2. Everybody is 90+ minutes "late", and it is a bug in the demo data

Every sign-in in week 37 lands between 09:00 and 09:10 London time, against a
site start of 08:00. The cause is in `scripts/seed-demo.ts`:

```js
function atLocal(day, hh, mm) {
  const d = new Date(day)
  d.setUTCHours(hh, mm, 0, 0)   // <-- UTC, not London
  return d
}
```

The seed builds each instant at the given hour **in UTC**. From late March to
late October the UK is on BST, so an intended 08:00 start is stored as 08:00Z
and reads as **09:00 local**. Every demo shift in summer is an hour later than
the seed means it to be.

Against the 07:30 start this brief specifies, that compounds: the lateness
column below reads 90–100 minutes for everyone, every day. **Roughly 60 of those
minutes are the seed's timezone bug and about 30 are the gap between the 07:30
rule and the 08:00 site start.** Neither is a person arriving late.

The lateness figures are printed as the engine computes them, because that is
what a proof is for — but do not read them as attendance.

**This does not touch pay.** Lateness is reporting-only by design (`dc602fd`): a
late worker has already been paid for fewer hours, and deducting again would
charge them twice. Every pay figure below is unaffected.

### 3. One worker has physically impossible hours

Not one of the three, but it is in the same Xero CSV and would go to the
accountant:

**Ellie Brandt, Monday 7 September — 26.30 hours in one day.**

| In | Out | Hours | Job |
|---|---|---|---|
| 08:30 | 17:05 | 8.58 | Riverside Mews, Ely |
| 09:00 | 17:37 | 8.62 | Eddington Court, Cambridge |
| 09:00 | 18:06 | 9.10 | Rowley Park, Newmarket |

She is the surveyor, seeded onto all three crews, and the seed gives her a full
shift on every site every day — concurrently, in three towns. Her week totals
**121.42 hours**.

Two separate problems:

- **The demo data is wrong.** Nobody works three overlapping shifts in
  Cambridge, Ely and Newmarket at once.
- **The product does not notice.** There is no overlap detection anywhere in the
  pay path. Concurrent sign-ins are summed, so a worker signed into two jobs at
  once is paid twice for the same hour, and the timesheet says 26.30. On real
  data this is a double-payment waiting to happen — a worker who forgets to sign
  out of yesterday's site, or a supervisor who signs somebody in from the wrong
  job screen.

Recommend both: fix the seed so the surveyor visits one site a day, and add an
overlap check to the pay path. The second is the one that matters.

### 4. Three of the configured rules never fire this week

| Rule | Set to | Hours it applied to |
|---|---|---|
| Saturday multiplier | 1.5 | **none** — the seed skips weekends entirely |
| Sunday multiplier | 2.0 | **none** — same |
| Bank holiday multiplier | 2.0 | **none** — no GB holiday falls in week 37 |

They are configured and tested (`tests/unit/pay-weekends.spec.ts`,
`pay-bank-holidays.spec.ts`), but this week cannot exercise them. A proof that
showed them working would have to invent a weekend shift, and inventing data is
the one thing a proof may not do.

There is a `2026-09-07` row in `public_holidays` — **US Labor Day**,
`country_code = "US"`. Northbridge is `GB`. The first version of the proof
script did not filter by country and would have paid all three workers **double
time for the Monday**. The application's own queries have always filtered
correctly (`app/api/admin/calendar/route.ts:92`, `app/api/location/route.ts:60`,
`app/api/admin/schedule-overview/route.ts:102`); the bug was in the proof, and
it is fixed. Worth knowing that the holiday table is multi-country and a missing
filter is a silent 2× on pay.

---

## Settings applied

Written to `pay_rules` for Northbridge, and to the three workers' `users` rows.

| Setting | Value |
|---|---|
| Shift start | 07:30 |
| Lateness grace | 5 minutes |
| Rounding | none |
| Unpaid break | **not set** — the brief did not specify one, so break minutes are 0 throughout |
| Daily overtime | over 8.00 h, at ×1.5 |
| Weekly overtime | over 40.00 h, at ×1.5 |
| Saturday | ×1.5 |
| Sunday | ×2.0 |
| Bank holiday | ×2.0 |
| Overtime approval | none — no approval step exists in the product, so this is the default and nothing was gated |

| Worker | Rate |
|---|---|
| Marcus Vane | £22.00/h |
| Priya Raman | £19.50/h |
| Tom Ashworth | £18.00/h |

### How the engine orders the rules

This is the order the arithmetic below follows, and it is fixed in
`payableHours()` and `splitWeek()`:

1. Unpaid break deducted from each shift — **not set here, so no change**
2. Rounding — **not set here, so no change**
3. Minimum paid shift — **not set here, so no change**
4. Enhanced days (bank holiday / Saturday / Sunday) removed from the week — **none this week**
5. **Daily** overtime taken out, day by day
6. **Weekly** overtime applied to what daily left behind
7. Bonuses added, untouched by any multiplier — **none this week**

Step 6 acting on the remainder from step 5 is what stops an hour being paid at
time and a half twice. It matters below.

---

## Marcus Vane — £22.00/h

### Shifts

| Date | Day | In | Out | Break | Late vs 07:30 | Worked | Paid |
|---|---|---|---|---|---|---|---|
| 2026-09-07 | Mon | 09:07 | 17:31 | 0 | 97 min | 8.40 | 8.40 |
| 2026-09-08 | Tue | 09:00 | 17:38 | 0 | 90 min | 8.63 | 8.63 |
| 2026-09-09 | Wed | 09:08 | 17:31 | 0 | 98 min | 8.38 | 8.38 |
| 2026-09-10 | Thu | 09:00 | 17:35 | 0 | 90 min | 8.58 | 8.58 |
| 2026-09-11 | Fri | 09:05 | 17:33 | 0 | 95 min | 8.47 | 8.47 |

Check the hours by hand:

```
Mon  09:07 → 17:31  =  8h 24m  =  8 + 24/60  =  8.40
Tue  09:00 → 17:38  =  8h 38m  =  8 + 38/60  =  8.6333  → 8.63
Wed  09:08 → 17:31  =  8h 23m  =  8 + 23/60  =  8.3833  → 8.38
Thu  09:00 → 17:35  =  8h 35m  =  8 + 35/60  =  8.5833  → 8.58
Fri  09:05 → 17:33  =  8h 28m  =  8 + 28/60  =  8.4667  → 8.47
```

Total worked = 8.40 + 8.63 + 8.38 + 8.58 + 8.47 = **42.46 h**

### Overtime

```
Daily, over 8.00 each day:
  Mon  8.40 - 8.00 = 0.40
  Tue  8.63 - 8.00 = 0.63
  Wed  8.38 - 8.00 = 0.38
  Thu  8.58 - 8.00 = 0.58
  Fri  8.47 - 8.00 = 0.47
  daily overtime            = 2.46 h

Remaining after daily:
  42.46 - 2.46              = 40.00 h

Weekly, over 40.00:
  40.00 - 40.00 = 0.00      → 0.00 h        (not over, so nothing)

Basic    = 42.46 - 2.46     = 40.00 h
Overtime = 2.46 h, all daily
```

Note the structure: with a 5-day week and an 8-hour daily threshold, removing
everything above 8 h/day always leaves exactly 5 × 8 = 40.00 h. The weekly
threshold is also 40, so it never bites. **This is the double-counting rule
doing its job.** Applying the weekly threshold to the raw 42.46 instead would
have produced 2.46 h of weekly overtime *on top of* the 2.46 h of daily
overtime — 4.92 overtime hours for a 42.46-hour week.

### Pay

```
Overtime rate = 22.00 × 1.5 = 33.00/h

Basic     40.00 h × £22.00 = £880.00
Overtime   2.46 h × £33.00 =  £81.18
Enhanced   0.00 h          =   £0.00
Bonus                      =   £0.00
                             ________
Total                        £961.18
```

| | App | By hand | Agrees |
|---|---|---|---|
| Basic | £880.00 | £880.00 | yes |
| Overtime | £81.18 | £81.18 | yes |
| **Total** | **£961.18** | **£961.18** | **yes** |

---

## Priya Raman — £19.50/h

Four shifts: no sign-in on Wednesday 9 September.

### Shifts

| Date | Day | In | Out | Break | Late vs 07:30 | Worked | Paid |
|---|---|---|---|---|---|---|---|
| 2026-09-07 | Mon | 09:10 | 17:37 | 0 | 100 min | 8.45 | 8.45 |
| 2026-09-08 | Tue | 09:03 | 17:38 | 0 | 93 min | 8.58 | 8.58 |
| 2026-09-10 | Thu | 09:09 | 17:36 | 0 | 99 min | 8.45 | 8.45 |
| 2026-09-11 | Fri | 09:00 | 17:33 | 0 | 90 min | 8.55 | 8.55 |

```
Mon  09:10 → 17:37  =  8h 27m  =  8.45
Tue  09:03 → 17:38  =  8h 35m  =  8.5833  → 8.58
Thu  09:09 → 17:36  =  8h 27m  =  8.45
Fri  09:00 → 17:33  =  8h 33m  =  8.55
```

Total worked = 8.45 + 8.58 + 8.45 + 8.55 = **34.03 h**

### Overtime

```
Daily, over 8.00:
  0.45 + 0.58 + 0.45 + 0.55 = 2.03 h

Remaining after daily:
  34.03 - 2.03              = 32.00 h

Weekly, over 40.00:
  32.00 is under 40.00      → 0.00 h

Basic    = 32.00 h
Overtime =  2.03 h
```

### Pay

```
Overtime rate = 19.50 × 1.5 = 29.25/h

Basic     32.00 h × £19.50 = £624.00
Overtime   2.03 h × £29.25 =  £59.3775  → £59.38
Bonus                      =   £0.00
                             ________
Total                        £683.38
```

The overtime line is the only rounding in this document. £59.3775 rounds to
£59.38 at the penny. The engine computes it in integer pence
(`round(2.03 × 2925) = 5938`) and gets the same answer.

| | App | By hand | Agrees |
|---|---|---|---|
| Basic | £624.00 | £624.00 | yes |
| Overtime | £59.38 | £59.38 | yes |
| **Total** | **£683.38** | **£683.38** | **yes** |

---

## Tom Ashworth — £18.00/h

Four shifts: no sign-in on Wednesday 9 September.

### Shifts

| Date | Day | In | Out | Break | Late vs 07:30 | Worked | Paid |
|---|---|---|---|---|---|---|---|
| 2026-09-07 | Mon | 09:00 | 17:35 | 0 | 90 min | 8.58 | 8.58 |
| 2026-09-08 | Tue | 09:00 | 17:39 | 0 | 90 min | 8.65 | 8.65 |
| 2026-09-10 | Thu | 09:06 | 17:36 | 0 | 96 min | 8.50 | 8.50 |
| 2026-09-11 | Fri | 09:08 | 17:38 | 0 | 98 min | 8.50 | 8.50 |

```
Mon  09:00 → 17:35  =  8h 35m  =  8.5833  → 8.58
Tue  09:00 → 17:39  =  8h 39m  =  8.65
Thu  09:06 → 17:36  =  8h 30m  =  8.50
Fri  09:08 → 17:38  =  8h 30m  =  8.50
```

Total worked = 8.58 + 8.65 + 8.50 + 8.50 = **34.23 h**

### Overtime

```
Daily, over 8.00:
  0.58 + 0.65 + 0.50 + 0.50 = 2.23 h

Remaining after daily:
  34.23 - 2.23              = 32.00 h

Weekly, over 40.00:
  32.00 is under 40.00      → 0.00 h

Basic    = 32.00 h
Overtime =  2.23 h
```

### Pay

```
Overtime rate = 18.00 × 1.5 = 27.00/h

Basic     32.00 h × £18.00 = £576.00
Overtime   2.23 h × £27.00 =  £60.21
Bonus                      =   £0.00
                             ________
Total                        £636.21
```

| | App | By hand | Agrees |
|---|---|---|---|
| Basic | £576.00 | £576.00 | yes |
| Overtime | £60.21 | £60.21 | yes |
| **Total** | **£636.21** | **£636.21** | **yes** |

---

## Summary

| Worker | Rate | Shifts | Worked | Basic h | OT h (daily) | OT h (weekly) | Enhanced h | Bonus | Total |
|---|---|---|---|---|---|---|---|---|---|
| Marcus Vane | £22.00 | 5 | 42.46 | 40.00 | 2.46 | 0.00 | 0.00 | £0.00 | **£961.18** |
| Priya Raman | £19.50 | 4 | 34.03 | 32.00 | 2.03 | 0.00 | 0.00 | £0.00 | **£683.38** |
| Tom Ashworth | £18.00 | 4 | 34.23 | 32.00 | 2.23 | 0.00 | 0.00 | £0.00 | **£636.21** |
| | | **13** | **110.72** | **104.00** | **6.72** | **0.00** | **0.00** | **£0.00** | **£2,280.77** |

**No discrepancies.** Every app figure matches the hand calculation to the penny.

---

## Xero export

Recorded in `payroll_exports`, one row per company per week, keyed on
`(company_id, xero_week_start)` so a re-export updates rather than duplicates.

- **Timesheet reference:** `VTR-TS-20260907`
- **Week start:** 2026-09-07
- **Employees:** 8
- **Sign-ins:** 46
- **Total hours:** 398.62

CSV at [`VTR-TS-20260907.csv`](VTR-TS-20260907.csv):

```csv
Employee,Email,Earnings Rate,Mon 07 Sept,Tue 08 Sept,Wed 09 Sept,Thu 10 Sept,Fri 11 Sept,Sat 12 Sept,Sun 13 Sept,Total
Danny Fitzgerald,demo+nb5@getvantro.com,Ordinary Hours,8.50,8.50,8.57,8.62,8.38,0.00,0.00,42.57
Ellie Brandt,demo+nb6@getvantro.com,Ordinary Hours,26.30,26.16,25.62,17.67,25.67,0.00,0.00,121.42
Joanne Petrie,demo+nb8@getvantro.com,Ordinary Hours,9.05,9.07,9.08,9.15,9.13,0.00,0.00,45.48
Marcus Vane,demo+nb1@getvantro.com,Ordinary Hours,8.40,8.63,8.38,8.58,8.47,0.00,0.00,42.46
Priya Raman,demo+nb2@getvantro.com,Ordinary Hours,8.45,8.58,0.00,8.45,8.55,0.00,0.00,34.03
Ravi Chaudhary,demo+nb7@getvantro.com,Ordinary Hours,9.02,0.00,9.07,9.12,9.05,0.00,0.00,36.26
Sian Okonjo,demo+nb4@getvantro.com,Ordinary Hours,8.50,8.50,8.02,8.53,8.62,0.00,0.00,42.17
Tom Ashworth,demo+nb3@getvantro.com,Ordinary Hours,8.58,8.65,0.00,8.50,8.50,0.00,0.00,34.23
```

### The CSV carries hours, not pay — and that is a gap

The Xero timesheet exports **worked hours only**, under a single
`Ordinary Hours` earnings rate. None of the pay rules reach it: the 6.72
overtime hours above are inside those totals and are not split out, and there is
no column for a rate, an overtime band, or a bonus.

So the £2,280.77 computed in this document **is not what the CSV tells Xero**.
Xero would apply its own earnings rates to flat hours and reach a different
figure. For the pay rules to mean anything downstream, the export needs an
`Overtime Hours` line per employee and, ideally, the bands as separate rows.
That is the next piece of work on this feature, and it is not built.

Ellie Brandt's 121.42 hours go into that CSV exactly as shown.

---

## What was written to the database

This proof is not read-only. Running the script:

- upserted `pay_rules` for Northbridge with the settings above
- set `hourly_rate` and `sign_in_time` (07:30) on the three workers
- upserted the `payroll_exports` row for week 37

All scoped to the demo tenant. No shift was created, modified or deleted.

## Files

| File | What it is |
|---|---|
| `scripts/payroll-proof.mjs` | Regenerates everything here |
| `docs/payroll/week37-data.json` | Full machine-readable output, every row |
| `docs/payroll/VTR-TS-20260907.csv` | The Xero timesheet as exported |
