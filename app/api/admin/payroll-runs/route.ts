// app/api/admin/payroll-runs/route.ts
//
// POST { action: "open", week }     the timesheets for a week have been opened.
// POST { action: "approve", week }  Approve all was pressed.
//
// The server works out the week and the worker count. The browser only says
// which of the two weeks it is looking at.

import { NextResponse } from "next/server"
import { toPayrollWeek, weekStartFor, workersInWeek } from "@/lib/payroll-runs"
import { suiteCaller } from "@/lib/suite-caller"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// Support looks at a customer's payroll to help them. That must not start the
// customer's clock or approve their week.
const RUNNING_ROLES = ["admin", "superadmin"]

export async function POST(request: Request) {
  const c = await suiteCaller("payrollExport")
  if ("error" in c) return c.error

  const body = await request.json().catch(() => ({}))
  const week = toPayrollWeek(body.week)
  if (!week) return NextResponse.json({ error: "Unknown week" }, { status: 400 })

  const weekStart = weekStartFor(week)
  const canApprove = RUNNING_ROLES.includes(c.ctx.role)

  if (body.action === "open") {
    if (!canApprove) {
      const { data, error } = await c.service.from("payroll_runs")
        .select("week_start, opened_at, approved_at, workers_count, minutes_taken")
        .eq("company_id", c.companyId).eq("week_start", weekStart).maybeSingle()
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json({ run: data || null, canApprove })
    }
    const { data, error } = await c.service.rpc("payroll_run_open", {
      p_company_id: c.companyId, p_week_start: weekStart, p_user_id: c.ctx.userId,
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ run: data?.[0] || null, canApprove })
  }

  if (body.action === "approve") {
    if (!canApprove) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

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

    const { data, error } = await c.service.rpc("payroll_run_approve", {
      p_company_id: c.companyId, p_week_start: weekStart, p_user_id: c.ctx.userId, p_workers: workers,
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!data?.[0]) return NextResponse.json({ error: "Open the week first." }, { status: 409 })
    return NextResponse.json({ run: data[0], canApprove })
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 })
}
