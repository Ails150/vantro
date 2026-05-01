import { NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/server"
import { verifyInstallerToken } from "@/lib/auth"

// GET /api/installer/my-hours
// Returns the signed-in installer's last 14 days of work record:
//  - sign-ins/outs grouped by day
//  - on-site duration per shift
//  - GPS breadcrumb trail per shift (lat/lng/logged_at)
// This is the installer's own record, viewable in the app, useful for
// payroll evidence and dispute protection.
export async function GET(request: Request) {
  try {
    const installer = verifyInstallerToken(request)
    if (!installer) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const service = await createServiceClient()

    const since = new Date()
    since.setDate(since.getDate() - 14)

    // Pull this user's sign-ins for the last 14 days, with job name
    const { data: signins, error: siErr } = await service
      .from("signins")
      .select("id, job_id, signed_in_at, signed_out_at, auto_closed, auto_closed_reason, jobs(name, address)")
      .eq("user_id", installer.userId)
      .gte("signed_in_at", since.toISOString())
      .order("signed_in_at", { ascending: false })

    if (siErr) {
      console.error("[my-hours] signins query failed:", siErr)
      return NextResponse.json({ error: "Failed to load hours" }, { status: 500 })
    }

    const signinIds = (signins || []).map((s: any) => s.id)

    // Pull breadcrumbs for those shifts, lightweight projection
    let breadcrumbs: any[] = []
    if (signinIds.length > 0) {
      const { data: bc, error: bcErr } = await service
        .from("location_logs")
        .select("signin_id, lat, lng, logged_at, within_range")
        .in("signin_id", signinIds)
        .order("logged_at", { ascending: true })

      if (bcErr) {
        console.error("[my-hours] breadcrumbs query failed:", bcErr)
      } else {
        breadcrumbs = bc || []
      }
    }

    // Group breadcrumbs by signin_id
    const trailsBySignin: Record<string, any[]> = {}
    for (const b of breadcrumbs) {
      if (!trailsBySignin[b.signin_id]) trailsBySignin[b.signin_id] = []
      trailsBySignin[b.signin_id].push({
        lat: b.lat,
        lng: b.lng,
        logged_at: b.logged_at,
        within_range: b.within_range
      })
    }

    // Build shift summaries
    const shifts = (signins || []).map((s: any) => {
      const trail = trailsBySignin[s.id] || []
      const inAt = s.signed_in_at ? new Date(s.signed_in_at) : null
      const outAt = s.signed_out_at ? new Date(s.signed_out_at) : null
      const durationMinutes = (inAt && outAt)
        ? Math.round((outAt.getTime() - inAt.getTime()) / 60000)
        : null
      const dateKey = inAt ? inAt.toISOString().slice(0, 10) : null

      return {
        id: s.id,
        job_id: s.job_id,
        job_name: s.jobs?.name || "Unknown job",
        job_address: s.jobs?.address || "",
        signed_in_at: s.signed_in_at,
        signed_out_at: s.signed_out_at,
        auto_closed: s.auto_closed === true,
        auto_closed_reason: s.auto_closed_reason || null,
        duration_minutes: durationMinutes,
        date_key: dateKey,
        breadcrumb_count: trail.length,
        trail
      }
    })

    // Group by date for the list view
    const byDay: Record<string, { date: string; total_minutes: number; shifts: any[] }> = {}
    for (const sh of shifts) {
      if (!sh.date_key) continue
      if (!byDay[sh.date_key]) {
        byDay[sh.date_key] = { date: sh.date_key, total_minutes: 0, shifts: [] }
      }
      if (sh.duration_minutes) byDay[sh.date_key].total_minutes += sh.duration_minutes
      byDay[sh.date_key].shifts.push(sh)
    }

    const days = Object.values(byDay).sort((a, b) => b.date.localeCompare(a.date))

    return NextResponse.json({ days, shifts })
  } catch (e: any) {
    console.error("[my-hours] exception:", e)
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 })
  }
}