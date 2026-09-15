// lib/retention.ts
//
// What is held, when it can be claimed, and how close that is.
//
// Pure functions over plain values. No database, no dates read from the clock
// except the one the caller passes in -- every one of these answers has to be
// computable in a test and identical on the job card, in the money list, on the
// TODAY board and in the claim letter. Four surfaces disagreeing about how much
// money a client owes would be worse than not showing it at all.
//
// MONEY IS PENCE, NOT POUNDS, EVERYWHERE INSIDE THIS FILE'S ARITHMETIC.
// 48000 * 0.05 is not 2400 in binary floating point, it is
// 2400.0000000000005, and that lands on a letter demanding payment. Every
// figure here is computed in integer pence and only turned back into pounds at
// the edge.

/**
 * Days before the claim date that it starts appearing on TODAY.
 *
 * Thirty, because a retention claim is a letter that has to be written, sent,
 * and then chased, and because the claim date is a date the client is not
 * watching either. Reminding on the day would be reminding too late.
 */
export const RETENTION_REMINDER_DAYS = 30

export type RetentionInput = {
  contractValue: number | null | undefined
  retentionPercent: number | null | undefined
  practicalCompletionDate: string | null | undefined // YYYY-MM-DD
  defectsPeriodMonths: number | string | null | undefined
  retentionReleasedAt: string | null | undefined
}

export type RetentionState =
  /** No retention on this job. Nothing to show anywhere. */
  | "none"
  /** Retention is set, but there is no practical completion date yet, so the
   *  clock has not started and no claim date exists. */
  | "not_started"
  /** Held, claim date known and comfortably in the future. */
  | "held"
  /** Held, claim date within RETENTION_REMINDER_DAYS. This is what pins to
   *  TODAY. */
  | "due_soon"
  /** The claim date has arrived or passed and the money is still outstanding. */
  | "claimable"
  /** Released. Off the list. */
  | "released"

export type Retention = {
  state: RetentionState
  /** Pounds held, rounded to the penny. Zero when state is "none". */
  amountHeld: number
  /** YYYY-MM-DD, or null when there is no practical completion date. */
  claimDueDate: string | null
  /**
   * Whole days from the reference date to the claim date. Negative once the
   * date has passed. Null when there is no claim date.
   */
  daysUntilClaim: number | null
}

/**
 * Pounds held back on a contract.
 *
 * Computed in pence and rounded half-up at the last step, which is what an
 * invoice does. Returns 0 rather than throwing on missing or nonsensical
 * inputs: a half-filled job should show nothing, not break the page it is on.
 */
export function retentionHeld(
  contractValue: number | null | undefined,
  retentionPercent: number | null | undefined,
): number {
  const value = Number(contractValue)
  const percent = Number(retentionPercent)
  if (!Number.isFinite(value) || !Number.isFinite(percent)) return 0
  if (value <= 0 || percent <= 0) return 0

  // Pence, as an integer, before the percentage is applied.
  const valuePence = Math.round(value * 100)
  // percent carries two decimals, so scale by 100 to keep it whole, then take
  // the result back down by the same 100 and by the 100 of "per cent".
  const percentBasis = Math.round(percent * 100) // 5.25% -> 525
  const heldPence = Math.round((valuePence * percentBasis) / 10000)
  return heldPence / 100
}

/**
 * The date retention can be claimed: practical completion plus the defects
 * period.
 *
 * Month arithmetic, not 30-day arithmetic. "Twelve months after 29 February"
 * has to be a real date, and adding 365 days to a PC date would drift the
 * anniversary of every claim by a day or two -- which matters because the
 * client's own calendar is doing proper month arithmetic and a letter that
 * arrives early is a letter that gets refused.
 *
 * Overflow is clamped to the end of the target month, so 31 August plus six
 * months is 28 February, not 3 March. JavaScript's Date would happily roll it
 * over into the next month; a claim date that lands in the wrong month is the
 * kind of error nobody spots until the client points it out.
 */
export function claimDueDate(
  practicalCompletionDate: string | null | undefined,
  // string is accepted because a value off a JSON request body or a CSV import
  // arrives as one, and coercing it at every call site is how one of them ends
  // up forgetting to.
  defectsPeriodMonths: number | string | null | undefined,
): string | null {
  if (!practicalCompletionDate) return null

  // Number(null) is 0 and Number("") is 0, so a job with no defects period
  // would otherwise come out as "released at practical completion" -- a claim
  // date invented out of a missing field, which is worse than no date at all
  // because it looks like an answer. Absent is checked before numeric.
  if (defectsPeriodMonths === null || defectsPeriodMonths === undefined) return null
  if (typeof defectsPeriodMonths === "string" && defectsPeriodMonths.trim() === "") return null

  const months = Number(defectsPeriodMonths)
  if (!Number.isFinite(months) || months < 0) return null

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(practicalCompletionDate.slice(0, 10))
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2]) // 1-12
  const day = Number(match[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) return null

  const whole = Math.trunc(months)
  const targetMonthIndex = month - 1 + whole
  const targetYear = year + Math.floor(targetMonthIndex / 12)
  const targetMonth = ((targetMonthIndex % 12) + 12) % 12 // 0-11

  const lastDay = daysInMonth(targetYear, targetMonth)
  const targetDay = Math.min(day, lastDay)

  return (
    `${String(targetYear).padStart(4, "0")}-` +
    `${String(targetMonth + 1).padStart(2, "0")}-` +
    `${String(targetDay).padStart(2, "0")}`
  )
}

function daysInMonth(year: number, monthIndex: number): number {
  // Day 0 of the next month is the last day of this one.
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate()
}

/** Whole days between two YYYY-MM-DD dates, b - a. */
export function daysBetween(a: string, b: string): number {
  const start = Date.parse(`${a.slice(0, 10)}T00:00:00Z`)
  const end = Date.parse(`${b.slice(0, 10)}T00:00:00Z`)
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0
  return Math.round((end - start) / 86400000)
}

/**
 * Everything the UI needs about one job's retention.
 *
 * `today` is passed in as YYYY-MM-DD rather than read from the clock so that
 * the answer is the same on the server that renders the list and in the test
 * that pins the boundary at exactly thirty days.
 */
export function retentionFor(job: RetentionInput, today: string): Retention {
  const amountHeld = retentionHeld(job.contractValue, job.retentionPercent)
  const dueDate = claimDueDate(job.practicalCompletionDate, job.defectsPeriodMonths)

  // Released is checked before anything else, and deliberately without looking
  // at the amount: a job whose contract value was cleared after the money came
  // back is still released, not "none".
  if (job.retentionReleasedAt) {
    return { state: "released", amountHeld, claimDueDate: dueDate, daysUntilClaim: null }
  }

  // No percentage, or a contract worth nothing, means this job simply does not
  // have retention on it.
  if (amountHeld <= 0) {
    return { state: "none", amountHeld: 0, claimDueDate: dueDate, daysUntilClaim: null }
  }

  // Money is held, but nobody has certified practical completion, so there is
  // no clock running. This is a real and common state -- it is the whole
  // backlog of live jobs -- and it must not be silently shown as claimable.
  if (!dueDate) {
    return { state: "not_started", amountHeld, claimDueDate: null, daysUntilClaim: null }
  }

  const days = daysBetween(today, dueDate)

  if (days <= 0) return { state: "claimable", amountHeld, claimDueDate: dueDate, daysUntilClaim: days }
  if (days <= RETENTION_REMINDER_DAYS) {
    return { state: "due_soon", amountHeld, claimDueDate: dueDate, daysUntilClaim: days }
  }
  return { state: "held", amountHeld, claimDueDate: dueDate, daysUntilClaim: days }
}

/**
 * Is this job's retention outstanding -- money we have not been paid?
 *
 * "not_started" counts. That is the point of the total: a company wants to know
 * what is owed to it across the book, and money on a job that has not reached
 * practical completion is still money it does not have.
 */
export function isOutstanding(state: RetentionState): boolean {
  return state === "not_started" || state === "held" || state === "due_soon" || state === "claimable"
}

/** Does this job belong on the admin's TODAY board? */
export function needsAttention(state: RetentionState): boolean {
  return state === "due_soon" || state === "claimable"
}

/** GBP, for a screen or a letter. Always two decimals: this is money. */
export function formatMoney(pounds: number): string {
  return `£${(Number(pounds) || 0).toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

/** Today in London as YYYY-MM-DD. The reference date for every comparison. */
export function londonToday(now: Date = new Date()): string {
  // en-CA gives YYYY-MM-DD, which is the format the rest of this file expects.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now)
}
