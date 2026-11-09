// app/api/admin/schemes/register/route.ts
//
// POST  register a signed off job, or retry one. Sign-off calls the same
// registerJob, so a retry is the original path and not a second version of it.

import { NextResponse } from "next/server"
import { DASHBOARD_ROLES, getCallerContext } from "@/lib/company-context"
import { schemeFeatureEnabled } from "@/lib/schemes/driver"
import { registerJob } from "@/lib/schemes/register"
import { supabaseSchemeStore } from "@/lib/schemes/store"
import { createServiceClient } from "@/lib/supabase/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  const ctx = await getCallerContext()
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!(DASHBOARD_ROLES as readonly string[]).includes(ctx.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  if (!ctx.companyId) return NextResponse.json({ error: "No company selected" }, { status: 400 })
  if (!schemeFeatureEnabled(ctx.companyId)) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const body = await request.json().catch(() => ({}))
  if (!body.jobId) return NextResponse.json({ error: "Missing jobId" }, { status: 400 })

  const service = await createServiceClient()
  try {
    const outcome = await registerJob({ store: supabaseSchemeStore(service) }, {
      companyId: ctx.companyId,
      jobId: body.jobId,
      actorUserId: ctx.userId,
      afterManualCheck: body.confirmedNotRegistered === true,
    })
    if (outcome.status === "not_found") return NextResponse.json({ error: "Not found" }, { status: 404 })
    return NextResponse.json(outcome)
  } catch (e: any) {
    console.error("[api/admin/schemes/register]", e?.message)
    return NextResponse.json({ error: "Could not finish. It will stay on Today." }, { status: 500 })
  }
}
