import { NextResponse } from "next/server"
import { createClient, createServiceClient } from "@/lib/supabase/server"

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const service = await createServiceClient()
  const { data: userData } = await service.from("users").select("company_id").eq("auth_user_id", user.id).single()
  if (!userData) return NextResponse.json({ error: "Not found" }, { status: 404 })
  const { data: alerts } = await service.from("alerts")
    .select("*, jobs(name), users(name)")
    .eq("company_id", userData.company_id)
    .eq("is_read", false)
    .order("created_at", { ascending: false })
    .limit(500)
  return NextResponse.json({ alerts: alerts || [] })
}
