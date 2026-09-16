# Xero setup for the Vantro payroll export

What has to exist in Xero for its figures to match Vantro's.

Written because the export carries a `Rate` and an `Amount` column and **Xero
ignores both**. If the earnings rates below are not configured, Xero will
produce a different number from the same file and nobody will be able to see
why.

---

## The thing to understand first

A Xero timesheet line carries **units against a named earnings rate**. It does
not carry a rate.

The money is decided inside Xero, by two things:

1. the employee's **pay template**, which holds their ordinary hourly rate, and
2. how the **earnings rate** is configured — an overtime rate is set up as
   *Multiple of Employee's Ordinary Earnings Rate* with a multiplier, and Xero
   does the multiplication.

So the `Rate` and `Amount` columns in `VTR-TS-*.csv` are **reconciliation aids
for a human**, not instructions. They exist so somebody can check that Xero's
answer matches Vantro's rather than discovering a discrepancy at the end of the
month.

## And the second thing

**Xero Payroll UK has no native timesheet CSV import.** It is a long-standing
feature request, not a feature. Timesheets reach Xero through:

- the **Payroll API** (`POST /Timesheets`, with `timesheetLines` carrying
  `earningsRateID` and `numberOfUnits` per day), or
- a **third-party bridge** from the Xero App Store, or
- **manual entry**.

This CSV is the source for whichever of those you use, and the document a
bookkeeper checks the result against.

---

## Earnings rates to create

Payroll → Payroll settings → **Pay Items** → Earnings.

The **name must match the `Earnings Rate` column in the CSV exactly**, because
that string is what a bridge maps on.

| CSV `Earnings Rate` | Rate type in Xero | Multiplier | Units |
|---|---|---|---|
| `Ordinary Hours` | Rate per unit | — (the employee's own rate) | Hours |
| `Overtime 1.5` | Multiple of Employee's Ordinary Earnings Rate | 1.5 | Hours |
| `Overtime 2.0` | Multiple of Employee's Ordinary Earnings Rate | 2.0 | Hours |
| `Saturday` | Multiple of Employee's Ordinary Earnings Rate | 1.5 | Hours |
| `Sunday` | Multiple of Employee's Ordinary Earnings Rate | 2.0 | Hours |
| `Bank Holiday` | Multiple of Employee's Ordinary Earnings Rate | 2.0 | Hours |
| `Bonus` | Fixed amount | — | — |

**Set the multipliers to match your own Vantro pay rules**, not to the table
above. The table shows the Northbridge demo's settings. If your Saturday rule is
×1.25, the Xero earnings rate has to be 1.25 or the two will disagree, and the
CSV — which prices from *your* rules — will be the one that is right.

### If your overtime multiplier is not 1.5 or 2.0

Vantro carries one overtime multiplier. The CSV puts its hours on the
`Overtime 1.5` line when the multiplier is under 2 and `Overtime 2.0` at 2 or
above, but the `Rate` and `Amount` columns always carry the **true** figure. A
multiplier of, say, 1.33 will appear on a line labelled `Overtime 1.5` with a
rate that is 1.33× the ordinary one.

Rename your earnings rate to match the multiplier you actually use, and map the
CSV line to it. The label is a convention; the rate is the fact.

### Employee matching

Xero matches on **email**. The `Email` column is the worker's email in Vantro,
and it has to be the one on their Xero employee record. A worker with no email
in Vantro exports with a blank cell and cannot be matched — fix it in Vantro
before the run, not in the file.

---

## Reading the file

| Column | Meaning |
|---|---|
| `Hours` | Total for that pay type across the week |
| `Rate` | The effective hourly rate, **for checking only** |
| `Amount` | `Hours × Rate`, priced at full precision |
| `Mon…Sun` | Hours per day for that pay type |
| `Overlap Trimmed` | `yes` when this worker had overlapping shifts |
| `TOTAL` row | What the whole run comes to |

### Why `Hours × Rate` may not equal `Amount` in the last penny

`Hours` is rounded to two decimals **for display**. Two decimals of an hour is
36 seconds, and pricing a rounded hour loses money, so the amount is computed
from the exact duration.

A worker with 2 h 28 m of overtime shows `2.47` hours at `33.00`. By hand that
looks like £81.51; the file says **£81.40**, which is 148 ÷ 60 × 33. **The
amount is right.** Check a line by working from the minutes, not from the
displayed hours.

### `Overlap Trimmed`

The worker had two or more shifts covering the same minute — signed into two
jobs at once, or an unclosed shift from the day before. Each minute is paid
**once**, allocated to the shift that started first.

The hours on these lines are therefore **lower** than the raw shifts add up to.
That is deliberate and it is not a shortfall to be corrected: the alternative is
paying twice for one hour. Check the sign-out times before running payroll.

The nightly `overlap-check` job raises an admin alert when this happens, so it
should not be a surprise at export time.

---

## Checking a run

1. Export the week from Vantro. Note the `TOTAL` row.
2. Import or enter the timesheets in Xero.
3. Draft the pay run and compare the gross against that `TOTAL`.

If they differ, in likely order:

- **An earnings rate multiplier does not match the Vantro pay rule.** The most
  common cause by a distance.
- **The employee's ordinary rate differs** between Xero's pay template and
  Vantro's `hourly_rate`.
- **A worker has no rate in Vantro** — they export with a blank rate and £0.00,
  and Xero will price them from its own template. Their hours are correct; the
  amount column simply has nothing to say.
- **Bonus lines were not imported.** They are an amount, not hours, and some
  bridges only carry time.

---

## Sources

- [Xero Payroll UK API — Timesheets](https://developer.xero.com/documentation/payroll-api-uk/timesheets)
- [Xero Payroll UK API — Earnings Rates](https://developer.xero.com/documentation/payroll-api-uk/earningrates)
- [Add or edit an employee's timesheet — Xero Central](https://central.xero.com/0/article/Add-or-edit-an-employee-s-timesheet)
- [UK Payroll: import pay run / timesheet information — Xero product ideas](https://productideas.xero.com/forums/939198-for-small-businesses/suggestions/49965465-uk-payroll-import-pay-run-timesheet-information)
  (the open request that confirms there is no native CSV timesheet import)
