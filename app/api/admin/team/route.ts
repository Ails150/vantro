import { NextResponse } from "next/server"
import { createClient, createServiceClient } from "@/lib/supabase/server"

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const service = await createServiceClient()
  const { data: u } = await service.from("users").select("company_id, role").eq("auth_user_id", user.id).single()
  if (!u || !["admin","foreman"].includes(u.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  const { data: members } = await service.from("users").select("*").eq("company_id", u.company_id).order("name")
  return NextResponse.json({ members: members || [] })
}
