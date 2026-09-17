import { NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/server"
import { getCallerContext, isDashboardRole } from "@/lib/company-context"

export async function GET(request: Request) {
  // Authenticated AND company-scoped, but it had no role check.
  //
  // That is not the same as safe. This returns every alert the company has --
  // geofence breaches, late sign-ins, flagged diary entries with the worker's
  // own video and photographs attached -- and an installer with a Supabase
  // session could read the lot. Installers usually authenticate with a PIN and
  // a field token instead, which is why it went unnoticed, but the invite and
  // magic-link paths do hand some of them a session: app/auth/callback has a
  // branch that routes a signed-in installer to /installer/setup.
  //
  // Company scoping stops you reading another company's alerts. It does
  // nothing about reading your own company's management view from the shop
  // floor, which is what a role check is for.
  const ctx = await getCallerContext()
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!isDashboardRole(ctx.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  if (!ctx.companyId) return NextResponse.json({ error: "No company selected" }, { status: 400 })

  const service = await createServiceClient()
  const userData = { company_id: ctx.companyId }

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
    .select("*, jobs(name), users(name), diary_entries(id, video_url, photo_urls, entry_text)")
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
