// app/api/admin/schemes/route.ts
//
// GET     this company's scheme connections. The key never comes back.
// POST    validate a pasted key with the scheme and, only if it passes, save it.
// DELETE  disconnect a scheme.

import { NextResponse } from "next/server"
import { getCallerContext } from "@/lib/company-context"
import { can, toPlan } from "@/lib/plan"
import { seal } from "@/lib/secret-box"
import { schemeAvailability, schemeFeatureEnabled, SCHEMES, toScheme } from "@/lib/schemes/driver"
import { connectionContext } from "@/lib/schemes/register"
import { createServiceClient } from "@/lib/supabase/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// Not support: a member of platform staff has no business holding a customer's
// credential for a regulated scheme.
const KEY_ROLES = ["admin", "superadmin"]

async function caller() {
  const ctx = await getCallerContext()
  if (!ctx) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }
  if (!KEY_ROLES.includes(ctx.role)) return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) }
  if (!ctx.companyId) return { error: NextResponse.json({ error: "No company selected" }, { status: 400 }) }
  if (!schemeFeatureEnabled(ctx.companyId)) return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) }
  const service = await createServiceClient()
  const { data: company } = await service.from("companies").select("plan").eq("id", ctx.companyId).single()
  if (!can(toPlan(company?.plan), "schemeRegistration")) {
    return { error: NextResponse.json({ error: "Scheme registration is on the Full Suite plan", requiredPlan: "suite" }, { status: 402 }) }
  }
  return { ctx, service, companyId: ctx.companyId }
}

export async function GET() {
  const c = await caller()
  if ("error" in c) return c.error
  const { data, error } = await c.service.from("scheme_connections")
    .select("scheme, api_key_last4, member_number, active, validated_at")
    .eq("company_id", c.companyId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const availability = Object.fromEntries(SCHEMES.map(s => {
    const a = schemeAvailability(s, c.companyId)
    return [s, a.available ? { available: true, environment: a.driver.environment } : { available: false, reason: a.reason }]
  }))
  return NextResponse.json({ connections: data || [], availability })
}

export async function POST(request: Request) {
  const c = await caller()
  if ("error" in c) return c.error
  const body = await request.json().catch(() => ({}))
  const scheme = toScheme(body.scheme)
  const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : ""
  const memberNumber = typeof body.memberNumber === "string" ? body.memberNumber.trim() : ""
  if (!scheme) return NextResponse.json({ error: "Choose a scheme" }, { status: 400 })
  if (!apiKey || apiKey.length > 512) return NextResponse.json({ error: "Paste your API key" }, { status: 400 })
  if (!memberNumber || memberNumber.length > 64) return NextResponse.json({ error: "Enter your member number" }, { status: 400 })

  const route = schemeAvailability(scheme, c.companyId)
  if (!route.available) return NextResponse.json({ error: route.reason }, { status: 503 })

  let check
  try {
    check = await route.driver.validateKey({ apiKey, memberNumber })
  } catch {
    return NextResponse.json({ error: "Could not reach the scheme. Nothing was saved." }, { status: 502 })
  }
  if (!check.ok) return NextResponse.json({ error: check.reason }, { status: 422 })

  let sealed: string
  try {
    sealed = seal(apiKey, connectionContext(c.companyId, scheme))
  } catch (e: any) {
    console.error("[api/admin/schemes] cannot seal key:", e?.message)
    return NextResponse.json({ error: "Key storage is not configured. Nothing was saved." }, { status: 500 })
  }

  const now = new Date().toISOString()
  const { error } = await c.service.from("scheme_connections").upsert({
    company_id: c.companyId,
    scheme,
    api_key_encrypted: sealed,
    api_key_last4: apiKey.slice(-4),
    member_number: memberNumber,
    active: true,
    validated_at: now,
    created_by: c.ctx.userId,
    updated_at: now,
  }, { onConflict: "company_id,scheme" })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, environment: route.driver.environment, last4: apiKey.slice(-4) })
}

export async function DELETE(request: Request) {
  const c = await caller()
  if ("error" in c) return c.error
  const scheme = toScheme(new URL(request.url).searchParams.get("scheme"))
  if (!scheme) return NextResponse.json({ error: "Choose a scheme" }, { status: 400 })
  const { error } = await c.service.from("scheme_connections").delete()
    .eq("company_id", c.companyId).eq("scheme", scheme)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
