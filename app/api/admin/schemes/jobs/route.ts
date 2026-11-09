// app/api/admin/schemes/jobs/route.ts
//
// GET    jobs whose registration needs someone, for Today.
// PATCH  a job's registration details.
//
// GET is NOT plan gated. A listed company that drops below Suite with a failed
// registration still has to be told about it.

import { NextResponse } from "next/server"
import { DASHBOARD_ROLES, getCallerContext } from "@/lib/company-context"
import { can, toPlan } from "@/lib/plan"
import { schemeFeatureEnabled, toScheme } from "@/lib/schemes/driver"
import { needsAttention, type SchemeJob } from "@/lib/schemes/register"
import { SCHEME_JOB_FIELDS } from "@/lib/schemes/store"
import { createServiceClient } from "@/lib/supabase/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

async function caller() {
  const ctx = await getCallerContext()
  if (!ctx) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }
  if (!(DASHBOARD_ROLES as readonly string[]).includes(ctx.role)) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) }
  }
  if (!ctx.companyId) return { error: NextResponse.json({ error: "No company selected" }, { status: 400 }) }
  if (!schemeFeatureEnabled(ctx.companyId)) return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) }
  return { ctx, companyId: ctx.companyId, service: await createServiceClient() }
}

export async function GET() {
  const c = await caller()
  if ("error" in c) return c.error
  const { data, error } = await c.service.from("jobs").select(SCHEME_JOB_FIELDS)
    .eq("company_id", c.companyId).eq("notifiable", true)
    .in("registration_status", ["pending", "registering", "failed", "unknown", "registered"])
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const now = new Date()
  const items = ((data || []) as unknown as SchemeJob[]).map(j => needsAttention(j, now)).filter(Boolean)
  return NextResponse.json({ items })
}

const text = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null)

function count(v: unknown): number | null | "bad" {
  if (v === null || v === undefined || v === "") return null
  const n = Number(v)
  return Number.isInteger(n) && n >= 0 && n <= 999 ? n : "bad"
}

export async function PATCH(request: Request) {
  const c = await caller()
  if ("error" in c) return c.error
  const { data: company } = await c.service.from("companies").select("plan").eq("id", c.companyId).single()
  if (!can(toPlan(company?.plan), "schemeRegistration")) {
    return NextResponse.json({ error: "Scheme registration is on the Full Suite plan", requiredPlan: "suite" }, { status: 402 })
  }

  const b = await request.json().catch(() => ({}))
  if (!b.jobId) return NextResponse.json({ error: "Missing jobId" }, { status: 400 })
  const { data: job } = await c.service.from("jobs").select("id, registration_status")
    .eq("id", b.jobId).eq("company_id", c.companyId).maybeSingle()
  if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 })

  // What the scheme was sent, or may have been sent, is not editable.
  if (["registering", "registered", "unknown"].includes(job.registration_status)) {
    return NextResponse.json({ error: "This job has gone to the scheme, so its details are locked." }, { status: 409 })
  }

  const windows = count(b.windows_count)
  const doors = count(b.doors_count)
  if (windows === "bad" || doors === "bad") {
    return NextResponse.json({ error: "Windows and doors must be whole numbers from 0 to 999" }, { status: 400 })
  }
  const completion = text(b.completion_date, 10)
  if (completion && !/^\d{4}-\d{2}-\d{2}$/.test(completion)) {
    return NextResponse.json({ error: "Completion date is not a date" }, { status: 400 })
  }
  const email = text(b.homeowner_email, 320)
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "That homeowner email does not look right" }, { status: 400 })
  }
  if (b.scheme && !toScheme(b.scheme)) return NextResponse.json({ error: "Unknown scheme" }, { status: 400 })

  const notifiable = b.notifiable === true
  const update = {
    notifiable,
    scheme: toScheme(b.scheme),
    property_address: text(b.property_address, 500),
    work_type: text(b.work_type, 120),
    windows_count: windows,
    doors_count: doors,
    completion_date: completion,
    homeowner_name: text(b.homeowner_name, 200),
    homeowner_email: email,
    registration_status: notifiable
      ? (job.registration_status === "failed" ? "failed" : "pending")
      : "not_required",
    ...(notifiable ? {} : { registration_error: null }),
  }
  const { error } = await c.service.from("jobs").update(update).eq("id", b.jobId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
