// app/api/cron/overlap-check/route.ts
//
// Nightly: report any worker who has more than one shift open at once, or
// whose day contains overlapping shifts.
//
// The sign-in route now refuses a second open shift on the same day, which
// closes the front door. This is the back door: shifts written by the seed, by
// a CSV import, by an admin editing times on the payroll screen, or by any
// future integration do not pass through that check. The pay engine trims
// overlapping minutes so nobody is paid twice either way -- but trimming is a
// silent correction, and an admin should be told that their records say
// somebody was in two places at once rather than discovering it in a trimmed
// figure.
//
// TWO DIFFERENT PROBLEMS, DELIBERATELY REPORTED SEPARATELY:
//
//   concurrent OPEN shifts    somebody is signed in twice right now. Live, and
//                             it will keep accruing until one is closed.
//   overlapping CLOSED shifts a record of somebody in two places. Historical,
//                             and it affects a timesheet that may already have
//                             been exported.

import { NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/server"
import { authoriseCron } from "@/lib/cron-auth"
import { allocateShifts, hasOverlap } from "@/lib/pay"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

const ALERT_TYPE = "shift_overlap"

/** How far back to look for overlapping closed shifts. */
const LOOKBACK_DAYS = 8

export async function GET(request: Request) {
  if (!authoriseCron(request).ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const service = await createServiceClient()
  const since = new Date(Date.now() - LOOKBACK_DAYS * 86400000).toISOString()

  const { data: rows, error } = await service
    .from("signins")
    .select("id, company_id, user_id, job_id, signed_in_at, signed_out_at, users:user_id (name), jobs(name)")
    .gte("signed_in_at", since)
    .order("signed_in_at", { ascending: true })
    .limit(50000)

  if (error) {
    console.error("[overlap-check] could not read shifts:", error.message)
    return NextResponse.json({ error: "Could not read shifts" }, { status: 500 })
  }

  // company -> user -> shifts
  const byCompany = new Map<string, Map<string, any[]>>()
  for (const r of (rows || []) as any[]) {
    if (!r.company_id || !r.user_id) continue
    const users = byCompany.get(r.company_id) || new Map<string, any[]>()
    const list = users.get(r.user_id) || []
    list.push(r)
    users.set(r.user_id, list)
    byCompany.set(r.company_id, users)
  }

  const findings: Array<{
    companyId: string
    userId: string
    name: string
    openCount: number
    overlapDays: number
    trimmedHours: number
  }> = []

  for (const [companyId, users] of byCompany) {
    for (const [userId, shifts] of users) {
      const open = shifts.filter(s => !s.signed_out_at)
      const closed = shifts.filter(s => s.signed_out_at)

      const intervals = closed.map(s => ({
        id: s.id,
        start: Date.parse(s.signed_in_at),
        end: Date.parse(s.signed_out_at),
      }))

      // Grouped by calendar day before checking. Two shifts on different days
      // cannot overlap, and checking a whole week at once would let a long
      // night shift look like it collides with the next morning.
      const byDay = new Map<string, typeof intervals>()
      for (const i of intervals) {
        const day = new Date(i.start).toISOString().slice(0, 10)
        byDay.set(day, [...(byDay.get(day) || []), i])
      }

      let overlapDays = 0
      let trimmedHours = 0
      for (const dayIntervals of byDay.values()) {
        if (!hasOverlap(dayIntervals)) continue
        overlapDays += 1
        trimmedHours += allocateShifts(dayIntervals).trimmedHours
      }

      if (open.length > 1 || overlapDays > 0) {
        findings.push({
          companyId,
          userId,
          name: shifts[0]?.users?.name || "Unknown",
          openCount: open.length,
          overlapDays,
          trimmedHours: Math.round(trimmedHours * 100) / 100,
        })
      }
    }
  }

  // One alert per company, listing everybody. A separate alert per worker on
  // the morning an import went wrong would bury the alerts tab in the thing it
  // is trying to warn about.
  const alerted: string[] = []
  const byCompanyFindings = new Map<string, typeof findings>()
  for (const f of findings) {
    byCompanyFindings.set(f.companyId, [...(byCompanyFindings.get(f.companyId) || []), f])
  }

  for (const [companyId, list] of byCompanyFindings) {
    // Once a day per company: this runs nightly, and a repeat alert for a
    // problem somebody is already looking at is noise.
    const dayAgo = new Date(Date.now() - 23 * 60 * 60 * 1000).toISOString()
    const { data: recent } = await service
      .from("alerts")
      .select("id")
      .eq("company_id", companyId)
      .eq("alert_type", ALERT_TYPE)
      .gte("created_at", dayAgo)
      .limit(1)
    if (recent && recent.length > 0) continue

    const liveNow = list.filter(f => f.openCount > 1)
    const names = list.slice(0, 6).map(f => f.name).join(", ")
    const more = list.length > 6 ? ` and ${list.length - 6} more` : ""

    const message =
      (liveNow.length > 0
        ? `${liveNow.length} ${liveNow.length === 1 ? "worker is" : "workers are"} signed in to more than one job right now. `
        : "") +
      `Overlapping shifts found for: ${names}${more}. ` +
      `Pay counts each minute once, so nobody is paid twice, but the hours on ` +
      `these timesheets are lower than the recorded shifts add up to. ` +
      `Check the sign-out times.`

    const { error: alertErr } = await service.from("alerts").insert({
      company_id: companyId,
      alert_type: ALERT_TYPE,
      message,
      status: "open",
      // 3 when somebody is signed in twice right now, because that is still
      // accruing; 2 for a historical record that needs correcting.
      urgency: liveNow.length > 0 ? 3 : 2,
      is_read: false,
    })
    if (alertErr) {
      console.error(`[overlap-check] could not alert company ${companyId}:`, alertErr.message)
      continue
    }
    alerted.push(companyId)
  }

  console.log(
    `[overlap-check] ${findings.length} worker(s) with overlaps across ` +
      `${byCompanyFindings.size} company(ies); alerted ${alerted.length}`,
  )

  return NextResponse.json({
    ok: true,
    lookbackDays: LOOKBACK_DAYS,
    workersAffected: findings.length,
    companiesAlerted: alerted.length,
    findings: findings.slice(0, 50),
  })
}
