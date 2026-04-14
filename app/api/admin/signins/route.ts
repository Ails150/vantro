import { NextResponse } from "next/server"
import { createClient, createServiceClient } from "@/lib/supabase/server"

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const service = await createServiceClient()
  const { data: u } = await service.from("users").select("company_id, role").eq("auth_user_id", user.id).single()
  if (!u || !["admin","foreman"].includes(u.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const { searchParams } = new URL(request.url)
  const date = searchParams.get("date") || new Date().toISOString().split("T")[0]
  const activeOnly = searchParams.get("active") === "true"

  let query = service.from("signins")
    .select("*, users(name, initials), jobs(name, address, lat, lng)")
    .eq("company_id", u.company_id)
    .gte("signed_in_at", date + "T00:00:00Z")
    .lte("signed_in_at", date + "T23:59:59Z")
    .order("signed_in_at", { ascending: false })

  if (activeOnly) {
    query = query.is("signed_out_at", null)
  }

  const { data: signins } = await query
  return NextResponse.json({ signins: signins || [] })
}