import { NextResponse } from "next/server"
import { createClient, createServiceClient } from "@/lib/supabase/server"

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const service = await createServiceClient()
  const { authUserId, userId } = await request.json()

  if (!userId) {
    return NextResponse.json({ error: "Missing userId" }, { status: 400 })
  }

  const { data: caller, error: callerErr } = await service
    .from("users")
    .select("id, company_id, role")
    .eq("auth_user_id", user.id)
    .maybeSingle()

  if (callerErr || !caller) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  if (!["admin","superadmin"].includes(caller.role)) {
    return NextResponse.json({ error: "Admins only" }, { status: 403 })
  }

  if (!caller.company_id) {
    return NextResponse.json({ error: "No company" }, { status: 403 })
  }

  const { data: target, error: targetErr } = await service
    .from("users")
    .select("id, company_id, is_superadmin")
    .eq("id", userId)
    .maybeSingle()

  if (targetErr || !target) {
    return NextResponse.json({ error: "User not found" }, { status: 404 })
  }

  if (target.company_id !== caller.company_id) {
    return NextResponse.json({ error: "Cross-company deletion blocked" }, { status: 403 })
  }

  if (target.is_superadmin) {
    return NextResponse.json(
      { error: "Cannot remove the superadmin. Transfer superadmin to another user first." },
      { status: 403 }
    )
  }

  if (target.id === caller.id) {
    return NextResponse.json(
      { error: "You cannot remove yourself. Ask another admin." },
      { status: 403 }
    )
  }

  await service.from("users").delete().eq("id", userId)
  if (authUserId) {
    await service.auth.admin.deleteUser(authUserId)
  }

  return NextResponse.json({ success: true })
}
