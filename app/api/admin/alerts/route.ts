import { NextResponse } from "next/server"
import { createClient, createServiceClient } from "@/lib/supabase/server"

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const service = await createServiceClient()
  const { data: userData } = await service.from("users").select("company_id").eq("auth_user_id", user.id).single()
  if (!userData) return NextResponse.json({ error: "Not found" }, { status: 404 })

  // Defaults: unread, last 7 days, max 200.
  // Override with ?days=N (1-365), ?all=true (no time filter), ?includeResolved=true.
  const { searchParams } = new URL(request.url)
  const all = searchParams.get("all") === "true"
  const includeResolved = searchParams.get("includeResolved") === "true"
  const daysParam = parseInt(searchParams.get("days") || "7", 10)
  const days = Math.min(Math.max(daysParam, 1), 365)
  const limitParam = parseInt(searchParams.get("limit") || "200", 10)
  const limit = Math.min(Math.max(limitParam, 1), 1000)

  let query = service.from("alerts")
    .select("*, jobs(name), users(name)")
    .eq("company_id", userData.company_id)
    .order("created_at", { ascending: false })
    .limit(limit)

  if (!includeResolved) {
    query = query.eq("is_read", false)
  }

  if (!all) {
    const since = new Date()
    since.setDate(since.getDate() - days)
    query = query.gte("created_at", since.toISOString())
  }

  const { data: alerts } = await query

  return NextResponse.json({
    alerts: alerts || [],
    window: all ? "all" : days + "d",
    includeResolved,
    count: alerts?.length || 0,
  })
}
