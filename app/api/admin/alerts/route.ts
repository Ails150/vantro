import { NextResponse } from "next/server"
import { createClient, createServiceClient } from "@/lib/supabase/server"

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const service = await createServiceClient()
  const { data: u } = await service.from("users").select("company_id, role").eq("auth_user_id", user.id).single()
  if (!u || !["admin","foreman"].includes(u.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  const { data: alerts } = await service.from("alerts")
    .select("*, jobs(name)")
    .eq("company_id", u.company_id)
    .eq("is_read", false)
    .order("created_at", { ascending: false })
    .limit(20)
  return NextResponse.json({ alerts: alerts || [] })
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const service = await createServiceClient()
  const { data: u } = await service.from("users").select("company_id, role").eq("auth_user_id", user.id).single()
  if (!u || !["admin","foreman"].includes(u.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  const { action, id } = await request.json()
  if (action === "dismiss") {
    await service.from("alerts").update({ is_read: true }).eq("id", id).eq("company_id", u.company_id)
  }
  return NextResponse.json({ success: true })
}
