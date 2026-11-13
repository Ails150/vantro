// app/api/payroll/xero/route.ts
//
// Xero timesheet export, one per company per payroll week.
//
//   GET  /api/payroll/xero?weekStart=YYYY-MM-DD  → the export record, if any
//   POST /api/payroll/xero  { weekStart }        → the approved week's CSV
//
// Only an approved week can be exported, and what comes out is the timesheet
// frozen at approval (lib/payroll-timesheet.ts). A correction means unlocking,
// editing and approving again.
//
// The rule this endpoint exists to keep: re-exporting a week UPDATES that
// week's timesheet and never creates a second one. Two timesheets for the same
// employee and week is a double payment.
//
// Idempotency is keyed on (company_id, xero_week_start) and enforced by a
// unique index, not by a read-then-write in this handler -- see the migration
// 20260911090000. Two admins pressing the button at the same second both end
// up on the same row.

import { NextResponse } from "next/server"
import { createClient, createServiceClient } from "@/lib/supabase/server"
import { isoWeekStart, londonMidnight } from "@/lib/format-time"
import { xeroExportState, type TimesheetSnapshot } from "@/lib/payroll-timesheet"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const ADMIN_ROLES = ["admin", "foreman", "superadmin"]

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
 * Accepting any day in the week and snapping to Monday is on purpose: "export
 * the week containing Thursday" and "export the week starting Monday" must not
 * be able to produce two different timesheets.
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

// ─── POST: the approved week's timesheet ────────────────────────────────────
export async function POST(request: Request) {
  const auth = await requireAdmin()
  if ("error" in auth) return auth.error
  const { admin, service } = auth

  const body = await request.json().catch(() => ({}))
  const resolved = resolveWeekStart(body?.weekStart)
  if ("error" in resolved) return NextResponse.json({ error: resolved.error }, { status: 400 })
  const { weekStart } = resolved

  const { data: run, error: runErr } = await service
    .from("payroll_runs")
    .select("approved_at, xero_snapshot, xero_snapshot_cleared_reason")
    .eq("company_id", admin.company_id)
    .eq("week_start", weekStart)
    .maybeSingle()
  if (runErr) {
    return NextResponse.json({ error: "Could not read the payroll week", detail: runErr.message }, { status: 500 })
  }

  const state = xeroExportState(run)
  if (!state.ok) return NextResponse.json({ error: state.error, code: "WEEK_NOT_APPROVED" }, { status: 409 })
  const snapshot = run!.xero_snapshot as TimesheetSnapshot

  // Upsert on the unique (company_id, xero_week_start) index. This is the
  // whole idempotency guarantee, and it is one statement so a concurrent
  // export cannot squeeze a second row in between a read and a write.
  const { data: exportRow, error: upsertErr } = await service
    .from("payroll_exports")
    .upsert({
      company_id: admin.company_id,
      exported_by: admin.id,
      date_from: snapshot.dateFrom,
      date_to: snapshot.dateTo,
      signin_count: snapshot.signinCount,
      total_hours: snapshot.totalHours,
      xero_week_start: weekStart,
      xero_timesheet_ref: snapshot.ref,
      updated_at: new Date().toISOString(),
    }, { onConflict: "company_id,xero_week_start" })
    .select("id, xero_timesheet_ref")
    .single()

  if (upsertErr || !exportRow) {
    return NextResponse.json(
      { error: "Could not record the export", detail: upsertErr?.message },
      { status: 500 },
    )
  }

  return new NextResponse(snapshot.csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${snapshot.ref}.csv"`,
      // Stable across re-exports of the same week.
      "X-Export-Id": exportRow.id,
      "X-Timesheet-Ref": exportRow.xero_timesheet_ref || snapshot.ref,
      "X-Week-Start": weekStart,
      "X-Employee-Count": String(snapshot.employeeCount),
      "X-Total-Hours": snapshot.totalHours.toFixed(2),
      // The figure a payroll run must reach.
      "X-Total-Pay": snapshot.totalPay.toFixed(2),
      "X-Overlap-Trimmed": String(snapshot.overlapTrimmed),
    },
  })
}
