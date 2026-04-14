import { NextResponse } from "next/server"
import { createClient, createServiceClient } from "@/lib/supabase/server"

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const service = await createServiceClient()
  const { data: u } = await service.from("users").select("company_id, role").eq("auth_user_id", user.id).single()
  if (!u || u.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const { searchParams } = new URL(request.url)
  const limit = Math.min(parseInt(searchParams.get("limit") || "50"), 200)
  const offset = parseInt(searchParams.get("offset") || "0")

  const { data: logs } = await service.from("audit_log")
    .select("*, users(name, initials)")
    .eq("company_id", u.company_id)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1)

  return NextResponse.json({ logs: logs || [] })
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const service = await createServiceClient()
  const { data: u } = await service.from("users").select("id, company_id, role").eq("auth_user_id", user.id).single()
  if (!u) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const { action, entity_type, entity_id, details } = await request.json()
  await service.from("audit_log").insert({
    company_id: u.company_id,
    user_id: u.id,
    auth_user_id: user.id,
    action, entity_type, entity_id, details,
  })

  return NextResponse.json({ success: true })
}