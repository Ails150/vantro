import { NextResponse } from "next/server"
import { createClient, createServiceClient } from "@/lib/supabase/server"

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const service = await createServiceClient()
  const { newSuperadminUserId } = await request.json()

  if (!newSuperadminUserId) {
    return NextResponse.json({ error: "Missing newSuperadminUserId" }, { status: 400 })
  }

  const { data: caller, error: callerErr } = await service
    .from("users")
    .select("id, company_id, is_superadmin, role")
    .eq("auth_user_id", user.id)
    .maybeSingle()

  if (callerErr || !caller || !caller.is_superadmin) {
    return NextResponse.json({ error: "Only the current superadmin can transfer" }, { status: 403 })
  }

  const { data: target, error: targetErr } = await service
    .from("users")
    .select("id, company_id, role, is_superadmin")
    .eq("id", newSuperadminUserId)
    .maybeSingle()

  if (targetErr || !target) {
    return NextResponse.json({ error: "User not found" }, { status: 404 })
  }

  if (target.company_id !== caller.company_id) {
    return NextResponse.json({ error: "Target not in your company" }, { status: 403 })
  }

  if (target.role !== "admin") {
    return NextResponse.json({ error: "Target must be an admin to become superadmin" }, { status: 400 })
  }

  if (target.is_superadmin) {
    return NextResponse.json({ error: "Target is already superadmin" }, { status: 400 })
  }

  if (target.id === caller.id) {
    return NextResponse.json({ error: "Cannot transfer to yourself" }, { status: 400 })
  }

  const { error: unsetErr } = await service
    .from("users")
    .update({ is_superadmin: false })
    .eq("id", caller.id)

  if (unsetErr) {
    return NextResponse.json({ error: "Failed to demote current superadmin" }, { status: 500 })
  }

  const { error: setErr } = await service
    .from("users")
    .update({ is_superadmin: true })
    .eq("id", target.id)

  if (setErr) {
    await service.from("users").update({ is_superadmin: true }).eq("id", caller.id)
    return NextResponse.json({ error: "Failed to promote new superadmin (rolled back)" }, { status: 500 })
  }

  return NextResponse.json({
    success: true,
    newSuperadminId: target.id,
  })
}
