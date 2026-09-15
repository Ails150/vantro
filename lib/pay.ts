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
