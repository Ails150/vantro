import { NextResponse } from "next/server"
import { createClient, createServiceClient } from "@/lib/supabase/server"

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const service = await createServiceClient()
  const { data: u } = await service.from("users").select("company_id, role").eq("auth_user_id", user.id).single()
  if (!u || u.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  const { data: company } = await service.from("companies").select("id, name, default_sign_in_time, default_sign_out_time, default_working_days, grace_period_minutes, geofence_radius_metres").eq("id", u.company_id).single()
  return NextResponse.json({ company: company || {} })
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const service = await createServiceClient()
  const { data: u } = await service.from("users").select("company_id, role").eq("auth_user_id", user.id).single()
  if (!u || u.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  const { default_sign_in_time, default_sign_out_time, default_working_days, grace_period_minutes, geofence_radius_metres } = await request.json()
  const updates: any = {}
  if (default_sign_out_time !== undefined) updates.default_sign_out_time = default_sign_out_time
  if (grace_period_minutes !== undefined) updates.grace_period_minutes = grace_period_minutes
  if (geofence_radius_metres !== undefined) updates.geofence_radius_metres = geofence_radius_metres
  const { error } = await service.from("companies").update(updates).eq("id", u.company_id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ success: true })
}
