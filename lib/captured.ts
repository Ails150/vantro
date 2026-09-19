// lib/captured.ts
//
// "Captured this month": money recorded on site this month that nobody has put
// on a payment application yet.
//
// Three sources, one number:
//   * variations and dayworks the company has approved -- approved, sent or
//     signed. Pending does not count (nobody has priced it) and invoiced is
//     already on an application.
//   * expenses approved or paid against a job. An expense with no job cannot
//     go on an application, which is per job, so it is not counted here.
//
// "This month" is the London calendar month of when it was CAPTURED -- the
// variation raised, the receipt submitted -- not when it was approved. It is
// the question a commercial manager asks at month end, before the application
// goes in: what did the site do this month that is not on it?
//
// The TODAY board and the Friday email both call summariseCaptured() over the
// rows loadCaptured() returns, so the two cannot show different numbers.
//
// PENCE, as everywhere money is added up in this product.

import { londonMidnight } from "./format-time"
import { formatPence, isUnapplied, toPence } from "./variations"

export type CapturedVariation = {
  id: string
  kind: string
  status: string
  pricePence: number | null
  capturedAt: string
}

export type CapturedExpense = {
  id: string
  status: string
  jobId: string | null
  amountPence: number | null
  capturedAt: string
}

export type Captured = {
  /** First day of the London month, YYYY-MM-DD. */
  monthStart: string
  pence: number
  variations: { count: number; pence: number }
  dayworks: { count: number; pence: number }
  expenses: { count: number; pence: number }
}

/** YYYY-MM-01 for the London month containing `now`. */
export function londonMonthStart(now: Date = new Date()): string {
  const ymd = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now)
  return `${ymd.slice(0, 7)}-01`
}

/**
 * Add it up. `applied` holds the ids already on a payment application, for
 * both variations and expenses -- they are uuids, so one set serves both.
 */
export function summariseCaptured(
  monthStart: string,
  variations: CapturedVariation[],
  expenses: CapturedExpense[],
  applied: Set<string>,
): Captured {
  const from = londonMidnight(monthStart).getTime()
  const inMonth = (at: string) => {
    const t = new Date(at).getTime()
    return Number.isFinite(t) && t >= from
  }

  const out: Captured = {
    monthStart,
    pence: 0,
    variations: { count: 0, pence: 0 },
    dayworks: { count: 0, pence: 0 },
    expenses: { count: 0, pence: 0 },
  }

  for (const v of variations) {
    if (!isUnapplied(v.status) || applied.has(v.id) || !inMonth(v.capturedAt)) continue
    // Approved always carries a price (a database check), but a null here must
    // count as nothing rather than as NaN in a figure somebody acts on.
    const p = Math.max(0, Math.round(v.pricePence ?? 0))
    const bucket = v.kind === "daywork" ? out.dayworks : out.variations
    bucket.count++
    bucket.pence += p
  }

  for (const e of expenses) {
    if (!(e.status === "approved" || e.status === "paid")) continue
    if (!e.jobId || applied.has(e.id) || !inMonth(e.capturedAt)) continue
    out.expenses.count++
    out.expenses.pence += Math.max(0, Math.round(e.amountPence ?? 0))
  }

  out.pence = out.variations.pence + out.dayworks.pence + out.expenses.pence
  return out
}

/** The one sentence on TODAY and in the email. One number in it. */
export function capturedSentence(c: Pick<Captured, "pence">): string {
  return c.pence > 0
    ? `${formatPence(c.pence)} captured this month is not on a payment application yet.`
    : "Everything captured this month is on a payment application."
}

/**
 * Read the rows for one company and add them up.
 *
 * Two bounded reads of this month's rows plus the application lines that
 * point at them. Not a SQL sum on purpose: the arithmetic lives in
 * summariseCaptured, which has tests, and a second copy of "what counts" in
 * SQL is how the board and the email end up disagreeing.
 */
export async function loadCaptured(service: any, companyId: string, now: Date = new Date()): Promise<Captured> {
  const monthStart = londonMonthStart(now)
  const fromIso = londonMidnight(monthStart).toISOString()

  const [vr, er] = await Promise.all([
    service
      .from("variations")
      .select("id, kind, status, approved_value, created_at")
      .eq("company_id", companyId)
      .in("status", ["approved", "sent", "signed"])
      .gte("created_at", fromIso)
      .limit(5000),
    service
      .from("expenses")
      .select("id, status, job_id, amount, submitted_at")
      .eq("company_id", companyId)
      .in("status", ["approved", "paid"])
      .not("job_id", "is", null)
      .gte("submitted_at", fromIso)
      .limit(5000),
  ])
  if (vr.error) throw new Error(`captured: variations: ${vr.error.message}`)
  if (er.error) throw new Error(`captured: expenses: ${er.error.message}`)

  const vIds = (vr.data || []).map((v: any) => v.id)
  const eIds = (er.data || []).map((e: any) => e.id)
  const applied = new Set<string>()
  if (vIds.length) {
    const { data } = await service.from("payment_application_lines").select("variation_id").in("variation_id", vIds)
    for (const l of data || []) applied.add(l.variation_id)
  }
  if (eIds.length) {
    const { data } = await service.from("payment_application_lines").select("expense_id").in("expense_id", eIds)
    for (const l of data || []) applied.add(l.expense_id)
  }

  return summariseCaptured(
    monthStart,
    (vr.data || []).map((v: any) => ({
      id: v.id, kind: v.kind, status: v.status, pricePence: toPence(v.approved_value), capturedAt: v.created_at,
    })),
    (er.data || []).map((e: any) => ({
      id: e.id, status: e.status, jobId: e.job_id, amountPence: toPence(e.amount), capturedAt: e.submitted_at,
    })),
    applied,
  )
}
