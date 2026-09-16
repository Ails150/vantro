// lib/pay.ts
//
// Hours into money. Pure functions, no database, no clock.
//
// This is the only place that multiplies an hour by a rate. Everything that
// shows a pay figure -- the payroll table, the export, the PDF -- calls in
// here, because a payroll screen and a payroll export that disagree by two
// pounds is a support ticket that takes a day to close and costs the trust of
// the person who found it.
//
// MONEY IS COMPUTED IN PENCE.
// 7.5 hours at 18.60 is 139.50000000000003 in binary floating point. That is
// not a rounding curiosity when it is summed over forty people and fifty-two
// weeks, and it is indefensible on anything a worker reads. Every figure here
// is integer pence internally and only becomes pounds at the boundary.
//
// ROUNDING HAPPENS ONCE, PER SHIFT.
// A shift's pay is rounded to the penny and then shifts are summed. The
// alternative -- sum the exact products, round the total -- gives a different
// answer, and the one that has to be defensible is the one where each line on
// the export matches its own arithmetic and the total is the sum of the lines.
// A total that does not equal the visible rows is the single fastest way to
// lose an argument with a bookkeeper.

/** What a worker is paid, once the fallback has been resolved. */
export type ResolvedRate = {
  /** Pounds per hour. Null when neither a personal nor a default rate is set. */
  rate: number | null
  /** Where the number came from, so the UI can say so. */
  source: "worker" | "company_default" | "unset"
}

/**
 * The rate to use for one worker.
 *
 * Null and zero are different on purpose. A worker with hourly_rate = 0 is paid
 * nothing and that is a deliberate setting -- an unpaid director, or someone
 * paid entirely outside Vantro -- so it must NOT fall through to the company
 * default. Only null, meaning "never set", falls back. Getting this wrong would
 * silently start paying somebody who was deliberately set to zero.
 */
export function resolveRate(
  workerRate: number | null | undefined,
  companyDefaultRate: number | null | undefined,
): ResolvedRate {
  if (workerRate !== null && workerRate !== undefined && Number.isFinite(Number(workerRate))) {
    return { rate: Number(workerRate), source: "worker" }
  }
  if (
    companyDefaultRate !== null &&
    companyDefaultRate !== undefined &&
    Number.isFinite(Number(companyDefaultRate))
  ) {
    return { rate: Number(companyDefaultRate), source: "company_default" }
  }
  return { rate: null, source: "unset" }
}

/**
 * Pay for a number of hours at a rate, rounded to the penny.
 *
 * Returns null rather than 0 when there is no rate. Zero is a real answer
 * meaning "worked, earned nothing"; null means "we do not know what this is
 * worth", and a payroll screen must show those differently. Collapsing them
 * into 0.00 is how an unset rate reaches an export without anyone noticing.
 */
export function payFor(hours: number, rate: number | null): number | null {
  if (rate === null || !Number.isFinite(rate)) return null
  const h = Number(hours)
  if (!Number.isFinite(h) || h <= 0) return 0

  // Hours carry fractions that do not divide cleanly (7.516666... for 7h31m),
  // so the multiplication happens in hundredths of a penny and is rounded once
  // at the end.
  const ratePence = Math.round(rate * 100)
  const pence = Math.round(h * ratePence)
  return pence / 100
}

/**
 * Add a list of per-shift figures.
 *
 * Takes the already-rounded per-shift values, so the total always equals the
 * sum of the rows on screen. Nulls are skipped rather than treated as zero, and
 * the count of them is returned: "three shifts have no rate" is the thing the
 * UI has to be able to say.
 */
export function sumPay(values: Array<number | null>): { total: number; unpriced: number } {
  let pence = 0
  let unpriced = 0
  for (const v of values) {
    if (v === null || !Number.isFinite(v as number)) {
      unpriced += 1
      continue
    }
    pence += Math.round((v as number) * 100)
  }
  return { total: pence / 100, unpriced }
}

/** GBP for a screen or a document. Always two decimals: this is money. */
export function formatPay(pounds: number | null): string {
  if (pounds === null || !Number.isFinite(pounds as number)) return "—"
  return `£${(pounds as number).toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

/** A rate for display. Null reads as not set rather than as free labour. */
export function formatRate(rate: number | null): string {
  if (rate === null || !Number.isFinite(rate as number)) return "Not set"
  return `£${(rate as number).toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}/hr`
}

/**
 * Validate a rate typed by a person.
 *
 * Returns the number, or a sentence explaining the refusal. The bounds match
 * the check constraints in 20260915140000_pay_rates.sql -- the database is the
 * backstop, this is what produces a readable error instead of a Postgres one.
 */
export function parseRate(raw: unknown): { ok: true; rate: number | null } | { ok: false; why: string } {
  if (raw === null || raw === undefined || raw === "") return { ok: true, rate: null }
  const n = Number(raw)
  if (!Number.isFinite(n)) return { ok: false, why: "Rate must be a number" }
  if (n < 0) return { ok: false, why: "Rate cannot be negative" }
  // The realistic mistake is a rate typed in pence: 1850 for £18.50.
  if (n > 1000) return { ok: false, why: "Rate looks wrong — is it in pence rather than pounds?" }
  // More than two decimals is not a rate anyone quotes, and it would round
  // invisibly on every shift.
  if (Math.round(n * 100) !== Math.round(n * 1000) / 10) {
    return { ok: false, why: "Rate can have at most two decimal places" }
  }
  return { ok: true, rate: Math.round(n * 100) / 100 }
}

// ---------------------------------------------------------------------------
// Pay rules
// ---------------------------------------------------------------------------
//
// Rules sit between "how long was this person on site" and "what do we pay for
// that". They are per company, all optional, and all off unless switched on --
// see 20260915150000_pay_rules.sql for why a default that quietly changed a
// payroll total would be indefensible.
//
// payableHours() is the single funnel. Every rule that changes the NUMBER OF
// HOURS goes through it, in a fixed order, so two rules can never be applied in
// a different sequence by two callers and produce two answers.

export type RoundingDirection = "nearest" | "up" | "down"

export type PayRules = {
  roundToMinutes: number | null
  roundingDirection: RoundingDirection
  minimumPaidMinutes: number | null
  /** Minutes taken off a qualifying shift as an unpaid break. */
  unpaidBreakMinutes: number | null
  /** Only deduct the break above this many hours. Null means every shift. */
  breakAfterHours: number | null
  /**
   * Minutes past the scheduled start before an arrival is called late.
   *
   * REPORTING ONLY. Nothing in payableHours() reads this, and nothing should:
   * a late worker is already paid for fewer hours, and deducting again would
   * charge them twice for one offence.
   */
  latenessGraceMinutes: number | null
  /** Hours in one day above which overtime is paid. */
  overtimeDailyThresholdHours: number | null
  /** Hours in one week above which overtime is paid, after daily is removed. */
  overtimeWeeklyThresholdHours: number | null
  /** Applied to the worker's own rate. 1.5 is time and a half. */
  overtimeMultiplier: number | null
  /** Applied to the worker's rate for hours on a public holiday. */
  bankHolidayMultiplier: number | null
  /** Applied to hours worked on a Saturday. */
  saturdayMultiplier: number | null
  /** Applied to hours worked on a Sunday. */
  sundayMultiplier: number | null
}

/**
 * What a company with no pay_rules row gets: today's behaviour, exactly.
 *
 * Kept as a named constant rather than scattered `?? null`s, so "no rules" is
 * one object that can be tested against and reasoned about.
 */
export const NO_PAY_RULES: PayRules = {
  roundToMinutes: null,
  roundingDirection: "nearest",
  minimumPaidMinutes: null,
  unpaidBreakMinutes: null,
  breakAfterHours: null,
  latenessGraceMinutes: null,
  overtimeDailyThresholdHours: null,
  overtimeWeeklyThresholdHours: null,
  overtimeMultiplier: null,
  bankHolidayMultiplier: null,
  saturdayMultiplier: null,
  sundayMultiplier: null,
}

/** Coerce a pay_rules row (or its absence) into rules the engine can use. */
export function toPayRules(row: any | null | undefined): PayRules {
  if (!row) return NO_PAY_RULES
  const direction = row.rounding_direction
  return {
    roundToMinutes: intOrNull(row.round_to_minutes),
    roundingDirection:
      direction === "up" || direction === "down" || direction === "nearest"
        ? direction
        : "nearest",
    minimumPaidMinutes: intOrNull(row.minimum_paid_minutes),
    unpaidBreakMinutes: intOrNull(row.unpaid_break_minutes),
    breakAfterHours: numberOrNull(row.break_after_hours),
    latenessGraceMinutes: intOrNull(row.lateness_grace_minutes),
    overtimeDailyThresholdHours: numberOrNull(row.overtime_daily_threshold_hours),
    overtimeWeeklyThresholdHours: numberOrNull(row.overtime_weekly_threshold_hours),
    overtimeMultiplier: numberOrNull(row.overtime_multiplier),
    bankHolidayMultiplier: numberOrNull(row.bank_holiday_multiplier),
    saturdayMultiplier: numberOrNull(row.saturday_multiplier),
    sundayMultiplier: numberOrNull(row.sunday_multiplier),
  }
}

function numberOrNull(value: any): number | null {
  if (value === null || value === undefined || value === "") return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function intOrNull(value: any): number | null {
  if (value === null || value === undefined || value === "") return null
  const n = Number(value)
  return Number.isFinite(n) ? Math.trunc(n) : null
}

/**
 * Turn time actually on site into time that gets paid.
 *
 * Order is fixed and matters:
 *   1. deduct the unpaid break
 *   2. round the worked time
 *   3. apply the minimum
 *
 * The break comes first because it is a fact about the shift, while rounding is
 * a commercial adjustment on top of what was worked. The minimum comes last
 * because it is a floor on what is PAID: any other order lets a 'down' rounding
 * drop a shift back below the minimum it was just raised to, which would make
 * the minimum a suggestion rather than a floor.
 *
 * Works in whole minutes throughout. Hours are a float with a repeating decimal
 * for most real shifts (7h31m is 7.51666...), and rounding rules expressed in
 * minutes have to be evaluated in minutes or the boundaries land in the wrong
 * place.
 */
export function payableHours(workedHours: number, rules: PayRules): number {
  const worked = Number(workedHours)
  if (!Number.isFinite(worked) || worked <= 0) return 0

  let minutes = Math.round(worked * 60)

  // 1. The unpaid break, FIRST.
  //
  // Before rounding, because the break is a fact about the shift and rounding
  // is a commercial adjustment applied to what was worked. Deducting after
  // rounding would let a 15-minute rounding quietly give half of the break
  // back, which makes the deduction look arbitrary to anyone checking it by
  // hand.
  //
  // The threshold is tested against the time ACTUALLY on site, not against the
  // running total, so the answer to "did this shift qualify for a break" cannot
  // change depending on which other rules happen to be switched on.
  if (rules.unpaidBreakMinutes && rules.unpaidBreakMinutes > 0) {
    const qualifies =
      rules.breakAfterHours === null || rules.breakAfterHours === undefined
        ? true
        : worked > rules.breakAfterHours
    if (qualifies) {
      // Never below zero. A shift shorter than its own break deduction is a
      // data error somewhere else, and the honest answer here is nothing paid
      // rather than a negative that would subtract from the rest of the week.
      minutes = Math.max(0, minutes - rules.unpaidBreakMinutes)
    }
  }

  // 2. Rounding.
  if (rules.roundToMinutes && rules.roundToMinutes > 0) {
    minutes = roundMinutes(minutes, rules.roundToMinutes, rules.roundingDirection)
  }

  // 3. The minimum, LAST, because it is a floor on what is paid.
  if (rules.minimumPaidMinutes && rules.minimumPaidMinutes > minutes) {
    minutes = rules.minimumPaidMinutes
  }

  return minutes / 60
}

function roundMinutes(minutes: number, unit: number, direction: RoundingDirection): number {
  if (direction === "up") return Math.ceil(minutes / unit) * unit
  if (direction === "down") return Math.floor(minutes / unit) * unit
  // 'nearest' rounds halves UP rather than to even. Banker's rounding is the
  // statistically neutral choice and the wrong one here: a worker who is
  // exactly on the boundary should not lose the half, and "we round half down
  // sometimes" is not a sentence anybody wants to say to their crew.
  return Math.round(minutes / unit) * unit
}

// ---------------------------------------------------------------------------
// Lateness
// ---------------------------------------------------------------------------
//
// Separate from payableHours() on purpose, and it must stay separate. Lateness
// is a management fact, not a pay adjustment -- see the migration for why
// deducting for it would charge somebody twice for the same forty minutes.

export type Lateness = {
  /** True only when reporting is switched on AND the arrival was past grace. */
  isLate: boolean
  /** Minutes past the scheduled start. 0 when on time or not reportable. */
  minutesLate: number
  /** False when there is no schedule to compare against. */
  hasSchedule: boolean
}

const NOT_LATE: Lateness = { isLate: false, minutesLate: 0, hasSchedule: false }

/**
 * Was this arrival late, and by how much.
 *
 * `scheduledStart` is "HH:MM" or "HH:MM:SS" in the site's local day; the
 * caller resolves which schedule applies (the job's start time, then the
 * worker's own, then the company default) because that precedence is about
 * records, not arithmetic, and does not belong in a pure function.
 *
 * `signedInLocal` is the arrival as "HH:MM" in the SAME local day. Both sides
 * are local wall-clock on purpose: comparing a UTC instant against a wall-clock
 * start time is how a shift on the wrong side of a clock change reports
 * everybody as an hour late.
 */
export function latenessFor(
  signedInLocal: string | null | undefined,
  scheduledStart: string | null | undefined,
  graceMinutes: number | null | undefined,
): Lateness {
  // Reporting off. Returns "not late" rather than "unknown": the caller asked a
  // question the company has said it does not want answered.
  if (graceMinutes === null || graceMinutes === undefined) return NOT_LATE

  const arrived = minutesOfDay(signedInLocal)
  const start = minutesOfDay(scheduledStart)
  if (arrived === null || start === null) return NOT_LATE

  const late = arrived - start

  // Early is not negative lateness, it is simply not late. Reporting "-12
  // minutes late" invites somebody to net it off against a late day, which is
  // not how either attendance or pay works.
  if (late <= 0) return { isLate: false, minutesLate: 0, hasSchedule: true }

  const grace = Math.max(0, Math.trunc(Number(graceMinutes) || 0))
  return {
    // Grace is inclusive: exactly on the grace boundary is still on time. The
    // boundary should favour the person, and "you were ten minutes late" when
    // the allowance is ten minutes is an argument nobody needs.
    isLate: late > grace,
    minutesLate: late,
    hasSchedule: true,
  }
}

/** "HH:MM" or "HH:MM:SS" to minutes since midnight. Null if unreadable. */
function minutesOfDay(value: string | null | undefined): number | null {
  if (!value || typeof value !== "string") return null
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(value.trim())
  if (!m) return null
  const hours = Number(m[1])
  const mins = Number(m[2])
  if (hours < 0 || hours > 23 || mins < 0 || mins > 59) return null
  return hours * 60 + mins
}

/**
 * Which schedule a shift should be judged against.
 *
 * The site wins, then the worker, then the company. A job with a start time has
 * been given one deliberately -- an early start for a crane lift, a late one
 * for a noise restriction -- and it should not be overridden by somebody's
 * usual hours.
 */
export function scheduledStartFor(
  jobStartTime: string | null | undefined,
  workerSignInTime: string | null | undefined,
  companyDefaultStart: string | null | undefined,
): string | null {
  return jobStartTime || workerSignInTime || companyDefaultStart || null
}

// ---------------------------------------------------------------------------
// Overtime
// ---------------------------------------------------------------------------
//
// Deliberately NOT part of payableHours(). Every other rule is a fact about one
// shift; "over forty hours in a week" cannot be decided while looking at a
// single Tuesday. So overtime takes a whole week and payableHours() stays
// per-shift and stays simple.

/** One day's already-payable hours. The date is a local YYYY-MM-DD. */
export type DayHours = { date: string; hours: number }

export type OvertimeSplit = {
  /** Hours paid at the basic rate. */
  basicHours: number
  /** Hours paid at the multiplier. */
  overtimeHours: number
  /** basicHours + overtimeHours, for callers that want the total back. */
  totalHours: number
  /** Which threshold produced the overtime, for explaining it on screen. */
  fromDaily: number
  fromWeekly: number
}

/**
 * Split a worker's week into basic and overtime hours.
 *
 * Daily overtime comes out FIRST, and the weekly threshold is then applied only
 * to what remains. This is the trap the whole function exists to avoid: a ten
 * hour Monday under an eight hour daily rule has already yielded two overtime
 * hours, and a weekly rule that then looks at the raw fifty hour total pays
 * those same two hours a second time.
 *
 * Hours in, hours out -- no money. The caller multiplies by the rate, so this
 * stays testable against plain numbers and cannot disagree with payFor().
 */
export function splitOvertime(days: DayHours[], rules: PayRules): OvertimeSplit {
  // Group by date first. Two shifts on the same Tuesday are one Tuesday as far
  // as a daily threshold is concerned -- a worker who does 5 hours on one site
  // and 5 on another has done a ten hour day, and paying each shift as if it
  // stood alone would hide every bit of daily overtime a multi-site company
  // ever works.
  const byDate = new Map<string, number>()
  for (const d of days) {
    const hours = Number(d?.hours)
    if (!Number.isFinite(hours) || hours <= 0) continue
    const key = String(d.date || "").slice(0, 10)
    byDate.set(key, (byDate.get(key) || 0) + hours)
  }

  const totalHours = round2(Array.from(byDate.values()).reduce((a, b) => a + b, 0))

  const dailyThreshold = rules.overtimeDailyThresholdHours
  let fromDaily = 0
  if (dailyThreshold && dailyThreshold > 0) {
    for (const hours of byDate.values()) {
      if (hours > dailyThreshold) fromDaily += hours - dailyThreshold
    }
  }
  fromDaily = round2(fromDaily)

  // What is left after daily overtime has been removed. This is the figure the
  // weekly threshold is measured against.
  const afterDaily = round2(totalHours - fromDaily)

  const weeklyThreshold = rules.overtimeWeeklyThresholdHours
  let fromWeekly = 0
  if (weeklyThreshold && weeklyThreshold > 0 && afterDaily > weeklyThreshold) {
    fromWeekly = round2(afterDaily - weeklyThreshold)
  }

  const overtimeHours = round2(fromDaily + fromWeekly)
  return {
    basicHours: round2(totalHours - overtimeHours),
    overtimeHours,
    totalHours,
    fromDaily,
    fromWeekly,
  }
}

/**
 * Pay for a split week.
 *
 * The multiplier applies to the worker's OWN rate, so changing a rate never
 * leaves a stale overtime rate behind it.
 *
 * A null multiplier means overtime is paid at basic. That is what a company
 * which set a threshold but no multiplier has literally asked for, and it is
 * safer than assuming time and a half on their behalf and quietly inflating
 * their wage bill.
 *
 * Each component is rounded to the penny on its own and the total is their sum,
 * so the three figures on screen always add up. Rounding the total separately
 * gives a number that does not equal the rows above it.
 */
export function payForSplit(
  split: OvertimeSplit,
  rate: number | null,
  rules: PayRules,
): { basic: number | null; overtime: number | null; total: number | null } {
  if (rate === null || !Number.isFinite(rate)) {
    return { basic: null, overtime: null, total: null }
  }

  const multiplier =
    rules.overtimeMultiplier && rules.overtimeMultiplier >= 1 ? rules.overtimeMultiplier : 1

  const basic = payFor(split.basicHours, rate) ?? 0
  // The overtime RATE is rounded to the penny before it is applied, because that
  // is the number a payslip prints and the one a worker checks against. 18.33 at
  // time and a half is 27.50, not 27.495.
  //
  // Rounded in PENCE, not pounds. Math.round(27.495 * 100) is 2749, because
  // 27.495 * 100 is 2749.4999999999995 in binary floating point -- so the
  // obvious version silently pays a penny an hour short. Multiplying the
  // already-integer pence rate keeps the half exact.
  const overtimeRatePence = Math.round(Math.round(rate * 100) * multiplier)
  const overtimeRate = overtimeRatePence / 100
  const overtime = payFor(split.overtimeHours, overtimeRate) ?? 0

  return {
    basic,
    overtime,
    total: Math.round((basic + overtime) * 100) / 100,
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

// ---------------------------------------------------------------------------
// Bank holidays
// ---------------------------------------------------------------------------

export type EnhancedDay = {
  date: string
  hours: number
  /** Which rule enhanced it, for the payslip line. */
  kind: "bank_holiday" | "saturday" | "sunday"
  multiplier: number
}

export type WeekSplit = {
  /** Days paid at an enhanced rate, each with the multiplier that applied. */
  enhanced: EnhancedDay[]
  /** Total enhanced hours, for a summary line. */
  enhancedHours: number
  /** Everything else, already split into basic and overtime. */
  overtime: OvertimeSplit
}

/**
 * Which enhanced rate, if any, a date attracts.
 *
 * WHERE A DAY IS BOTH a weekend day and a bank holiday -- Christmas Day on a
 * Sunday, and every substitute day in between -- the HIGHEST SINGLE multiplier
 * applies. They are never multiplied together: nobody's contract says a Sunday
 * bank holiday pays four times. The two alternative readings (bank holiday
 * always wins, weekend always wins) are each wrong for half of real contracts,
 * and highest-single is the one nobody argues with.
 */
export function enhancementFor(
  date: string,
  holidayDates: Set<string>,
  rules: PayRules,
): { kind: EnhancedDay["kind"]; multiplier: number } | null {
  const key = String(date || "").slice(0, 10)
  const candidates: Array<{ kind: EnhancedDay["kind"]; multiplier: number }> = []

  const bh = rules.bankHolidayMultiplier
  if (bh && bh > 1 && holidayDates.has(key)) {
    candidates.push({ kind: "bank_holiday", multiplier: bh })
  }

  // Parsed as UTC noon so a timezone offset can never roll the date onto the
  // previous or next day and turn a Friday into a Saturday.
  const parsed = Date.parse(`${key}T12:00:00Z`)
  if (Number.isFinite(parsed)) {
    const dow = new Date(parsed).getUTCDay()
    const sat = rules.saturdayMultiplier
    const sun = rules.sundayMultiplier
    if (dow === 6 && sat && sat > 1) candidates.push({ kind: "saturday", multiplier: sat })
    if (dow === 0 && sun && sun > 1) candidates.push({ kind: "sunday", multiplier: sun })
  }

  if (candidates.length === 0) return null
  // Highest single multiplier. Ties resolve to the first, which is the bank
  // holiday -- the more specific reason for the enhancement.
  return candidates.reduce((best, c) => (c.multiplier > best.multiplier ? c : best))
}

/**
 * Split a week into enhanced days and ordinary days, then split the ordinary
 * days into basic and overtime.
 *
 * Enhanced hours come OUT FIRST and never reach splitOvertime(): the day is
 * already enhanced, so it must not also take an overtime multiplier, and it
 * does not push the rest of the week over a weekly threshold.
 *
 * A multiplier of exactly 1, or none at all, means the day is ORDINARY and
 * flows through the overtime rules like any other. Pulling those hours out
 * anyway would silently drop them from a weekly threshold for a company that
 * never asked for weekend pay.
 */
export function splitWeek(
  days: DayHours[],
  holidayDates: Set<string>,
  rules: PayRules,
): WeekSplit {
  const enhanced: EnhancedDay[] = []
  const ordinary: DayHours[] = []

  for (const d of days) {
    const hours = Number(d?.hours)
    if (!Number.isFinite(hours) || hours <= 0) continue
    const e = enhancementFor(d.date, holidayDates, rules)
    if (e) {
      enhanced.push({ date: String(d.date).slice(0, 10), hours, kind: e.kind, multiplier: e.multiplier })
    } else {
      ordinary.push(d)
    }
  }

  return {
    enhanced,
    enhancedHours: round2(enhanced.reduce((sum, e) => sum + e.hours, 0)),
    overtime: splitOvertime(ordinary, rules),
  }
}

/**
 * Pay for a full week, enhanced days included.
 *
 * Each component is rounded to the penny on its own and the total is their sum,
 * so the figures on screen add up to the figure at the bottom.
 */
export function payForWeek(
  split: WeekSplit,
  rate: number | null,
  rules: PayRules,
): {
  basic: number | null
  overtime: number | null
  enhanced: number | null
  total: number | null
} {
  if (rate === null || !Number.isFinite(rate)) {
    return { basic: null, overtime: null, enhanced: null, total: null }
  }

  const ot = payForSplit(split.overtime, rate, rules)

  let enhancedPence = 0
  for (const day of split.enhanced) {
    // Rounded in pence for the same reason the overtime rate is: rounding
    // rate x multiplier in pounds loses a penny on every exact half.
    const dayRate = Math.round(Math.round(rate * 100) * day.multiplier) / 100
    enhancedPence += Math.round((payFor(day.hours, dayRate) ?? 0) * 100)
  }
  const enhanced = enhancedPence / 100

  return {
    basic: ot.basic,
    overtime: ot.overtime,
    enhanced,
    total: Math.round(((ot.total ?? 0) + enhanced) * 100) / 100,
  }
}

// ---------------------------------------------------------------------------
// Bonuses
// ---------------------------------------------------------------------------
//
// The only money here that is not derived from hours. A bonus is a number a
// person decided on, so it is validated rather than computed.

/**
 * Validate a bonus amount typed by a person.
 *
 * NEGATIVE IS ALLOWED. A deduction is a bonus with a minus sign -- a correction
 * for last month's overpayment, a damaged tool agreed with the worker. Refusing
 * them would push those corrections into a spreadsheet, which is where this
 * product is trying to stop things living.
 *
 * Zero is refused: it is not a bonus, it is a row somebody abandoned halfway
 * through, and it would sit in a payroll run meaning nothing.
 */
export function parseBonusAmount(
  raw: unknown,
): { ok: true; amount: number } | { ok: false; why: string } {
  if (raw === null || raw === undefined || raw === "") {
    return { ok: false, why: "Enter an amount" }
  }
  const n = Number(raw)
  if (!Number.isFinite(n)) return { ok: false, why: "Amount must be a number" }
  if (n === 0) return { ok: false, why: "A bonus of zero is not a bonus" }
  if (Math.abs(n) > 100000) {
    return { ok: false, why: "Amount looks wrong — check the decimal point" }
  }
  if (Math.round(n * 100) !== Math.round(n * 1000) / 10) {
    return { ok: false, why: "Amount can have at most two decimal places" }
  }
  return { ok: true, amount: Math.round(n * 100) / 100 }
}

/**
 * Add bonuses to a week's pay.
 *
 * Kept separate from payForWeek() rather than folded into it. Bonuses are not
 * affected by any pay rule -- no multiplier, no rounding, no threshold -- and
 * running them through the same function would invite somebody to apply one by
 * accident. A bonus is the amount that was decided, exactly.
 *
 * Returns null total only when there is no rate AND no bonuses; a company can
 * legitimately pay somebody a bonus and nothing else.
 */
export function addBonuses(
  weekPay: { total: number | null },
  bonusAmounts: number[],
): { bonuses: number; total: number | null } {
  let pence = 0
  for (const b of bonusAmounts) {
    const n = Number(b)
    if (Number.isFinite(n)) pence += Math.round(n * 100)
  }
  const bonuses = pence / 100

  if (weekPay.total === null) {
    return { bonuses, total: bonuses === 0 ? null : bonuses }
  }
  return { bonuses, total: Math.round((weekPay.total + bonuses) * 100) / 100 }
}
