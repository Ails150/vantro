// app/api/admin/weekly-report/route.ts
//
// POST -- send this week's report to this company's admins, now.
//
// The Friday cron has always been able to do this; nobody else could. That made
// one ordinary question unanswerable without a deploy or a cron secret: "what
// does the email actually look like for us, and did it reach our inbox?" The
// button answers it in one click.
//
// Three deliberate differences from the cron, each of which is the whole point:
//
//   AUTHENTICATION  the caller's admin session, not CRON_SECRET. A secret that
//                   has to be pasted into a URL to test a feature ends up in a
//                   chat log; this needs no secret at all because the caller is
//                   already proven to be an admin of the company they are
//                   sending for.
//   EVERY PLAN      the cron mails free companies because only free loses its
//                   rows. A paid admin who wants the summary is not wrong to
//                   want it, and refusing on plan would make the button
//                   mysteriously dead for the customers who pay us.
//   NO MARKER       last_weekly_report_week is the cron's dedupe. A manual send
//                   on Wednesday must not cancel Friday's automatic one, so
//                   this route neither reads nor writes it.
//
// The send itself is the shared path in lib/weekly-report-send.ts, so what
// lands in the inbox is byte-for-byte what the cron would have sent.

import { NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/server"
import { getCallerContext } from "@/lib/company-context"
import { isoWeekStart } from "@/lib/format-time"
import { sendWeeklyReport } from "@/lib/weekly-report-send"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

// Foreman is left out on purpose. This emails every admin on the company a
// company-wide hours summary; that is an owner's document, not a supervisor's.
const SENDER_ROLES = ["admin", "superadmin", "support"]

export async function POST() {
  const ctx = await getCallerContext()
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!SENDER_ROLES.includes(ctx.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  // A support user who has not picked a company yet has no report to send.
  if (!ctx.companyId) {
    return NextResponse.json({ error: "No company selected" }, { status: 400 })
  }

  const service = await createServiceClient()
  const { data: company, error: companyErr } = await service
    .from("companies")
    .select("id, name, plan")
    .eq("id", ctx.companyId)
    .single()

  if (companyErr || !company) {
    return NextResponse.json({ error: "Company not found" }, { status: 404 })
  }

  const weekStart = isoWeekStart(new Date())

  // allowEmptyWeek, because somebody pressed a button. The cron is right to
  // stay quiet about a week with no shifts; a button that silently does nothing
  // teaches an admin the feature is broken.
  const result = await sendWeeklyReport(service, company, weekStart, { allowEmptyWeek: true })

  console.log(
    `[weekly-report] manual send by user=${ctx.userId} company=${company.id} ` +
      `week=${weekStart} status=${result.status}` +
      (result.status === "sent" ? ` resend_id=${result.messageId ?? "unknown"}` : ""),
  )

  if (result.status === "failed") {
    return NextResponse.json({ error: result.why }, { status: 502 })
  }
  if (result.status === "skipped") {
    return NextResponse.json({ error: result.why }, { status: 409 })
  }

  return NextResponse.json({
    ok: true,
    weekStart,
    // Returned, not just logged: the id is how a send is traced in Resend, and
    // making an admin ask support to read a log line for them is the friction
    // this button exists to remove.
    messageId: result.messageId,
    recipients: result.recipients,
    totalHours: result.totalHours,
    shiftCount: result.shiftCount,
  })
}
