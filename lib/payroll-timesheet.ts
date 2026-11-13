// lib/payroll-timesheet.ts
//
// Builds one week's Xero timesheet. Approve all freezes the result on the
// payroll run, and the export serves that frozen copy, so nothing that changes
// after approval (a rate, a pay rule) can alter a locked week.

import { addDays, formatIn, isoWeekStart, londonMidnight } from "./format-time"
import { resolveRate, toPayRules } from "./pay"
import { buildPayrollLines, toPayrollCsv, totalPay } from "./payroll-export"

/**
 * Day columns, Monday first.
 *
 * Kept even though the file is one row per worker PER PAY TYPE: a bookkeeper
 * checking a week against a clock-in sheet reads across the days.
 */
const DAY_HEADERS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

/** VTR-TS-20260907. Stable for a week, so it can be quoted and matched. */
export function timesheetRef(weekStart: string): string {
  return `VTR-TS-${weekStart.replace(/-/g, "")}`
}

export type TimesheetSnapshot = {
  csv: string
  ref: string
  signinCount: number
  /** PAID hours, after overlapping minutes have been removed. */
  totalHours: number
  employeeCount: number
  totalPay: number
  overlapTrimmed: number
  dateFrom: string
  dateTo: string
}

export async function buildWeekTimesheet(service: any, companyId: string, weekStart: string): Promise<TimesheetSnapshot> {
  const weekEnd = addDays(weekStart, 7)
  const from = londonMidnight(weekStart)
  const until = londonMidnight(weekEnd)

  const { data: signins, error: readErr } = await service
    .from("signins")
    .select("id, user_id, signed_in_at, signed_out_at, hours_worked, users:user_id (id, name, email)")
    .eq("company_id", companyId)
    .gte("signed_in_at", from.toISOString())
    .lt("signed_in_at", until.toISOString())
    .order("signed_in_at", { ascending: true })
  if (readErr) throw new Error(`could not read shifts: ${readErr.message}`)
  const rows = signins || []

  const { data: rulesRow } = await service.from("pay_rules").select("*").eq("company_id", companyId).maybeSingle()
  const rules = toPayRules(rulesRow)

  const { data: company } = await service
    .from("companies").select("id, country_code, default_hourly_rate").eq("id", companyId).single()

  // Filtered by the company's own country. public_holidays is multi-country and
  // an unfiltered read would pay a UK crew double time for US Labor Day.
  const { data: holidays } = await service
    .from("public_holidays")
    .select("holiday_date")
    .eq("country_code", company?.country_code || "GB")
    .gte("holiday_date", weekStart)
    .lt("holiday_date", weekEnd)
  const holidayDates = new Set<string>((holidays || []).map((h: any) => h.holiday_date))

  const { data: bonusRows } = await service
    .from("pay_bonuses")
    .select("user_id, amount, reason")
    .eq("company_id", companyId)
    .gte("awarded_on", weekStart)
    .lt("awarded_on", weekEnd)

  const { data: staff } = await service
    .from("users").select("id, name, email, hourly_rate").eq("company_id", companyId)
  const staffById = new Map((staff || []).map((u: any) => [u.id, u]))
  const rateOf = (user: any) => resolveRate(user?.hourly_rate ?? null, company?.default_hourly_rate ?? null).rate

  // CLOSED shifts only. An open shift has no payable total yet.
  const byWorker = new Map<string, any>()
  for (const s of rows as any[]) {
    if (!s.signed_out_at) continue
    const user: any = staffById.get(s.user_id)
    const entry = byWorker.get(s.user_id) || {
      userId: s.user_id,
      name: s.users?.name || user?.name || "Unknown",
      // Email, because that is what Xero matches an employee on.
      email: s.users?.email || user?.email || "",
      rate: rateOf(user),
      shifts: [] as any[],
      bonuses: [] as any[],
    }
    entry.shifts.push({ id: s.id, signedInAt: s.signed_in_at, signedOutAt: s.signed_out_at })
    byWorker.set(s.user_id, entry)
  }

  for (const b of (bonusRows || []) as any[]) {
    const entry = byWorker.get(b.user_id)
    // A bonus for somebody with no shifts this week still has to be paid.
    if (entry) { entry.bonuses.push({ amount: Number(b.amount), reason: b.reason }); continue }
    const user: any = staffById.get(b.user_id)
    if (!user) continue
    byWorker.set(b.user_id, {
      userId: b.user_id, name: user.name, email: user.email || "", rate: rateOf(user),
      shifts: [], bonuses: [{ amount: Number(b.amount), reason: b.reason }],
    })
  }

  const dayIndexOf = (iso: string) => {
    const i = DAY_HEADERS.indexOf(formatIn(iso, { weekday: "short" }))
    return i < 0 ? 0 : i
  }
  const dateKeyOf = (iso: string) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit",
    }).format(new Date(iso))

  const lines = buildPayrollLines(Array.from(byWorker.values()), rules, holidayDates, dayIndexOf, dateKeyOf)

  const dayLabels = DAY_HEADERS.map((d, i) =>
    `${d} ${formatIn(londonMidnight(addDays(weekStart, i)), { day: "2-digit", month: "short" })}`)

  return {
    csv: toPayrollCsv(lines, dayLabels),
    ref: timesheetRef(weekStart),
    signinCount: rows.length,
    totalHours: Number(lines.reduce((a, l) => a + (l.hours ?? 0), 0).toFixed(2)),
    employeeCount: byWorker.size,
    totalPay: totalPay(lines),
    overlapTrimmed: new Set(lines.filter(l => l.overlapTrimmed).map(l => l.employee)).size,
    dateFrom: from.toISOString(),
    dateTo: until.toISOString(),
  }
}

/** Why a week can or cannot go to Xero. Only an approved, frozen week can. */
export function xeroExportState(
  run: { approved_at: string | null; xero_snapshot: unknown; xero_snapshot_cleared_reason?: string | null } | null | undefined,
): { ok: true } | { ok: false; error: string } {
  if (!run?.approved_at) return { ok: false, error: "Approve this week on the Payroll tab before exporting it to Xero." }
  if (!run.xero_snapshot && run.xero_snapshot_cleared_reason === "erasure") {
    return { ok: false, error: "This week's Xero file was cleared when a worker's data was erased. Unlock it and approve it again to rebuild it without their name." }
  }
  if (!run.xero_snapshot) return { ok: false, error: "This week was approved before weeks were locked. Unlock it and approve it again." }
  return { ok: true }
}

/**
 * Erasure: clear the frozen Xero timesheet on every approved week this worker
 * has shifts in. The snapshot is a CSV holding their name and email, kept on
 * the payroll run, so anonymising the users row alone would leave both behind.
 *
 * The shifts themselves are kept on erasure (lib/gdpr.ts), so they are what
 * says which weeks to clear. Throws on any read or write error: the caller must
 * not report a person erased while their name is still in a file.
 */
export async function clearSnapshotsForWorker(service: any, companyId: string, userId: string): Promise<number> {
  const { data: shifts, error: readErr } = await service
    .from("signins").select("signed_in_at")
    .eq("company_id", companyId).eq("user_id", userId)
    .limit(100000)
  if (readErr) throw new Error(`could not read shifts: ${readErr.message}`)
  const weeks = [...new Set((shifts || []).filter((s: any) => s.signed_in_at).map((s: any) => isoWeekStart(s.signed_in_at)))]
  let cleared = 0
  for (let i = 0; i < weeks.length; i += 200) {
    const { data, error } = await service
      .from("payroll_runs")
      .update({ xero_snapshot: null, xero_snapshot_cleared_at: new Date().toISOString(), xero_snapshot_cleared_reason: "erasure" })
      .eq("company_id", companyId)
      .in("week_start", weeks.slice(i, i + 200))
      .not("xero_snapshot", "is", null)
      .select("id")
    if (error) throw new Error(`could not clear Xero snapshots: ${error.message}`)
    cleared += (data || []).length
  }
  return cleared
}
