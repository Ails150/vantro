import { NextResponse } from "next/server"
import { createClient, createServiceClient } from "@/lib/supabase/server"

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const service = await createServiceClient()
  const { data: u } = await service.from("users").select("id, name, role, company_id").eq("auth_user_id", user.id).single()
  if (!u) return NextResponse.json({ error: "User not found" }, { status: 404 })

  const { data: company } = await service
    .from("companies")
    .select("id, name, dpa_accepted_at, dpa_accepted_by_name, dpa_version")
    .eq("id", u.company_id)
    .single()
  if (!company) return NextResponse.json({ error: "Company not found" }, { status: 404 })

  return NextResponse.json({
    company,
    canAccept: ["admin", "superadmin"].includes(u.role),
  })
}
