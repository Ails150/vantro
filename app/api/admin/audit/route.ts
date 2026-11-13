import { NextResponse } from "next/server"
import { createClient, createServiceClient } from "@/lib/supabase/server"
import { isDashboardRole } from "@/lib/company-context"
import { isUuid } from "@/lib/ownership"

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const service = await createServiceClient()
  const { data: u } = await service.from("users").select("company_id, role").eq("auth_user_id", user.id).single()
  if (!u || !["admin","foreman","superadmin"].includes(u.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

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
  // The audit log is the dashboard's record; a field session must not be able
  // to write entries into it.
  if (!u || !isDashboardRole(u.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const { action, entity_type, entity_id, details } = await request.json().catch(() => ({}))
  if (entity_id != null && !isUuid(entity_id)) {
    return NextResponse.json({ error: "entity_id must be a uuid" }, { status: 400 })
  }
  await service.from("audit_log").insert({
    company_id: u.company_id,
    user_id: u.id,
    auth_user_id: user.id,
    action, entity_type, entity_id: entity_id ?? null, details,
  })

  return NextResponse.json({ success: true })
}