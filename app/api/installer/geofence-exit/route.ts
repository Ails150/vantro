// app/api/installer/geofence-exit/route.ts
//
// Mobile fires this when iOS Region Monitoring detects the installer has
// crossed the site boundary leaving the geofence. We:
// 1. Find the installer's open signin for this job
// 2. Close it with signed_out_at = exitedAt (the moment they crossed)
// 3. Capture lat/lng of the exit point
// 4. Flag as auto_signed_out so admin can distinguish from manual sign-out
//
// This is the ONLY background-fired endpoint - all other sign-outs are
// manual (installer taps "Sign Out") and go through the regular sign-out
// route.

import { verifyInstallerToken } from "@/lib/auth"
import { NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/server"

export async function POST(request: Request) {
  const installer = verifyInstallerToken(request)
  if (!installer) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await request.json().catch(() => null)
  if (!body) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 })
  }

  const { jobId, lat, lng, exitedAt } = body
  if (!jobId || typeof lat !== "number" || typeof lng !== "number") {
    return NextResponse.json({ error: "Missing jobId/lat/lng" }, { status: 400 })
  }

  const exitTime = exitedAt ? new Date(exitedAt) : new Date()
  if (isNaN(exitTime.getTime())) {
    return NextResponse.json({ error: "Invalid exitedAt" }, { status: 400 })
  }

  const service = await createServiceClient()

  // Find the installer's open signin for THIS job
  const { data: signin } = await service
    .from("signins")
    .select("id, signed_in_at, job_id, company_id")
    .eq("user_id", installer.userId)
    .eq("job_id", jobId)
    .is("signed_out_at", null)
    .order("signed_in_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!signin) {
    // No open signin for this job - maybe already signed out manually,
    // or the geofence fired stale. Silently succeed - this is normal.
    return NextResponse.json({
      success: true,
      action: "no_open_signin",
    })
  }

  const signedInAt = new Date(signin.signed_in_at)
  let signedOutAt = exitTime

  // Sanity check - if exit time is somehow BEFORE signed_in_at, clamp
  // to signed_in_at (zero-hours shift). This shouldn't happen but
  // protects against clock skew / replay.
  if (signedOutAt < signedInAt) {
    signedOutAt = signedInAt
  }

  // Also clamp to now if exit time is in the future
  const now = new Date()
  if (signedOutAt > now) {
    signedOutAt = now
  }

  const hoursWorked = Math.max(
    0,
    (signedOutAt.getTime() - signedInAt.getTime()) / 3600000
  )

  // Close the signin
  const { error: updateErr } = await service
    .from("signins")
    .update({
      signed_out_at: signedOutAt.toISOString(),
      sign_out_lat: lat,
      sign_out_lng: lng,
      hours_worked: parseFloat(hoursWorked.toFixed(2)),
      auto_closed: true,
      auto_closed_reason: "geofence_exit",
      flagged: false,
    })
    .eq("id", signin.id)

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 })
  }

  // Log the breadcrumb for the exit event (best-effort, non-blocking)
  try {
    await service
      .from("location_logs")
      .insert({
        user_id: installer.userId,
        company_id: signin.company_id,
        lat,
        lng,
        accuracy_metres: 0,
        source: "geofence-exit",
        logged_at: signedOutAt.toISOString(),
      })
  } catch {}

  return NextResponse.json({
    success: true,
    signinId: signin.id,
    signedOutAt: signedOutAt.toISOString(),
    hoursWorked: parseFloat(hoursWorked.toFixed(2)),
    action: "auto_signed_out_geofence_exit",
  })
}
