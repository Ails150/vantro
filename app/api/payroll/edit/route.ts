import { NextResponse } from "next/server"
import { createClient, createServiceClient } from "@/lib/supabase/server"

// Edit a signin's times.
// REFUSES to edit if the signin has been locked by a payroll export.

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const service = await createServiceClient()
  const { data: admin } = await service
    .from("users")
    .select("id, company_id, role")
    .eq("auth_user_id", user.id)
    .single()
  if (!admin || admin.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const body = await request.json().catch(() => ({}))
  const { signinId, signed_in_at, signed_out_at } = body
  if (!signinId || !signed_in_at) {
    return NextResponse.json({ error: "signinId and signed_in_at required" }, { status: 400 })
  }

  // Check existing signin — must belong to admin's company AND not be locked
  const { data: existing, error: fetchErr } = await service
    .from("signins")
    .select("id, company_id, payroll_exported_at")
    .eq("id", signinId)
    .single()

  if (fetchErr || !existing) {
    return NextResponse.json({ error: "Signin not found" }, { status: 404 })
  }
  if (existing.company_id !== admin.company_id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  if (existing.payroll_exported_at) {
    return NextResponse.json({
      error: "This timesheet has been exported for payroll and cannot be edited",
      code: "PAYROLL_LOCKED",
      exportedAt: existing.payroll_exported_at,
    }, { status: 423 }) // 423 Locked
  }

  // Calculate hours_worked
  let hours_worked: number | null = null
  if (signed_out_at) {
    hours_worked = (new Date(signed_out_at).getTime() - new Date(signed_in_at).getTime()) / 3600000
    hours_worked = Number(hours_worked.toFixed(2))
  }

  const { error: updErr } = await service
    .from("signins")
    .update({
      signed_in_at,
      signed_out_at: signed_out_at || null,
      hours_worked,
    })
    .eq("id", signinId)

  if (updErr) {
    return NextResponse.json({ error: "Could not update signin", detail: updErr.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
