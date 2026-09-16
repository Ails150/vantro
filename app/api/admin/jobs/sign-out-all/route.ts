// app/api/admin/jobs/sign-out-all/route.ts
//
// POST { jobId } -- close every open shift on a job.
//
// WHY THIS EXISTS AS A ROUTE. It used to be a browser call:
//
//   supabase.from("signins").update({ signed_out_at: ... })
//           .eq("job_id", jobId).is("signed_out_at", null)
//
// straight from AdminDashboard, with the anon key and the admin's own session.
// That one line was the reason RLS on signins had to allow any authenticated
// company member to UPDATE evidence, which meant an admin or foreman could edit
// any attendance row through PostgREST, bypassing every check in this layer.
// The security pass found it (section D16) and it is the blocker on tightening
// the policy.
//
// Moving it here costs one round trip and buys a database where no client
// session can write to an evidence table at all.
//
// WHAT IT DOES NOT DO. It does not guess an hours figure. signed_out_at is set
// to now and hours_worked is left to the same calculation every other sign-out
// path uses -- inventing a duration here would put a number on a payroll export
// that nobody worked.

import { NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/server"
import { getCallerContext } from "@/lib/company-context"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// Foreman included: closing out a finished job is a supervisor's job, and it is
// what the button did before it moved.
const ROLES = ["admin", "foreman", "superadmin", "support"]

export async function POST(request: Request) {
  const ctx = await getCallerContext()
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!ROLES.includes(ctx.role) || !ctx.companyId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const body = await request.json().catch(() => null)
  if (!body?.jobId) return NextResponse.json({ error: "jobId is required" }, { status: 400 })

  const service = await createServiceClient()

  // Scoped by company as well as by id. The job id comes from the client, and
  // the update below would otherwise close shifts on another tenant's job.
  const { data: job } = await service
    .from("jobs")
    .select("id, name")
    .eq("id", body.jobId)
    .eq("company_id", ctx.companyId)
    .maybeSingle()

  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 })

  const closedAt = new Date().toISOString()
  const { data: closed, error } = await service
    .from("signins")
    .update({
      signed_out_at: closedAt,
      auto_closed: true,
      auto_closed_reason: "job_closed_by_admin",
    })
    .eq("job_id", body.jobId)
    .eq("company_id", ctx.companyId)
    .is("signed_out_at", null)
    .select("id")

  if (error) {
    console.error("[sign-out-all] failed:", error.message)
    return NextResponse.json({ error: "Could not sign everyone out" }, { status: 500 })
  }

  // Logged because it closes somebody else's shift. auto_closed_reason records
  // it on the row too, so a worker asking why their day ended at 14:02 has an
  // answer that does not depend on a log.
  console.log(
    `[sign-out-all] job=${body.jobId} company=${ctx.companyId} by=${ctx.userId} ` +
      `closed=${(closed ?? []).length}`,
  )

  return NextResponse.json({ ok: true, closed: (closed ?? []).length })
}
