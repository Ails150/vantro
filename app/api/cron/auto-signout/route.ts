// app/api/cron/auto-signout/route.ts
// Runs every 15 min via Vercel Cron.
// Safety net for when mobile geofence-exit didn't fire (Android background killed,
// permission downgrade, app crash, etc). Ensures no shift stays open indefinitely.
//
// Logic per open signin:
//   - If signed_in_at > 12 hours ago -> close (hard cap)
//   - Fetch most recent location_log for that user since signed_in_at
//   - If no pings at all and sign-in > 30 min ago -> close (mobile never reported)
//   - If last ping > 30 min old OR > 300m from site -> close
//
// signed_out_at is set to the LAST proximity ping time (best guess of when they left),
// or signed_in_at + 8 hours for the hard-cap case.
// auto_closed_reason: "no_recent_proximity" | "stale_no_pings" | "max_shift_duration"
// flagged: true so admin sees the server caught it.
//
// Auth: Vercel cron sends Authorization: Bearer <CRON_SECRET>

import { NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/server"

const STALE_PING_MINUTES = 30
const PROXIMITY_BUFFER_M = 300
const MAX_SHIFT_HOURS = 12
const NO_PINGS_GRACE_MINUTES = 30

function haversineMetres(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

export async function GET(request: Request) {
  const auth = request.headers.get("authorization")
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const service = await createServiceClient()
  const now = new Date()

  const { data: openSignins, error: signinsErr } = await service
    .from("signins")
    .select("id, user_id, job_id, signed_in_at, jobs!inner(id, lat, lng)")
    .is("signed_out_at", null)

  if (signinsErr) {
    return NextResponse.json({ error: signinsErr.message }, { status: 500 })
  }

  const results: any[] = []

  for (const s of openSignins || []) {
    const signedInAt = new Date(s.signed_in_at)
    const ageMs = now.getTime() - signedInAt.getTime()
    const ageHours = ageMs / 3600000
    const job = (s as any).jobs

    if (ageHours > MAX_SHIFT_HOURS) {
      const closeAt = new Date(signedInAt.getTime() + 8 * 3600000)
      await closeSignin(service, s.id, closeAt, signedInAt, "max_shift_duration", null, null)
      results.push({ signinId: s.id, action: "closed", reason: "max_shift_duration", ageHours: ageHours.toFixed(1) })
      continue
    }

    const { data: latestPing } = await service
      .from("location_logs")
      .select("lat, lng, distance_from_site_metres, logged_at")
      .eq("user_id", s.user_id)
      .gte("logged_at", s.signed_in_at)
      .order("logged_at", { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!latestPing) {
      if (ageMs > NO_PINGS_GRACE_MINUTES * 60000) {
        await closeSignin(service, s.id, now, signedInAt, "stale_no_pings", null, null)
        results.push({ signinId: s.id, action: "closed", reason: "stale_no_pings", ageHours: ageHours.toFixed(1) })
      } else {
        results.push({ signinId: s.id, action: "skip", reason: "no_pings_within_grace" })
      }
      continue
    }

    const pingAt = new Date(latestPing.logged_at)
    const pingAgeMin = (now.getTime() - pingAt.getTime()) / 60000

    let dist = latestPing.distance_from_site_metres ?? 0
    if (job?.lat != null && job?.lng != null && latestPing.lat != null && latestPing.lng != null) {
      dist = Math.round(haversineMetres(job.lat, job.lng, latestPing.lat, latestPing.lng))
    }

    const isStale = pingAgeMin > STALE_PING_MINUTES
    const isFar = dist > PROXIMITY_BUFFER_M

    if (isStale || isFar) {
      const reason = isFar ? "no_recent_proximity" : "stale_no_pings"
      await closeSignin(service, s.id, pingAt, signedInAt, reason, latestPing.lat, latestPing.lng)
      results.push({ signinId: s.id, action: "closed", reason, distMetres: dist, pingAgeMin: pingAgeMin.toFixed(1) })
    } else {
      results.push({ signinId: s.id, action: "skip", reason: "still_on_site", distMetres: dist, pingAgeMin: pingAgeMin.toFixed(1) })
    }
  }

  return NextResponse.json({
    ok: true,
    runAt: now.toISOString(),
    totalOpen: openSignins?.length || 0,
    closed: results.filter(r => r.action === "closed").length,
    skipped: results.filter(r => r.action === "skip").length,
    results,
  })
}

async function closeSignin(service: any, signinId: string, signedOutAt: Date, signedInAt: Date, reason: string, lat: number | null, lng: number | null) {
  const hoursWorked = (signedOutAt.getTime() - signedInAt.getTime()) / 3600000
  await service
    .from("signins")
    .update({
      signed_out_at: signedOutAt.toISOString(),
      sign_out_lat: lat,
      sign_out_lng: lng,
      hours_worked: parseFloat(hoursWorked.toFixed(2)),
      auto_closed: true,
      auto_closed_reason: reason,
      flagged: true,
    })
    .eq("id", signinId)
}
