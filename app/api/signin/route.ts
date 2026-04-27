// app/api/signin/route.ts
//
// Installer sign-in. Uses the scheduling resolver as the single source of
// truth for expected sign-out time. GPS / orphan-close logic unchanged.

import { verifyInstallerToken } from "@/lib/auth"
import { NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/server"
import { isInstallerWorking } from "@/lib/scheduling/resolver"

function haversine(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371000
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)))
}

export async function POST(request: Request) {
  const installer = verifyInstallerToken(request)
  if (!installer)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { jobId, lat, lng, accuracy } = await request.json()
  const service = await createServiceClient()

  const { data: job } = await service
    .from("jobs")
    .select("lat, lng, company_id, name, sign_out_time")
    .eq("id", jobId)
    .single()
  if (!job)
    return NextResponse.json({ error: "Job not found" }, { status: 404 })

  const { data: company } = await service
    .from("companies")
    .select("geofence_radius_metres")
    .eq("id", job.company_id)
    .single()

  const radius = company?.geofence_radius_metres || 150
  let distanceMetres = 0
  let withinRange = true

  if (job.lat && job.lng) {
    distanceMetres = Math.round(haversine(lat, lng, job.lat, job.lng))
    withinRange = distanceMetres <= radius

    if (!withinRange) {
      return NextResponse.json(
        {
          error: `You are ${distanceMetres}m from ${job.name}. You must be within ${radius}m to sign in.`,
          distanceMetres,
          withinRange: false,
        },
        { status: 400 }
      )
    }
  }

  // ─── Check for any open signin (orphan handling unchanged) ───────────
  const { data: existing } = await service
    .from("signins")
    .select("id, job_id, signed_in_at, jobs(name, lat, lng)")
    .eq("user_id", installer.userId)
    .is("signed_out_at", null)
    .order("signed_in_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (existing) {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const existingDate = new Date(existing.signed_in_at)
    const isSameJobToday =
      existing.job_id === jobId && existingDate >= today

    if (isSameJobToday) {
      const { data: full } = await service
        .from("signins")
        .select(
          "id, job_id, signed_in_at, expected_sign_out_time, company_id, jobs(name, lat, lng)"
        )
        .eq("id", existing.id)
        .single()
      const j = full?.jobs as any
      return NextResponse.json({
        success: true,
        distanceMetres,
        withinRange,
        alreadySignedIn: true,
        activeShift: full
          ? {
              signinId: full.id,
              jobId: full.job_id,
              jobName: j?.name || null,
              jobLat: j?.lat || null,
              jobLng: j?.lng || null,
              signedInAt: full.signed_in_at,
              expectedSignOutTime: full.expected_sign_out_time,
              companyId: full.company_id,
            }
          : null,
      })
    }

    // Orphan from previous day or different job — auto-close the old one
    const oldJob = existing.jobs as any
    let closeAt = new Date()
    const closeReason = "auto_orphan_on_new_signin"

    if (oldJob?.lat && oldJob?.lng) {
      const { data: breadcrumbs } = await service
        .from("location_logs")
        .select("lat, lng, logged_at")
        .eq("user_id", installer.userId)
        .gte("logged_at", existing.signed_in_at)
        .order("logged_at", { ascending: false })
        .limit(100)

      if (breadcrumbs && breadcrumbs.length > 0) {
        const lastOnSite = breadcrumbs.find((b: any) => {
          const dist = haversine(b.lat, b.lng, oldJob.lat, oldJob.lng)
          return dist <= radius
        })
        if (lastOnSite) {
          closeAt = new Date(lastOnSite.logged_at)
        }
      }
    }

    const hoursWorked = Math.max(
      0,
      (closeAt.getTime() - new Date(existing.signed_in_at).getTime()) / 3600000
    )

    await service
      .from("signins")
      .update({
        signed_out_at: closeAt.toISOString(),
        hours_worked: parseFloat(hoursWorked.toFixed(2)),
        auto_closed: true,
        auto_closed_reason: closeReason,
        flagged: true,
        flag_reason: `Signed in elsewhere without signing out first. Please review hours.`,
      })
      .eq("id", existing.id)
  }

  // ─── Resolve expected sign-out via the scheduling resolver ───────────
  // Single call replaces the old day-key lookup. If user is on time off
  // or it's a public holiday, expectedSignOut may be null — the sign-in
  // is still allowed (installer may need to sign in for emergency cover)
  // but compliance scoring will skip this day (handled separately).
  const state = await isInstallerWorking(installer.userId)
  const expectedSignOutTime = state.expectedSignOut ?? null

  // Job-level override still wins if set (per-job custom sign-out)
  const finalExpectedSignOut = job.sign_out_time || expectedSignOutTime

  const { data: inserted, error } = await service
    .from("signins")
    .insert({
      job_id: jobId,
      user_id: installer.userId,
      company_id: job.company_id,
      lat,
      lng,
      accuracy_metres: accuracy,
      distance_from_site_metres: distanceMetres,
      within_range: withinRange,
      expected_sign_out_time: finalExpectedSignOut,
    })
    .select("id, signed_in_at")
    .single()

  if (error)
    return NextResponse.json({ error: error.message }, { status: 400 })

  return NextResponse.json({
    success: true,
    distanceMetres,
    withinRange,
    schedulingState: {
      reason: state.reason,
      expectedSignIn: state.expectedSignIn,
      expectedSignOut: state.expectedSignOut,
      details: state.details,
    },
    activeShift: {
      signinId: inserted?.id || null,
      jobId: jobId,
      jobName: job.name,
      jobLat: job.lat,
      jobLng: job.lng,
      signedInAt: inserted?.signed_in_at || new Date().toISOString(),
      expectedSignOutTime: finalExpectedSignOut,
      companyId: job.company_id,
    },
  })
}
