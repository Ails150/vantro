import { NextResponse } from "next/server"
import { createClient, createServiceClient } from "@/lib/supabase/server"

export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const service = await createServiceClient()
  const { data: u } = await service.from("users").select("id, name, role, company_id").eq("auth_user_id", user.id).single()
  if (!u) return NextResponse.json({ error: "User not found" }, { status: 404 })

  if (!["admin", "superadmin"].includes(u.role)) {
    return NextResponse.json({ error: "Only an admin can accept the DPA" }, { status: 403 })
  }

  const { error } = await service.from("companies").update({
    dpa_accepted_at: new Date().toISOString(),
    dpa_accepted_by_name: u.name || "Admin",
    dpa_accepted_by_user_id: u.id,
    dpa_version: "1.0",
  }).eq("id", u.company_id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
