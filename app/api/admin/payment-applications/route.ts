// app/api/admin/payment-applications/route.ts
//
// GET                        every application on this company, with its lines
// POST   { jobId }           add everything eligible on the job to its draft
//                            application, opening one if there is none
// PATCH  { id, action: "submit" }   mark an application submitted; its lines
//                                   are then fixed (database guard)
// DELETE ?lineId=...         take one line back off a draft
//
// "Eligible" is decided in SQL, in one transaction (add_to_payment_application,
// 20260919100000): signed variations and dayworks, and approved or paid
// expenses, on that job, not already on any application. The route does not
// pick lines itself, because a line chosen here and a status changed there is
// two writes, and two writes is a window in which the same variation can be
// claimed twice.

import { NextResponse } from "next/server"
import { suiteCaller } from "@/lib/suite-caller"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  const c = await suiteCaller("variations")
  if ("error" in c) return c.error
  const { service, companyId } = c

  const { data: apps, error } = await service
    .from("payment_applications")
    .select("id, job_id, number, status, created_at, submitted_at, jobs(name, contractor), " +
            "payment_application_lines(id, source, variation_id, expense_id, description, amount_pence, created_at)")
    .eq("company_id", companyId)
    .order("created_at", { ascending: false })
    .limit(500)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    applications: (apps || []).map((a: any) => {
      const lines = (a.payment_application_lines || [])
        .map((l: any) => ({
          id: l.id,
          source: l.source,
          variationId: l.variation_id,
          expenseId: l.expense_id,
          description: l.description,
          amountPence: Number(l.amount_pence),
          createdAt: l.created_at,
        }))
        .sort((x: any, y: any) => x.createdAt.localeCompare(y.createdAt))
      return {
        id: a.id,
        jobId: a.job_id,
        jobName: a.jobs?.name || "",
        contractor: a.jobs?.contractor || null,
        number: a.number,
        status: a.status,
        createdAt: a.created_at,
        submittedAt: a.submitted_at,
        lines,
        totalPence: lines.reduce((t: number, l: any) => t + l.amountPence, 0),
      }
    }),
  })
}

export async function POST(request: Request) {
  const c = await suiteCaller("variations")
  if ("error" in c) return c.error
  const { service, companyId, ctx } = c

  const body = await request.json().catch(() => ({}))
  const jobId = typeof body.jobId === "string" ? body.jobId : ""
  if (!jobId) return NextResponse.json({ error: "jobId is required" }, { status: 400 })

  const { data, error } = await service.rpc("add_to_payment_application", {
    p_company_id: companyId,
    p_job_id: jobId,
    p_user_id: ctx.userId,
  })
  if (error) {
    const notOurs = /not in company/i.test(error.message)
    return NextResponse.json({ error: notOurs ? "Job not found" : error.message }, { status: notOurs ? 404 : 500 })
  }

  const row = Array.isArray(data) ? data[0] : data
  return NextResponse.json({
    ok: true,
    applicationId: row?.application_id,
    number: row?.application_number,
    linesAdded: row?.lines_added ?? 0,
  })
}

export async function PATCH(request: Request) {
  const c = await suiteCaller("variations")
  if ("error" in c) return c.error
  const { service, companyId, ctx } = c

  const body = await request.json().catch(() => ({}))
  if (body.action !== "submit" || typeof body.id !== "string") {
    return NextResponse.json({ error: "Unknown action" }, { status: 400 })
  }

  const { data: app } = await service
    .from("payment_applications")
    .select("id, company_id, status, payment_application_lines(id)")
    .eq("id", body.id)
    .maybeSingle()
  if (!app || app.company_id !== companyId) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (app.status === "submitted") return NextResponse.json({ error: "Already submitted" }, { status: 409 })
  if (!(app.payment_application_lines || []).length) {
    return NextResponse.json({ error: "Nothing on it yet" }, { status: 409 })
  }

  const { error } = await service
    .from("payment_applications")
    .update({ status: "submitted", submitted_at: new Date().toISOString(), submitted_by: ctx.userId })
    .eq("id", body.id)
    .eq("company_id", companyId)
  if (error) return NextResponse.json({ error: error.message }, { status: 409 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(request: Request) {
  const c = await suiteCaller("variations")
  if ("error" in c) return c.error
  const { service, companyId } = c

  const lineId = new URL(request.url).searchParams.get("lineId")
  if (!lineId) return NextResponse.json({ error: "lineId is required" }, { status: 400 })

  const { error } = await service.rpc("remove_payment_application_line", {
    p_company_id: companyId,
    p_line_id: lineId,
  })
  if (error) {
    const status = /not found/i.test(error.message) ? 404 : /submitted/i.test(error.message) ? 409 : 500
    return NextResponse.json({ error: error.message }, { status })
  }
  return NextResponse.json({ ok: true })
}
