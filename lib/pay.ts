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
