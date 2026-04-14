import { NextResponse } from "next/server"
import { createClient, createServiceClient } from "@/lib/supabase/server"

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const service = await createServiceClient()
  const { data: u } = await service.from("users").select("company_id, role").eq("auth_user_id", user.id).single()
  if (!u || !["admin", "foreman"].includes(u.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const { searchParams } = new URL(request.url)
  const signinId = searchParams.get("signinId")
  const userId = searchParams.get("userId")
  const date = searchParams.get("date") || new Date().toISOString().split("T")[0]

  if (signinId) {
    // Get breadcrumbs for a specific signin
    const { data: logs } = await service.from("location_logs")
      .select("*")
      .eq("signin_id", signinId)
      .eq("company_id", u.company_id)
      .order("logged_at", { ascending: true })

    return NextResponse.json({ logs: logs || [] })
  }

  if (userId) {
    // Get all breadcrumbs for a user on a date
    const { data: logs } = await service.from("location_logs")
      .select("*")
      .eq("user_id", userId)
      .eq("company_id", u.company_id)
      .gte("logged_at", date + "T00:00:00Z")
      .lte("logged_at", date + "T23:59:59Z")
      .order("logged_at", { ascending: true })

    return NextResponse.json({ logs: logs || [] })
  }

  return NextResponse.json({ error: "Provide signinId or userId" }, { status: 400 })
}