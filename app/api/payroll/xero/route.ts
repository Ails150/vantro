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

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const ADMIN_ROLES = ["admin", "foreman", "superadmin"]

/** Xero's timesheet import wants one row per employee with a column per day. */
const DAY_HEADERS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

function csvEscape(value: any): string {
  if (value === null || value === undefined) return ""
  const s = String(value)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function hoursOf(signin: any): number {
  if (signin.hours_worked != null) return Number(signin.hours_worked)
  if (signin.signed_in_at && signin.signed_out_at) {
    const ms = new Date(signin.signed_out_at).getTime() - new Date(signin.signed_in_at).getTime()
    return ms > 0 ? ms / 3600000 : 0
  }
  // Still on site. An open shift has no payable total yet, and guessing one
  // would put hours on a timesheet that nobody has worked.
  return 0
}

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

  // employee -> day index -> hours
  const byEmployee = new Map<string, { name: string; email: string; days: number[] }>()
  let totalHours = 0
  for (const s of rows as any[]) {
    const hours = hoursOf(s)
    totalHours += hours
    const dayIndex = DAY_HEADERS.indexOf(formatIn(s.signed_in_at, { weekday: "short" }))
    if (dayIndex < 0) continue
    const key = s.user_id
    const entry = byEmployee.get(key) || {
      name: s.users?.name || "Unknown",
      // Email, because that is what Xero matches an employee on. There is no
      // payroll reference on users to export, and inventing one here would
      // produce a column nobody can reconcile.
      email: s.users?.email || "",
      days: [0, 0, 0, 0, 0, 0, 0],
    }
    entry.days[dayIndex] += hours
    byEmployee.set(key, entry)
  }

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

  // ─── CSV, in Xero's timesheet import shape ───────────────────────────────
  const dayDates = DAY_HEADERS.map((_, i) => addDays(weekStart, i))
  const header = [
    "Employee",
    "Email",
    "Earnings Rate",
    ...DAY_HEADERS.map((d, i) => `${d} ${formatIn(londonMidnight(dayDates[i]), { day: "2-digit", month: "short" })}`),
    "Total",
  ]
  const lines = [header.join(",")]

  for (const entry of Array.from(byEmployee.values()).sort((a, b) => a.name.localeCompare(b.name))) {
    const total = entry.days.reduce((acc, h) => acc + h, 0)
    lines.push([
      csvEscape(entry.name),
      csvEscape(entry.email),
      csvEscape("Ordinary Hours"),
      ...entry.days.map((h) => csvEscape(h.toFixed(2))),
      csvEscape(total.toFixed(2)),
    ].join(","))
  }

  const csv = lines.join("\n")

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
      "X-Employee-Count": String(byEmployee.size),
      "X-Total-Hours": totalHours.toFixed(2),
    },
  })
}
