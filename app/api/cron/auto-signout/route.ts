// app/api/cron/auto-signout/route.ts
// Runs every 15 min via Vercel Cron.
// Time-based safety net (GPS removed). The primary auto sign-out now happens in
// the notifications engine 30 min after a shift's scheduled end. This cron only
// catches shifts that slip through that path:
//
//   - signed_in_at > 14 hours ago            -> close (hard cap, open too long)
//   - now > job sign_out_time + 2 hours      -> close (scheduled shift ended)
//
// Shifts with no expected end at all are only caught by the 14-hour hard cap.
// No location pings / proximity are consulted — close times are purely the
// scheduled end (or signed_in + 8h for the hard-cap case).
// auto_closed_reason: "shift_ended" | "max_shift_duration"
// signed_out_method: "auto"; flagged: true so admin sees the server caught it.
//
// Auth: Vercel cron sends Authorization: Bearer <CRON_SECRET>

import { NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/server"

const MAX_SHIFT_HOURS = 14
const SHIFT_END_GRACE_HOURS = 2

export async function GET(request: Request) {
  const auth = request.headers.get("authorization")
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const service = await createServiceClient()
  const now = new Date()

  const { data: openSignins, error: signinsErr } = await service
    .from("signins")
    .select("id, user_id, job_id, signed_in_at, jobs!inner(id, sign_out_time)")
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

    // Hard cap: nobody works a single shift longer than this.
    if (ageHours > MAX_SHIFT_HOURS) {
      const closeAt = new Date(signedInAt.getTime() + 8 * 3600000)
      await closeSignin(service, s.id, closeAt, signedInAt, "max_shift_duration")
      results.push({ signinId: s.id, action: "closed", reason: "max_shift_duration", ageHours: ageHours.toFixed(1) })
      continue
    }

    // Scheduled shift ended: now is past the job's sign_out_time plus a grace window.
    if (job?.sign_out_time) {
      const [h, m] = String(job.sign_out_time).split(":").map(Number)
      if (!isNaN(h) && !isNaN(m)) {
        const expectedSignOut = new Date(signedInAt)
        expectedSignOut.setHours(h, m, 0, 0)
        // Overnight shift: scheduled end is before sign-in, so it's the next day.
        if (expectedSignOut.getTime() < signedInAt.getTime()) {
          expectedSignOut.setDate(expectedSignOut.getDate() + 1)
        }
        const threshold = expectedSignOut.getTime() + SHIFT_END_GRACE_HOURS * 3600000
        if (now.getTime() > threshold) {
          await closeSignin(service, s.id, expectedSignOut, signedInAt, "shift_ended")
          results.push({ signinId: s.id, action: "closed", reason: "shift_ended", ageHours: ageHours.toFixed(1) })
          continue
        }
      }
    }

    results.push({ signinId: s.id, action: "skip", reason: "within_shift_window", ageHours: ageHours.toFixed(1) })
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

async function closeSignin(service: any, signinId: string, signedOutAt: Date, signedInAt: Date, reason: string) {
  const hoursWorked = (signedOutAt.getTime() - signedInAt.getTime()) / 3600000
  await service
    .from("signins")
    .update({
      signed_out_at: signedOutAt.toISOString(),
      hours_worked: parseFloat(hoursWorked.toFixed(2)),
      auto_closed: true,
      auto_closed_reason: reason,
      signed_out_method: "auto",
      flagged: true,
    })
    .eq("id", signinId)
}
