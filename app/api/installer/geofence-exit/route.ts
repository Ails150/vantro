// app/api/installer/geofence-exit/route.ts
//
// Mobile fires this when iOS Region Monitoring detects the installer has
// crossed the site boundary leaving the geofence.
//
// WHAT THIS USED TO DO, AND WHY IT NO LONGER DOES
// It closed the shift immediately, on that one event. A single region-exit
// callback is not evidence someone went home: iOS fires it on a bad fix, on a
// cell-tower handover, on a phone that briefly lost GPS inside a steel-framed
// building. The cost of being wrong is a worker's afternoon disappearing off
// their timesheet, and they find out from a push telling them they were signed
// out while they are standing on site.
//
// The rule now is the one in lib/notifications/rules.ts: at least two fixes,
// every one of them outside the fence with a known accuracy better than 100m,
// spanning at least ten continuous minutes, and only against an open shift.
// One event cannot satisfy that by construction, so this endpoint no longer
// decides anything. It records the crossing as a breadcrumb and the
// notifications cron evaluates the run on its next tick.
//
// The accuracy of this fix is no longer recorded as 0. The mobile client does
// not send one, and 0 does not mean "perfect", it means "not measured" -- and
// under an accuracy-gated rule a fabricated 0 is the one value that would let
// an untrustworthy fix sign somebody out. Absent accuracy is stored as null,
// which the dwell rule treats as unusable.

import { verifyFieldToken } from "@/lib/auth"
import { NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/server"

export async function POST(request: Request) {
  const installer = verifyFieldToken(request)
  if (!installer) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await request.json().catch(() => null)
  if (!body) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 })
  }

  const { jobId, lat, lng, exitedAt, accuracy } = body
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

  // Clamp a crossing that claims to predate the sign-in or postdate now. Clock
  // skew and replayed queued events both produce these.
  const signedInAt = new Date(signin.signed_in_at)
  let loggedAt = exitTime
  if (loggedAt < signedInAt) loggedAt = signedInAt
  const now = new Date()
  if (loggedAt > now) loggedAt = now

  // The breadcrumb. This is the whole job of the endpoint now.
  //
  // It is written while the signin is still open on purpose: closing a signin
  // fires signins_location_batch_hash, which hashes that shift's whole GPS
  // trail as one piece of evidence, and a ping written afterwards falls outside
  // the batch. This is the most evidential ping in the trail -- the one that
  // records them crossing the boundary.
  //
  // This insert also never once succeeded before 2026-09-04: it omitted job_id,
  // which is NOT NULL, and a bare `catch {}` threw the error away.
  const { error: breadcrumbErr } = await service.from("location_logs").insert({
    signin_id: signin.id,
    user_id: installer.userId,
    company_id: signin.company_id,
    job_id: signin.job_id,
    lat,
    lng,
    accuracy_metres:
      typeof accuracy === "number" && Number.isFinite(accuracy) ? Math.round(accuracy) : null,
    // Definitional: this endpoint only fires because they crossed out of the
    // geofence. distance_from_site_metres is left null -- we know they are
    // outside, not by how far, and the job coordinates are not loaded here.
    within_range: false,
    source: "geofence-exit",
    logged_at: loggedAt.toISOString(),
  })

  if (breadcrumbErr) {
    console.error("[geofence-exit] breadcrumb insert failed", breadcrumbErr)
    return NextResponse.json({ error: breadcrumbErr.message }, { status: 500 })
  }

  return NextResponse.json({
    success: true,
    signinId: signin.id,
    loggedAt: loggedAt.toISOString(),
    // Explicitly not a sign-out. The cron decides, once there is a run of fixes
    // that clears the dwell and accuracy bar.
    action: "exit_recorded_pending_dwell",
  })
}
