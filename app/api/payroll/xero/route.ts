// app/api/payroll/xero/route.ts
//
// Xero timesheet export, one per company per payroll week.
//
//   GET  /api/payroll/xero?weekStart=YYYY-MM-DD  → the export record, if any
//   POST /api/payroll/xero  { weekStart }        → build/rebuild + return CSV
//
// The rule this endpoint exists to keep: re-exporting a week UPDATES that
// week's timesheet and never creates a second one. Two timesheets for the same
// employee and week is a double payment, and the admin who re-exports after
// correcting a shift is doing something completely reasonable.
//
// Idempotency is keyed on (company_id, xero_week_start) and enforced by a
// unique index, not by a read-then-write in this handler -- see the migration
// 20260911090000. Two admins pressing the button at the same second both end
// up on the same row.
//
// Deliberately unlike the CSV export next door: that one locks the rows it
// exports (payroll_exported_at) so they cannot be edited afterwards. This one
// does NOT lock, because locking would make a week exportable exactly once,
// which is the opposite of what is being asked for here. A correction followed
// by a re-export is how a mistake reaches Xero.

import { NextResponse } from "next/server"
import { createClient, createServiceClient } from "@/lib/supabase/server"
import { addDays, formatIn, isoWeekStart, londonMidnight } from "@/lib/format-time"
import { resolveRate, toPayRules } from "@/lib/pay"
import { buildPayrollLines, toPayrollCsv, totalPay } from "@/lib/payroll-export"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const ADMIN_ROLES = ["admin", "foreman", "superadmin"]

/**
 * Day columns, Monday first.
 *
 * Kept even though the file is now one row per worker PER PAY TYPE rather than
 * one row per worker: a bookkeeper checking a week against a clock-in sheet
 * reads across the days, and losing that would make the file harder to verify
 * than the version it replaces.
 */
const DAY_HEADERS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

/** VTR-TS-20260907. Stable for a week, so it can be quoted and matched. */
function timesheetRef(weekStart: string): string {
  return `VTR-TS-${weekStart.replace(/-/g, "")}`
}

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }

  const service = await createServiceClient()
  const { data: admin } = await service
    .from("users")
    .select("id, company_id, role")
    .eq("auth_user_id", user.id)
    .single()
  if (!admin || !ADMIN_ROLES.includes(admin.role)) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) }
  }
  return { admin, service }
}

/**
 * Normalise whatever the caller sent into the Monday of that payroll week.
 *
 * Accepting any day in the week and snapping to Monday is on purpose: it makes
 * the endpoint idempotent for callers too. "Export the week containing
 * Thursday" and "export the week starting Monday" must not be able to produce
 * two different timesheets.
 */
function resolveWeekStart(raw: unknown): { weekStart: string } | { error: string } {
  const value = typeof raw === "string" && raw.trim() ? raw.trim() : null
  if (!value) return { error: "weekStart is required, as YYYY-MM-DD" }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return { error: "weekStart must be YYYY-MM-DD" }
  try {
    return { weekStart: isoWeekStart(londonMidnight(value)) }
  } catch {
    return { error: `weekStart is not a real date: ${value}` }
  }
}

// ─── GET: what has already been exported for this week ──────────────────────
export async function GET(request: Request) {
  const auth = await requireAdmin()
  if ("error" in auth) return auth.error
  const { admin, service } = auth

  const resolved = resolveWeekStart(new URL(request.url).searchParams.get("weekStart"))
  if ("error" in resolved) return NextResponse.json({ error: resolved.error }, { status: 400 })

  const { data: rows, error } = await service
    .from("payroll_exports")
    .select("id, xero_week_start, xero_timesheet_ref, signin_count, total_hours, created_at, updated_at")
    .eq("company_id", admin.company_id)
    .eq("xero_week_start", resolved.weekStart)

  if (error) {
    return NextResponse.json({ error: "Could not read exports", detail: error.message }, { status: 500 })
  }

  return NextResponse.json({
    weekStart: resolved.weekStart,
    // An array, not a single object: the test asserts its length is 1, which
    // is the whole claim this endpoint makes.
    exports: rows || [],
    export: rows?.[0] || null,
  })
}

// ─── POST: build or rebuild the week's timesheet ────────────────────────────
export async function POST(request: Request) {
  const auth = await requireAdmin()
  if ("error" in auth) return auth.error
  const { admin, service } = auth

  const body = await request.json().catch(() => ({}))
  const resolved = resolveWeekStart(body?.weekStart)
  if ("error" in resolved) return NextResponse.json({ error: resolved.error }, { status: 400 })
  const { weekStart } = resolved

  const weekEnd = addDays(weekStart, 7)
  const from = londonMidnight(weekStart)
  const until = londonMidnight(weekEnd)

  // Every signin in the week, not only the unexported ones. A rebuild has to
  // reproduce the whole timesheet, otherwise the second export would be a
  // timesheet of nothing.
  const { data: signins, error: readErr } = await service
    .from("signins")
    .select(`
      id, user_id, signed_in_at, signed_out_at, hours_worked,
      users:user_id (id, name, email)
    `)
    .eq("company_id", admin.company_id)
    .gte("signed_in_at", from.toISOString())
    .lt("signed_in_at", until.toISOString())
    .order("signed_in_at", { ascending: true })

  if (readErr) {
    return NextResponse.json({ error: "Could not read shifts", detail: readErr.message }, { status: 500 })
  }

  const rows = signins || []

  // --- Pay rules, rates and holidays --------------------------------------
  //
  // The export used to be hours only, under a single "Ordinary Hours" rate,
  // with overtime buried inside the totals and no rate anywhere. A payroll run
  // computed from it could not reach the same figure the app shows. Everything
  // below exists to close that gap.
  const { data: rulesRow } = await service
    .from("pay_rules").select("*").eq("company_id", admin.company_id).maybeSingle()
  const rules = toPayRules(rulesRow)

  const { data: company } = await service
    .from("companies").select("id, country_code, default_hourly_rate")
    .eq("id", admin.company_id).single()

  // Filtered by the company's own country. public_holidays is multi-country and
  // an unfiltered read would pay a UK crew double time for US Labor Day.
  const { data: holidays } = await service
    .from("public_holidays")
    .select("holiday_date")
    .eq("country_code", (company as any)?.country_code || "GB")
    .gte("holiday_date", weekStart)
    .lt("holiday_date", weekEnd)
  const holidayDates = new Set((holidays || []).map((h: any) => h.holiday_date))

  const { data: bonusRows } = await service
    .from("pay_bonuses")
    .select("user_id, amount, reason")
    .eq("company_id", admin.company_id)
    .gte("awarded_on", weekStart)
    .lt("awarded_on", weekEnd)

  const { data: staff } = await service
    .from("users").select("id, name, email, hourly_rate").eq("company_id", admin.company_id)
  const staffById = new Map((staff || []).map((u: any) => [u.id, u]))

  // --- Group the week's shifts by worker -----------------------------------
  //
  // CLOSED shifts only. An open shift has no payable total yet, and guessing
  // one would put hours on a timesheet nobody has worked.
  const byWorker = new Map<string, any>()
  let totalHours = 0
  for (const s of rows as any[]) {
    if (!s.signed_out_at) continue
    const user = staffById.get(s.user_id)
    const entry = byWorker.get(s.user_id) || {
      userId: s.user_id,
      name: s.users?.name || user?.name || "Unknown",
      // Email, because that is what Xero matches an employee on.
      email: s.users?.email || user?.email || "",
      rate: resolveRate(user?.hourly_rate ?? null, (company as any)?.default_hourly_rate ?? null).rate,
      shifts: [] as any[],
      bonuses: [] as any[],
    }
    entry.shifts.push({ id: s.id, signedInAt: s.signed_in_at, signedOutAt: s.signed_out_at })
    byWorker.set(s.user_id, entry)
  }

  for (const b of (bonusRows || []) as any[]) {
    const entry = byWorker.get(b.user_id)
    // A bonus for somebody with no shifts this week still has to be paid, so
    // they are added to the export rather than dropped.
    if (entry) { entry.bonuses.push({ amount: Number(b.amount), reason: b.reason }); continue }
    const user = staffById.get(b.user_id)
    if (!user) continue
    byWorker.set(b.user_id, {
      userId: b.user_id, name: user.name, email: user.email || "",
      rate: resolveRate(user.hourly_rate ?? null, (company as any)?.default_hourly_rate ?? null).rate,
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

  const lines = buildPayrollLines(
    Array.from(byWorker.values()),
    rules,
    holidayDates,
    dayIndexOf,
    dateKeyOf,
  )

  // Hours reported on the export record are the PAID hours, after overlapping
  // minutes have been removed. The recorded shifts may add up to more, and that
  // difference is what the overlap flag exists to explain.
  totalHours = lines.reduce((a, l) => a + (l.hours ?? 0), 0)
  const pay = totalPay(lines)
  const overlapCount = new Set(lines.filter(l => l.overlapTrimmed).map(l => l.employee)).size

  const ref = timesheetRef(weekStart)
  const summary = {
    company_id: admin.company_id,
    exported_by: admin.id,
    date_from: from.toISOString(),
    date_to: until.toISOString(),
    signin_count: rows.length,
    total_hours: Number(totalHours.toFixed(2)),
    xero_week_start: weekStart,
    xero_timesheet_ref: ref,
    updated_at: new Date().toISOString(),
  }

  // Upsert on the unique (company_id, xero_week_start) index. This is the
  // whole idempotency guarantee, and it is one statement so a concurrent
  // export cannot squeeze a second row in between a read and a write.
  const { data: exportRow, error: upsertErr } = await service
    .from("payroll_exports")
    .upsert(summary, { onConflict: "company_id,xero_week_start" })
    .select("id, xero_timesheet_ref")
    .single()

  if (upsertErr || !exportRow) {
    return NextResponse.json(
      { error: "Could not record the export", detail: upsertErr?.message },
      { status: 500 },
    )
  }

  const dayDates = DAY_HEADERS.map((_, i) => addDays(weekStart, i))
  const dayLabels = DAY_HEADERS.map(
    (d, i) => `${d} ${formatIn(londonMidnight(dayDates[i]), { day: "2-digit", month: "short" })}`,
  )
  const csv = toPayrollCsv(lines, dayLabels)

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${ref}.csv"`,
      // Stable across re-exports of the same week. The e2e test asserts on it,
      // and so can anyone debugging a duplicate in Xero.
      "X-Export-Id": exportRow.id,
      "X-Timesheet-Ref": exportRow.xero_timesheet_ref || ref,
      "X-Week-Start": weekStart,
      "X-Employee-Count": String(byWorker.size),
      "X-Total-Hours": totalHours.toFixed(2),
      // The figure a payroll run must reach. The old export could not state it.
      "X-Total-Pay": pay.toFixed(2),
      "X-Overlap-Trimmed": String(overlapCount),
    },
  })
}
