# Payroll proof — Northbridge Glazing Ltd, week 37

**Week 37 of 2026: Monday 7 September to Sunday 13 September.**
Regenerated 16 September 2026 from the live demo tenant, not from fixtures.

Every figure comes from rows in the database. The "app" column is computed by
`lib/pay.ts` and `lib/payroll-export.ts` — the code the product ships — and the
"by hand" column is worked from the sign-in and sign-out times with a
calculator. Where they differ, it is flagged.

```bash
npx tsx scripts/payroll-proof.mjs 37
```

> **This is the second run.** The first found four defects, three of which are
> now fixed. The totals changed by 41p in the process, and that change is
> explained under *The 41p* below — it was a bug, not a correction to the data.

---

## Totals

| Worker | Rate | Worked | Basic | Overtime | Bonus | Total |
|---|---|---|---|---|---|---|
| Marcus Vane | £22.00 | 42 h 28 m | 40 h 00 m | 2 h 28 m | £0.00 | **£961.40** |
| Priya Raman | £19.50 | 34 h 02 m | 32 h 00 m | 2 h 02 m | £0.00 | **£683.48** |
| Tom Ashworth | £18.00 | 34 h 14 m | 32 h 00 m | 2 h 14 m | £0.00 | **£636.30** |
| | | **110 h 44 m** | **104 h 00 m** | **6 h 44 m** | **£0.00** | **£2,281.18** |

**The CSV total row reads £2,281.18.** It matches this document exactly, which
is the thing the first run could not do.

---

## The 41p

The first run of this proof reported £2,280.77. The correct figure is
£2,281.18. The data did not change; the arithmetic was wrong, in the product.

`splitOvertime()` rounded hours to two decimal places before the rate was
applied. Two decimals of an hour is 36 seconds. Marcus worked **148 minutes** of
overtime, which is 2.4667 hours — rounded to 2.46 down one code path and 2.47
down another, and priced from the rounded figure either way.

The proof is what found it: the per-worker page said 2.46 and the CSV said 2.47
for the same worker in the same week. Two answers from one codebase is a defect
whichever is right.

The fix is the rule money already followed in this engine: **carry full
precision through the arithmetic and round once, on the pounds, at the end.**
Hours are now unrounded internally and rounded only for display. Every figure
below is priced from exact minutes.

Per person it is pennies a week. Across a workforce and a year it is not, and it
moved in whichever direction the rounding happened to fall, which is worse than
moving consistently.

---

## Read this first

### 1. Week 37 is not the demo's designated overtime week

The seed marks week index 2 of its six-week window as the long-hours week, which
is **week 34** (163.9 h across 15 shifts for these three). Week 37 is an ordinary
week. It still exercises overtime, because an 08:00–16:30 site day is 8.5 hours
and crosses the 8-hour daily threshold every day.

`npx tsx scripts/payroll-proof.mjs 34` produces the other one.

### 2. Lateness now reads true — but not in this data yet

The seed's `atLocal()` built every instant with `setUTCHours`, so from late March
to late October an intended 08:00 start was stored as 08:00Z and read back as
09:00 London. Every summer demo shift was an hour later than the seed meant, and
every worker looked 60+ minutes late.

**That is fixed in `scripts/seed-demo.ts`** — `atLocal()` now derives the London
offset and corrects for it.

**The rows below still carry the old times.** Re-seeding has to be done from the
superadmin Settings button rather than from a laptop: `AUDIT_SIGNING_KEY` lives
in the Vercel environment, and seeding without it rebuilds the demo with an
*unsigned* compliance pack, which defeats the point of having one. Editing the
existing rows in place was rejected too — `signins` carries append-only evidence
triggers, and rewriting them would raise `amended` hash rows and make the demo
tenant look tampered with.

So the lateness column reads 90–100 minutes. Roughly 60 of those are the old
timezone bug and about 30 are the real gap between the 07:30 rule and the 08:00
site start. **Load the demo again and it will read true.**

Lateness does not touch pay either way — it is reporting-only by design.

### 3. The overlap guard is working, on the exact data that prompted it

Ellie Brandt, the surveyor, is seeded onto all three crews and given a full
concurrent shift on each — Cambridge, Ely and Newmarket at once. Last run she
reached the timesheet at **121.42 hours**, with 26.30 on the Monday.

This run:

| | Before | Now |
|---|---|---|
| Hours on the timesheet | 121.42 | **46.75** |
| Shifts trimmed | — | 9 |
| Hours removed | — | 74.65 |
| Flagged on the CSV | no | **yes** |

Each minute is now counted once. Where two shifts cover the same minute it goes
to the one that **started first**, and the later shift is trimmed — first-come
being the only rule that is stable, explainable in a sentence, and independent
of which job pays more.

Nothing was deleted or edited. The shifts are exactly as recorded; this changes
only what is paid, and the CSV carries `Overlap Trimmed = yes` on every line of
an affected worker so nobody has to guess why the hours are lower than the
shifts add up to.

The seed is also fixed — the surveyor now visits one site a day — and a nightly
job (`/api/cron/overlap-check`) raises an admin alert for any worker with
concurrent open shifts or overlapping records.

### 4. Three configured rules still never fire

Saturday ×1.5, Sunday ×2.0 and Bank Holiday ×2.0 are set and tested, but the
seed skips weekends and no GB holiday falls in week 37. Showing them working
would mean inventing a shift.

`public_holidays` does hold `2026-09-07` — **US Labor Day**, `country_code = US`.
Northbridge is `GB`. An unfiltered read would have paid all three double time
for the Monday. The application filters correctly everywhere; the first version
of this script did not, and now does.

---

## Settings applied

| Setting | Value |
|---|---|
| Shift start | 07:30 |
| Lateness grace | 5 minutes |
| Rounding | none |
| Unpaid break | not set — break minutes are 0 throughout |
| Daily overtime | over 8 h, ×1.5 |
| Weekly overtime | over 40 h, ×1.5 |
| Saturday / Sunday / Bank holiday | ×1.5 / ×2.0 / ×2.0 |
| Overtime approval | none — no approval step exists, so nothing is gated |

| Worker | Rate |
|---|---|
| Marcus Vane | £22.00/h |
| Priya Raman | £19.50/h |
| Tom Ashworth | £18.00/h |

### Order of operations

1. Overlapping minutes removed — each instant to the earliest shift
2. Unpaid break — not set
3. Rounding — not set
4. Minimum paid shift — not set
5. Enhanced days (bank holiday / Saturday / Sunday) taken out of the week — none this week
6. **Daily** overtime taken out, day by day
7. **Weekly** overtime applied to what daily left behind
8. Bonuses added, untouched by any multiplier — none this week

Step 7 acting on the remainder of step 6 is what stops an hour being paid at
time and a half twice.

---

## Marcus Vane — £22.00/h

| Date | Day | In | Out | Break | Late vs 07:30 | Worked |
|---|---|---|---|---|---|---|
| 2026-09-07 | Mon | 09:07 | 17:31 | 0 | 97 min | 8 h 24 m |
| 2026-09-08 | Tue | 09:00 | 17:38 | 0 | 90 min | 8 h 38 m |
| 2026-09-09 | Wed | 09:08 | 17:31 | 0 | 98 min | 8 h 23 m |
| 2026-09-10 | Thu | 09:00 | 17:35 | 0 | 90 min | 8 h 35 m |
| 2026-09-11 | Fri | 09:05 | 17:33 | 0 | 95 min | 8 h 28 m |

```
Worked, in minutes:
  Mon  09:07 → 17:31  =  504 m
  Tue  09:00 → 17:38  =  518 m
  Wed  09:08 → 17:31  =  503 m
  Thu  09:00 → 17:35  =  515 m
  Fri  09:05 → 17:33  =  508 m
                        ------
                        2548 m   = 42 h 28 m

Daily overtime, anything over 8 h (480 m) in a day:
  504 - 480 =  24 m
  518 - 480 =  38 m
  503 - 480 =  23 m
  515 - 480 =  35 m
  508 - 480 =  28 m
                148 m   = 2 h 28 m

Remaining after daily:   2548 - 148 = 2400 m = 40 h 00 m
Weekly, over 40 h:       2400 is exactly 40 h, so nothing

Basic     2400 m = 40.0000 h
Overtime   148 m =  2.4667 h
```

```
Overtime rate = 22.00 × 1.5 = 33.00

Basic     40.0000 h × £22.00 = £880.00
Overtime   2.4667 h × £33.00 =  £81.40    (148 ÷ 60 × 33 = 81.40)
                                _______
Total                            £961.40
```

| | App | By hand | Agrees |
|---|---|---|---|
| Basic | £880.00 | £880.00 | yes |
| Overtime | £81.40 | £81.40 | yes |
| **Total** | **£961.40** | **£961.40** | **yes** |

Note that basic lands on exactly 40 h. That is structural, not luck: five days
with everything above 8 h removed leaves exactly 5 × 8 = 40. The weekly
threshold is also 40, so it never bites — which is the double-counting rule
working. Applying the weekly threshold to the raw 42 h 28 m instead would have
produced another 2 h 28 m of overtime on top of the daily 2 h 28 m.

---

## Priya Raman — £19.50/h

Four shifts: nothing on Wednesday 9 September.

| Date | Day | In | Out | Break | Late vs 07:30 | Worked |
|---|---|---|---|---|---|---|
| 2026-09-07 | Mon | 09:10 | 17:37 | 0 | 100 min | 8 h 27 m |
| 2026-09-08 | Tue | 09:03 | 17:38 | 0 | 93 min | 8 h 35 m |
| 2026-09-10 | Thu | 09:09 | 17:36 | 0 | 99 min | 8 h 27 m |
| 2026-09-11 | Fri | 09:00 | 17:33 | 0 | 90 min | 8 h 33 m |

```
Worked:   507 + 515 + 507 + 513 = 2042 m = 34 h 02 m

Daily overtime over 480 m:
  27 + 35 + 27 + 33            =  122 m =  2 h 02 m

Remaining:  2042 - 122         = 1920 m = 32 h 00 m
Weekly, over 40 h:  32 h is under, so nothing

Basic     1920 m = 32.0000 h
Overtime   122 m =  2.0333 h
```

```
Overtime rate = 19.50 × 1.5 = 29.25

Basic     32.0000 h × £19.50 = £624.00
Overtime   2.0333 h × £29.25 =  £59.48    (122 ÷ 60 × 29.25 = 59.475 → 59.48)
                                _______
Total                            £683.48
```

The only rounding in this document. £59.475 rounds half up to £59.48; the engine
computes it in integer pence and reaches the same answer.

| | App | By hand | Agrees |
|---|---|---|---|
| Basic | £624.00 | £624.00 | yes |
| Overtime | £59.48 | £59.48 | yes |
| **Total** | **£683.48** | **£683.48** | **yes** |

---

## Tom Ashworth — £18.00/h

Four shifts: nothing on Wednesday 9 September.

| Date | Day | In | Out | Break | Late vs 07:30 | Worked |
|---|---|---|---|---|---|---|
| 2026-09-07 | Mon | 09:00 | 17:35 | 0 | 90 min | 8 h 35 m |
| 2026-09-08 | Tue | 09:00 | 17:39 | 0 | 90 min | 8 h 39 m |
| 2026-09-10 | Thu | 09:06 | 17:36 | 0 | 96 min | 8 h 30 m |
| 2026-09-11 | Fri | 09:08 | 17:38 | 0 | 98 min | 8 h 30 m |

```
Worked:   515 + 519 + 510 + 510 = 2054 m = 34 h 14 m

Daily overtime over 480 m:
  35 + 39 + 30 + 30            =  134 m =  2 h 14 m

Remaining:  2054 - 134         = 1920 m = 32 h 00 m
Weekly:     under 40 h, nothing

Basic     1920 m = 32.0000 h
Overtime   134 m =  2.2333 h
```

```
Overtime rate = 18.00 × 1.5 = 27.00

Basic     32.0000 h × £18.00 = £576.00
Overtime   2.2333 h × £27.00 =  £60.30    (134 ÷ 60 × 27 = 60.30)
                                _______
Total                            £636.30
```

| | App | By hand | Agrees |
|---|---|---|---|
| Basic | £576.00 | £576.00 | yes |
| Overtime | £60.30 | £60.30 | yes |
| **Total** | **£636.30** | **£636.30** | **yes** |

**No discrepancies.** Every app figure matches the hand calculation to the penny.

---

## The export

`payroll_exports` holds one row per company per week, keyed on
`(company_id, xero_week_start)`, so a re-export updates rather than duplicates.

- **Reference:** `VTR-TS-20260907`
- **Week start:** 2026-09-07
- **Employees:** 8
- **Total pay:** **£2,281.18**

One line per worker **per pay type**, each with hours, rate and amount:

```csv
Employee,Email,Earnings Rate,Hours,Rate,Amount,Mon 07 Sept,...,Sun 13 Sept,Overlap Trimmed
Marcus Vane,demo+nb1@getvantro.com,Ordinary Hours,40.00,22.00,880.00,8.00,...,0.00,
Marcus Vane,demo+nb1@getvantro.com,Overtime 1.5,2.47,33.00,81.40,0.40,...,0.00,
Priya Raman,demo+nb2@getvantro.com,Ordinary Hours,32.00,19.50,624.00,8.00,...,0.00,
Priya Raman,demo+nb2@getvantro.com,Overtime 1.5,2.03,29.25,59.48,0.45,...,0.00,
Tom Ashworth,demo+nb3@getvantro.com,Ordinary Hours,32.00,18.00,576.00,8.00,...,0.00,
Tom Ashworth,demo+nb3@getvantro.com,Overtime 1.5,2.23,27.00,60.30,0.58,...,0.00,
...
TOTAL,,,,,2281.18,,,,,,,,
```

Full file: [`VTR-TS-20260907.csv`](VTR-TS-20260907.csv).

The `Hours` column is rounded to two decimals **for display only** — 2.47 is the
display of 2.4667, and the `Amount` is priced from the exact figure. That is why
2.47 × 33.00 appears to be 81.51 but the file says 81.40. The amount is right;
multiplying the displayed hours by the displayed rate is not how the line was
computed, and `XERO-SETUP.md` says so.

Five of the eight employees show a blank rate and £0.00: they have no
`hourly_rate` and the company has no default set. Their **hours are still
exported** — an unpriced worker must appear on the timesheet, not vanish from it.

### What Xero will and will not do with this

**Xero timesheet lines carry units against a named earnings rate. They do not
carry a rate.** The money is decided inside Xero by the employee's pay template
and by how the earnings rate is configured — overtime is set up as *Multiple of
Employee's Ordinary Earnings Rate* with a multiplier of 1.5, and Xero
multiplies.

So the `Rate` and `Amount` columns are **not instructions to Xero**. They are
what makes the file reconcilable by a person, and what lets somebody confirm
Xero reached the same number.

**Xero Payroll UK also has no native timesheet CSV import.** It is a standing
feature request. Timesheets reach Xero through the Payroll API or a third-party
bridge. This file is therefore the reconciliation document a bookkeeper reads,
and the source a bridge maps to timesheet lines.

For Xero to reach £2,281.18 the earnings rates have to exist and be configured —
see [`XERO-SETUP.md`](XERO-SETUP.md).

---

## What was written to the database

- `pay_rules` upserted for Northbridge with the settings above
- `hourly_rate` and `sign_in_time` set on the three workers
- the `payroll_exports` row for week 37 upserted

All scoped to the demo tenant. **No shift was created, modified or deleted.**

## Files

| File | What it is |
|---|---|
| `scripts/payroll-proof.mjs` | Regenerates everything here |
| `docs/payroll/week37-data.json` | Full machine-readable output |
| `docs/payroll/VTR-TS-20260907.csv` | The export as produced |
| `docs/payroll/XERO-SETUP.md` | The Xero configuration the totals assume |
