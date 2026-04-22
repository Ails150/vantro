import { NextResponse } from "next/server"
import { createClient, createServiceClient } from "@/lib/supabase/server"

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const service = await createServiceClient()
  const { data: u } = await service.from("users").select("company_id").eq("auth_user_id", user.id).single()
  if (!u) return NextResponse.json({ error: "Not found" }, { status: 404 })

  // Get all active signins with user and job location
  const { data: signins } = await service
    .from("signins")
    .select("id, signed_in_at, user_id, job_id, users(name, role), jobs(name, address, lat, lng)")
    .eq("company_id", u.company_id)
    .is("signed_out_at", null)
    .gte("signed_in_at", new Date(new Date().setHours(0,0,0,0)).toISOString())

  // Get last known location for each active installer
  const installerIds = (signins || []).map((s: any) => s.user_id)
  let locations: any[] = []
  if (installerIds.length > 0) {
    const { data: locs } = await service
      .from("location_logs")
      .select("user_id, lat, lng, logged_at, within_range, distance_from_site_metres")
      .in("user_id", installerIds)
      .order("logged_at", { ascending: false })

    // Get most recent ping per user
    const seen = new Set()
    locations = (locs || []).filter((l: any) => {
      if (seen.has(l.user_id)) return false
      seen.add(l.user_id)
      return true
    })
  }

  // Get all active job sites
  const { data: jobs } = await service
    .from("jobs")
    .select("id, name, address, lat, lng, status")
    .eq("company_id", u.company_id)
    .eq("status", "active")
    .not("lat", "is", null)

  return NextResponse.json({
    signins: signins || [],
    locations,
    jobs: jobs || []
  })
}