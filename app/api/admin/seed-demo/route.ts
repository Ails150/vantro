// app/api/admin/seed-demo/route.ts
//
// Builds the "Northbridge Glazing Ltd" demo tenant. Superadmin only.
//
// This runs on the server rather than from a laptop for one specific reason:
// AUDIT_SIGNING_KEY is a Vercel environment secret, and without it the demo's
// Compliance Audit Pack is generated correctly but comes out unsigned. A demo
// of a signed evidence chain that is not actually signed is worse than no demo.
//
// It creates and destroys a whole company, so the gate is the strictest one in
// the codebase: role must be 'superadmin', or the caller's own member row must
// carry is_superadmin. A company admin cannot reach it.

import { NextResponse } from "next/server"
import { createClient, createServiceClient } from "@/lib/supabase/server"
import { seedDemo, DEMO_SLUG } from "@/scripts/seed-demo"

// Six weeks of sign-ins across three sites is a few thousand inserts.
export const maxDuration = 300

export async function POST() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const service = await createServiceClient()
  const { data: me } = await service
    .from("users")
    .select("id, role, is_superadmin, company_id")
    .eq("auth_user_id", user.id)
    .single()

  const isSuperadmin = me?.role === "superadmin" || me?.is_superadmin === true
  if (!isSuperadmin) {
    return NextResponse.json({ error: "Superadmin only" }, { status: 403 })
  }

  // A superadmin sitting inside the demo company would be deleting the account
  // they are signed in as. Refuse rather than log them out mid-seed.
  const { data: existing } = await service
    .from("companies")
    .select("id")
    .eq("slug", DEMO_SLUG)
    .maybeSingle()
  if (existing && existing.id === me?.company_id) {
    return NextResponse.json(
      { error: "You are signed in to the demo company. Switch to your own account before reseeding it." },
      { status: 409 },
    )
  }

  const lines: string[] = []
  try {
    const result = await seedDemo(service, { log: s => { lines.push(s); console.log("[seed-demo]", s) } })
    console.log("[seed-demo] done", { companyId: result.companyId, counts: result.counts, by: me?.id })
    return NextResponse.json({ success: true, ...result, log: lines })
  } catch (e: any) {
    console.error("[seed-demo] failed", e)
    return NextResponse.json(
      { error: e?.message || "Seed failed", log: lines },
      { status: 500 },
    )
  }
}
