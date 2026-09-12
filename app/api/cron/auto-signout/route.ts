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
import { authoriseCron } from "@/lib/cron-auth"

const MAX_SHIFT_HOURS = 14
const SHIFT_END_GRACE_HOURS = 2

export async function GET(request: Request) {
  const cron = authoriseCron(request)
  if (!cron.ok) {
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
      const closed = await closeSignin(service, s.id, closeAt, signedInAt, "max_shift_duration")
      results.push({
        signinId: s.id,
        action: closed ? "closed" : "close_failed",
        reason: "max_shift_duration",
        ageHours: ageHours.toFixed(1),
      })
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
          const closed = await closeSignin(service, s.id, expectedSignOut, signedInAt, "shift_ended")
          results.push({
            signinId: s.id,
            action: closed ? "closed" : "close_failed",
            reason: "shift_ended",
            ageHours: ageHours.toFixed(1),
          })
          continue
        }
      }
    }

    results.push({ signinId: s.id, action: "skip", reason: "within_shift_window", ageHours: ageHours.toFixed(1) })
  }

  const failed = results.filter(r => r.action === "close_failed").length
  if (failed > 0) {
    console.error("[cron] auto-signout could not close", failed, "shift(s) - see rejections above")
  }

  return NextResponse.json({
    ok: true,
    runAt: now.toISOString(),
    totalOpen: openSignins?.length || 0,
    closed: results.filter(r => r.action === "closed").length,
    closeFailed: failed,
    skipped: results.filter(r => r.action === "skip").length,
    results,
  })
}

// Returns whether the shift actually closed.
//
// This used to be fire-and-forget. From 2026-09-04 the evidence write-once
// trigger rejected every one of these UPDATEs (signed_out_method defaulted to
// 'manual', so 'auto' was a rewrite, not a first write - see
// 20260912090000_signout_method_not_write_once.sql). The error went nowhere,
// the route reported "closed", and the 14-hour safety net was dead for eight
// days without a single line in the logs. An unreported failure here is worse
// than a loud one: this is the last thing standing between a stuck shift and a
// wrong timesheet.
async function closeSignin(
  service: any,
  signinId: string,
  signedOutAt: Date,
  signedInAt: Date,
  reason: string,
): Promise<boolean> {
  const hoursWorked = (signedOutAt.getTime() - signedInAt.getTime()) / 3600000
  const { data, error } = await service
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
    .is("signed_out_at", null)
    .select("id")

  if (error) {
    console.error("[cron] auto-signout UPDATE rejected - shift left open", {
      signinId,
      reason,
      code: error.code,
      message: error.message,
    })
    return false
  }
  return Array.isArray(data) && data.length > 0
}
