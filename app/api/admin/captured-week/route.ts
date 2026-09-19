// app/api/admin/captured-week/route.ts
//
// POST -- send this week's "what you captured" email to ME, now.
//
// The answer to "what will Friday's email say?" without waiting for Friday or
// holding the cron secret. Two differences from the cron, both deliberate:
//
//   ONE RECIPIENT  the admin who pressed it, not every admin. A preview that
//                  mails the whole office is not a preview.
//   NO MARKER      last_captured_week is the cron's dedupe; a Wednesday
//                  preview must not cancel Friday's email.
//
// The send is the shared path in lib/captured-week-send.ts, so the preview is
// the real email.

import { NextResponse } from "next/server"
import { suiteCaller } from "@/lib/suite-caller"
import { isoWeekStart } from "@/lib/format-time"
import { sendCapturedWeek } from "@/lib/captured-week-send"
import { looksLikeEmail } from "@/lib/variations"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

export async function POST() {
  const c = await suiteCaller("variations")
  if ("error" in c) return c.error
  const { service, company, ctx } = c

  if (!looksLikeEmail(ctx.email)) {
    return NextResponse.json({ error: "Your account has no email address to send to" }, { status: 400 })
  }

  const weekStart = isoWeekStart(new Date())
  const result = await sendCapturedWeek(service, company, weekStart, { allowEmptyWeek: true, to: [ctx.email] })

  if (result.status === "failed") return NextResponse.json({ error: result.why }, { status: 502 })
  if (result.status === "skipped") return NextResponse.json({ error: result.why }, { status: 409 })
  return NextResponse.json({ ok: true, weekStart, messageId: result.messageId, sentTo: result.recipients, week: result.week })
}
