// lib/payroll-export.ts
//
// One line per worker per pay type, with the hours, the rate and the amount.
//
// WHAT XERO ACTUALLY ACCEPTS, because it shapes this file and the previous
// version got it wrong by omission.
//
// A Xero timesheet line carries UNITS AGAINST A NAMED EARNINGS RATE. It does
// not carry a rate. The money is decided inside Xero by the employee's pay
// template and by how the earnings rate is configured -- an overtime rate is
// set up as "Multiple of Employee's Ordinary Earnings Rate" with a multiplier
// of 1.5, and Xero multiplies. So the Rate and Amount columns here are NOT
// instructions to Xero. They are what makes the file reconcilable by a human,
// and they are what lets somebody check that Xero's answer matches ours.
//
// Xero Payroll UK also has no native timesheet CSV import at all; it is a
// standing feature request. Timesheets reach Xero through the Payroll API or a
// third-party bridge. This file is therefore (a) the reconciliation document a
// bookkeeper reads, and (b) the source a bridge maps to timesheet lines. Both
// uses want the earnings rate name to match the one configured in Xero, which
// is why the names below are plain and stable.
//
// docs/payroll/XERO-SETUP.md lists the earnings rates a company has to create
// for the totals to agree.
//
// THE PREVIOUS VERSION EXPORTED HOURS ONLY, under a single "Ordinary Hours"
// rate, with overtime buried inside the totals. The payroll proof computed
// GBP 2,280.77 for three workers and the CSV told Xero something that would
// have produced a different number. That is the bug this file fixes.

import {
  allocateShifts, payFor, payForWeek, payableHours, splitWeek,
  type PayRules, type ShiftInterval,
} from "./pay"

/** The pay types a line can carry, in the order they appear in the file. */
export const PAY_TYPES = [
  "Ordinary Hours",
  "Overtime 1.5",
  "Overtime 2.0",
  "Saturday",
  "Sunday",
  "Bank Holiday",
  "Bonus",
] as const

export type PayType = (typeof PAY_TYPES)[number]

export type PayrollLine = {
  employee: string
  email: string
  payType: PayType
  /** Null for Bonus, which is an amount rather than time. */
  hours: number | null
  /** The effective hourly rate for this line. Null for Bonus. */
  rate: number | null
  amount: number
  /** Hours per day, Monday first. Empty for Bonus. */
  days: number[]
  /** True when overlapping shifts were trimmed out of this worker's week. */
  overlapTrimmed: boolean
}

export type WorkerInput = {
  userId: string
  name: string
  email: string
  /** Resolved rate. Null means no rate is set and the lines cannot be priced. */
  rate: number | null
  /** Closed shifts only. Open shifts have no payable total yet. */
  shifts: Array<{ id: string; signedInAt: string; signedOutAt: string }>
  bonuses: Array<{ amount: number; reason: string }>
}

/**
 * Which "Overtime N" line a multiplier belongs on.
 *
 * The engine carries ONE overtime multiplier, so only one of the two overtime
 * lines is ever populated. Both names exist because a payroll department asks
 * for the columns it recognises, and an empty one is easier to read than a
 * missing one. A multiplier that is neither 1.5 nor 2.0 goes on the 1.5 line
 * with its true rate and amount -- the label is then wrong, which is why
 * XERO-SETUP.md tells the reader to name the earnings rate after their own
 * multiplier.
 */
function overtimeLabel(multiplier: number): PayType {
  return multiplier >= 2 ? "Overtime 2.0" : "Overtime 1.5"
}

const DAY_COUNT = 7
const round2 = (n: number) => Math.round(n * 100) / 100

/**
 * Build every payroll line for one week.
 *
 * `weekStart` is the Monday as YYYY-MM-DD. `dayIndexOf` maps a shift to 0-6 in
 * the company's timezone; it is injected rather than computed here so the
 * caller owns the timezone decision and this stays pure.
 */
export function buildPayrollLines(
  workers: WorkerInput[],
  rules: PayRules,
  holidayDates: Set<string>,
  dayIndexOf: (iso: string) => number,
  dateKeyOf: (iso: string) => string,
): PayrollLine[] {
  const lines: PayrollLine[] = []

  for (const w of workers) {
    // Overlapping minutes are removed BEFORE anything else. Two shifts covering
    // the same hour must not reach the export as two hours; the surveyor in the
    // demo tenant reached a Xero timesheet at 26.30 hours for one day.
    const intervals: ShiftInterval[] = w.shifts
      .map(s => ({ id: s.id, start: Date.parse(s.signedInAt), end: Date.parse(s.signedOutAt) }))
      .filter(i => Number.isFinite(i.start) && Number.isFinite(i.end) && i.end > i.start)

    const allocation = allocateShifts(intervals)

    // Per day, using the allocated (non-overlapping) hours.
    const byDate = new Map<string, number>()
    const dayIndexByDate = new Map<string, number>()
    for (const s of w.shifts) {
      const paid = allocation.hoursById.get(s.id)
      if (paid === undefined) continue
      const key = dateKeyOf(s.signedInAt)
      byDate.set(key, round2((byDate.get(key) || 0) + paid))
      dayIndexByDate.set(key, dayIndexOf(s.signedInAt))
    }

    // Pay rules that act per shift (break, rounding, minimum) apply to the
    // day's total, which is what the daily overtime threshold measures against.
    const days = [...byDate.entries()].map(([date, hours]) => ({
      date,
      hours: payableHours(hours, rules),
    }))

    const split = splitWeek(days, holidayDates, rules)
    const pay = payForWeek(split, w.rate, rules)

    const blank = () => new Array(DAY_COUNT).fill(0)

    // --- Ordinary and overtime ------------------------------------------
    // Day columns are apportioned from the ordinary (non-enhanced) days. A day
    // that produced daily overtime contributes to both lines, so the split is
    // recorded per day rather than lumped at the end of the week.
    const ordinaryDays = blank()
    const overtimeDays = blank()
    const dailyThreshold = rules.overtimeDailyThresholdHours

    for (const d of days) {
      if (split.enhanced.some(e => e.date === d.date)) continue
      const idx = dayIndexByDate.get(d.date) ?? 0
      const over = dailyThreshold && d.hours > dailyThreshold ? d.hours - dailyThreshold : 0
      ordinaryDays[idx] = round2(ordinaryDays[idx] + (d.hours - over))
      overtimeDays[idx] = round2(overtimeDays[idx] + over)
    }

    // Weekly overtime has no single day to sit on -- it is a property of the
    // week. It is added to the LAST worked day so the row totals still add up,
    // and XERO-SETUP.md says so, because a bookkeeper comparing a day column
    // against a clock-in sheet would otherwise find one day inexplicably high.
    if (split.overtime.fromWeekly > 0) {
      const lastIdx = Math.max(...[...dayIndexByDate.values()], 0)
      overtimeDays[lastIdx] = round2(overtimeDays[lastIdx] + split.overtime.fromWeekly)
      ordinaryDays[lastIdx] = round2(ordinaryDays[lastIdx] - split.overtime.fromWeekly)
    }

    const otMultiplier =
      rules.overtimeMultiplier && rules.overtimeMultiplier >= 1 ? rules.overtimeMultiplier : 1
    const otRate = w.rate === null ? null : round2(Math.round(w.rate * 100) * otMultiplier / 100)

    const push = (payType: PayType, hours: number | null, rate: number | null, amount: number, dayCols: number[]) => {
      lines.push({
        employee: w.name,
        email: w.email,
        payType,
        hours,
        rate,
        amount: round2(amount),
        days: dayCols,
        overlapTrimmed: allocation.trimmedIds.size > 0,
      })
    }

    if (split.overtime.basicHours > 0) {
      push("Ordinary Hours", split.overtime.basicHours, w.rate, pay.basic ?? 0, ordinaryDays)
    }
    if (split.overtime.overtimeHours > 0) {
      push(overtimeLabel(otMultiplier), split.overtime.overtimeHours, otRate, pay.overtime ?? 0, overtimeDays)
    }

    // --- Enhanced days, one line per kind --------------------------------
    for (const kind of ["saturday", "sunday", "bank_holiday"] as const) {
      const mine = split.enhanced.filter(e => e.kind === kind)
      if (mine.length === 0) continue

      const hours = round2(mine.reduce((a, e) => a + e.hours, 0))
      const multiplier = mine[0].multiplier
      const rate = w.rate === null ? null : round2(Math.round(w.rate * 100) * multiplier / 100)
      const amount = mine.reduce((a, e) => a + (payFor(e.hours, rate) ?? 0), 0)

      const dayCols = blank()
      for (const e of mine) {
        const idx = dayIndexByDate.get(e.date) ?? 0
        dayCols[idx] = round2(dayCols[idx] + e.hours)
      }

      const label: PayType =
        kind === "saturday" ? "Saturday" : kind === "sunday" ? "Sunday" : "Bank Holiday"
      push(label, hours, rate, amount, dayCols)
    }

    // --- Bonus, which is an amount and not time --------------------------
    const bonusTotal = round2(w.bonuses.reduce((a, b) => a + Number(b.amount || 0), 0))
    if (bonusTotal !== 0) {
      push("Bonus", null, null, bonusTotal, [])
    }
  }

  return lines
}

function csvEscape(value: any): string {
  if (value === null || value === undefined) return ""
  const s = String(value)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/**
 * Render the lines as CSV.
 *
 * `dayLabels` are the seven column headings (Mon 07 Sept, ...). Supplied by the
 * caller for the same reason dayIndexOf is: the timezone decision belongs to
 * whoever knows which company this is.
 */
export function toPayrollCsv(lines: PayrollLine[], dayLabels: string[]): string {
  const header = [
    "Employee", "Email", "Earnings Rate", "Hours", "Rate", "Amount",
    ...dayLabels,
    "Overlap Trimmed",
  ]

  const sorted = [...lines].sort(
    (a, b) =>
      a.employee.localeCompare(b.employee) ||
      PAY_TYPES.indexOf(a.payType) - PAY_TYPES.indexOf(b.payType),
  )

  const rows = sorted.map(l =>
    [
      csvEscape(l.employee),
      csvEscape(l.email),
      csvEscape(l.payType),
      csvEscape(l.hours === null ? "" : l.hours.toFixed(2)),
      csvEscape(l.rate === null ? "" : l.rate.toFixed(2)),
      csvEscape(l.amount.toFixed(2)),
      ...new Array(7).fill(0).map((_, i) => csvEscape((l.days[i] ?? 0).toFixed(2))),
      csvEscape(l.overlapTrimmed ? "yes" : ""),
    ].join(","),
  )

  // A total row, because the whole point of adding Rate and Amount is that
  // somebody can check the file against a payroll figure without a spreadsheet.
  const total = lines.reduce((a, l) => a + l.amount, 0)
  rows.push(
    ["TOTAL", "", "", "", "", round2(total).toFixed(2), ...new Array(7).fill(""), ""].join(","),
  )

  return [header.join(","), ...rows].join("\n")
}

/** What the lines add up to. The figure a payroll run must match. */
export function totalPay(lines: PayrollLine[]): number {
  return round2(lines.reduce((a, l) => a + l.amount, 0))
}
