import { NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/server"
import { getCallerContext, isDashboardRole } from "@/lib/company-context"

export async function GET() {
  // The one a grep missed and a test caught.
  //
  // A search for routes mentioning "role" passed this file, because it selects
  // users(name, role) from the database. It never READ the caller's role. The
  // difference between a file that contains the word and a file that checks the
  // thing is exactly the difference a static scan is bad at and a request with
  // an installer's cookie is good at.
  //
  // What it returns is the live position of every person signed in today:
  // coordinates from the sign-in, the last GPS breadcrumb, distance from site,
  // whether they are inside the geofence. Company-scoped, so no other company's
  // -- but readable by any member of this one, including the people on the map.
  // A worker being able to pull up where every colleague is standing is the
  // single most sensitive read in the product.
  const ctx = await getCallerContext()
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!isDashboardRole(ctx.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  if (!ctx.companyId) return NextResponse.json({ error: "No company selected" }, { status: 400 })

  const service = await createServiceClient()
  const u = { company_id: ctx.companyId }

  // Get all active signins with user and job location.
  // Select signins.lat/lng (captured at sign-in) and within_range/distance so the
  // people layer can place a worker even before any GPS breadcrumb exists.
  const { data: signins } = await service
    .from("signins")
    .select("id, signed_in_at, user_id, job_id, lat, lng, within_range, distance_from_site_metres, users(name, role), jobs(name, address, lat, lng)")
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
      .eq("company_id", u.company_id)
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