// app/api/admin/payroll-runs/route.ts
//
// POST { action: "open", week }            the week's timesheets were opened.
// POST { action: "approve", week }         Approve all: locks the week.
// POST { action: "unlock", week, reason }  reopens it, and logs who and why.
//
// The server works out the week and the worker count. The browser only says
// which of the two weeks it is looking at.

import { NextResponse } from "next/server"
import { toPayrollWeek, weekStartFor, workersInWeek } from "@/lib/payroll-runs"
import { buildWeekTimesheet } from "@/lib/payroll-timesheet"
import { suiteCaller } from "@/lib/suite-caller"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// Support looks at a customer's payroll to help them. That must not start the
// customer's clock, approve their week or unlock it.
const RUNNING_ROLES = ["admin", "superadmin"]

const REFUSALS = ["VT425", "VT426", "22023"]

/** The frozen timesheet holds everyone's pay. It never goes to the browser. */
function publicRun(row: any) {
  if (!row) return null
  const { xero_snapshot: _omitted, ...rest } = row
  return rest
}

export async function POST(request: Request) {
  const c = await suiteCaller("payrollExport")
  if ("error" in c) return c.error

  const body = await request.json().catch(() => ({}))
  const week = toPayrollWeek(body.week)
  if (!week) return NextResponse.json({ error: "Unknown week" }, { status: 400 })

  const weekStart = weekStartFor(week)
  const canApprove = RUNNING_ROLES.includes(c.ctx.role)
  const args = { p_company_id: c.companyId, p_week_start: weekStart, p_user_id: c.ctx.userId }

  if (body.action === "open") {
    if (!canApprove) {
      const { data, error } = await c.service.from("payroll_runs")
        .select("week_start, opened_at, approved_at, workers_count, minutes_taken")
        .eq("company_id", c.companyId).eq("week_start", weekStart).maybeSingle()
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json({ run: data || null, canApprove })
    }
    const { data, error } = await c.service.rpc("payroll_run_open", args)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ run: publicRun(data?.[0]), canApprove })
  }

  if (!canApprove) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  if (body.action === "approve") {
    let workers: number
    try {
      workers = await workersInWeek(c.service, c.companyId, weekStart)
    } catch (e: any) {
      console.error("[api/admin/payroll-runs]", e?.message)
      return NextResponse.json({ error: "Could not count the workers. Try again." }, { status: 500 })
    }
    if (workers === 0) {
      return NextResponse.json({ error: "There are no finished shifts to approve in this week." }, { status: 409 })
    }

    const { data, error } = await c.service.rpc("payroll_run_approve", { ...args, p_workers: workers })
    if (error) {
      const refused = REFUSALS.includes(error.code)
      return NextResponse.json({ error: error.message }, { status: refused ? 409 : 500 })
    }
    const run = data?.[0]
    if (!run) return NextResponse.json({ error: "Open the week first." }, { status: 409 })
    if (run.xero_snapshot) return NextResponse.json({ run: publicRun(run), canApprove })

    // Built AFTER the lock, so it is exactly what was locked. If it cannot be
    // built the week goes back to unapproved rather than locked with no file.
    try {
      const xero_snapshot = await buildWeekTimesheet(c.service, c.companyId, weekStart)
      const { error: saveError } = await c.service.from("payroll_runs")
        .update({ xero_snapshot, xero_snapshot_cleared_at: null, xero_snapshot_cleared_reason: null }).eq("id", run.id)
      if (saveError) throw new Error(saveError.message)
    } catch (e: any) {
      console.error("[api/admin/payroll-runs] could not freeze timesheet", e?.message)
      await c.service.rpc("payroll_run_unlock", { ...args, p_reason: "System: the Xero timesheet could not be built at approval." })
      return NextResponse.json({ error: "Could not lock the week. Nothing was approved. Try again." }, { status: 500 })
    }
    return NextResponse.json({ run: publicRun(run), canApprove })
  }

  if (body.action === "unlock") {
    const reason = typeof body.reason === "string" ? body.reason.trim() : ""
    if (!reason) return NextResponse.json({ error: "Say why this week is being unlocked." }, { status: 400 })
    const { data, error } = await c.service.rpc("payroll_run_unlock", { ...args, p_reason: reason })
    if (error) {
      return NextResponse.json({ error: error.message }, { status: REFUSALS.includes(error.code) ? 409 : 500 })
    }
    return NextResponse.json({ run: publicRun(data?.[0]), canApprove })
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 })
}
