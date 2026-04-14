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
  const startDate = searchParams.get("start") || new Date(Date.now() - 7 * 86400000).toISOString().split("T")[0]
  const endDate = searchParams.get("end") || new Date().toISOString().split("T")[0]

  const { data: signins } = await service.from("signins")
    .select("*, users(name, initials), jobs(name, address, lat, lng)")
    .eq("company_id", u.company_id)
    .gte("signed_in_at", startDate + "T00:00:00Z")
    .lte("signed_in_at", endDate + "T23:59:59Z")
    .order("signed_in_at", { ascending: false })

  // Group by user for summary
  const byUser: Record<string, any> = {}
  for (const s of signins || []) {
    const uid = s.user_id
    if (!byUser[uid]) {
      byUser[uid] = {
        user_id: uid,
        name: (s.users as any)?.name,
        initials: (s.users as any)?.initials,
        total_hours: 0,
        total_days: 0,
        flagged_count: 0,
        auto_closed_count: 0,
        early_departure_count: 0,
        early_departure_minutes_total: 0,
        entries: [],
      }
    }
    byUser[uid].entries.push(s)
    byUser[uid].total_hours += s.hours_worked || 0
    byUser[uid].total_days += 1
    if (s.flagged) byUser[uid].flagged_count += 1
    if (s.auto_closed) byUser[uid].auto_closed_count += 1
    if (s.departed_early) byUser[uid].early_departure_count += 1
    byUser[uid].early_departure_minutes_total += s.early_departure_minutes || 0
  }

  // Calculate compliance score per installer
  const summaryWithCompliance = Object.values(byUser).map((u: any) => {
    const totalEntries = u.total_days
    const cleanEntries = totalEntries - u.flagged_count - u.early_departure_count
    const complianceScore = totalEntries > 0 ? Math.round((cleanEntries / totalEntries) * 100) : 100
    return {
      ...u,
      early_departure_count: u.early_departure_count || 0,
      early_departure_minutes_total: u.early_departure_minutes_total || 0,
      compliance_score: complianceScore,
    }
  })

  return NextResponse.json({
    signins: signins || [],
    summary: summaryWithCompliance,
    period: { start: startDate, end: endDate },
  })
}