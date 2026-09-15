// app/api/cron/weekly-report/route.ts
//
// Friday, 5pm, London. A one-page PDF of the week to every free-plan admin.
//
// Free retention is five days, so by the middle of next week this week's rows
// are gone. The report is what makes that honest: the detail expires, the
// summary lands in an inbox and can be forwarded to an accountant. It is also
// the weekly reminder that the product did something, which is the job a free
// tier has to do to become a paid one.
//
// Scheduling note. Vercel crons are UTC and have no zone, but "5pm Friday"
// means 5pm where the customer is -- 16:00 UTC under BST, 17:00 under GMT. So
// the schedule fires at BOTH hours and this handler sends only on the one that
// is actually 17:00 in London. companies.last_weekly_report_week keeps the
// other firing (and any retry) from sending a second copy.
//
// The send itself lives in lib/weekly-report-send.ts, shared with the admin
// "send now" button. What stays here is the part that is genuinely the cron's:
// the clock, the free-plan audience, and the per-week marker.

import { NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/server"
import { authoriseCron } from "@/lib/cron-auth"
import { formatIn, isoWeekStart } from "@/lib/format-time"
import { sendWeeklyReport } from "@/lib/weekly-report-send"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

const SEND_HOUR_LONDON = 17
const SEND_WEEKDAY = "Fri"

export async function GET(request: Request) {
  if (!authoriseCron(request).ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const url = new URL(request.url)
  // ?force=1 runs the send regardless of the clock, for testing a real send on
  // demand. It still respects the per-week marker, so it cannot double-send.
  const force = url.searchParams.get("force") === "1"

  const now = new Date()
  const londonHour = Number(formatIn(now, { hour: "2-digit", hour12: false }))
  const londonDay = formatIn(now, { weekday: "short" })

  if (!force && (londonDay !== SEND_WEEKDAY || londonHour !== SEND_HOUR_LONDON)) {
    // Not an error: the schedule deliberately fires twice so that one of them
    // is right whichever side of the DST change we are on.
    return NextResponse.json({
      ok: true,
      skipped: `not ${SEND_WEEKDAY} ${SEND_HOUR_LONDON}:00 in London (it is ${londonDay} ${londonHour}:00)`,
    })
  }

  const service = await createServiceClient()
  const weekStart = isoWeekStart(now)

  const { data: companies, error: listErr } = await service
    .from("companies")
    .select("id, name, plan, last_weekly_report_week")
    .eq("plan", "free")

  if (listErr) {
    console.error("[weekly-report] could not list companies:", listErr)
    return NextResponse.json({ error: "Could not list companies" }, { status: 500 })
  }

  const sent: Array<{ company: string; messageId: string | null }> = []
  const skipped: Array<{ company: string; why: string }> = []

  for (const company of companies || []) {
    try {
      if (company.last_weekly_report_week === weekStart) {
        skipped.push({ company: company.name, why: "already sent this week" })
        continue
      }

      const result = await sendWeeklyReport(service, company, weekStart, {
        allowEmptyWeek: false,
      })

      if (result.status === "skipped") {
        skipped.push({ company: company.name, why: result.why })
        // A week with nothing in it is marked anyway, so the second firing does
        // not re-check it. Every other skip reason is left unmarked so it is
        // retried.
        if (result.why === "no shifts this week") {
          await service
            .from("companies")
            .update({ last_weekly_report_week: weekStart })
            .eq("id", company.id)
        }
        continue
      }

      if (result.status === "failed") {
        skipped.push({ company: company.name, why: result.why })
        continue
      }

      // Only marked after a send the provider accepted, so a failure retries on
      // the next firing rather than being silently dropped for the week.
      await service
        .from("companies")
        .update({ last_weekly_report_week: weekStart })
        .eq("id", company.id)
      sent.push({ company: company.name, messageId: result.messageId })
    } catch (err: any) {
      // One company's bad data must not stop everyone else's report.
      console.error(`[weekly-report] ${company.id} failed:`, err?.message || err)
      skipped.push({ company: company.name, why: `error: ${err?.message || "unknown"}` })
    }
  }

  console.log(`[weekly-report] week ${weekStart}: sent ${sent.length}, skipped ${skipped.length}`)
  return NextResponse.json({ ok: true, weekStart, sent, skipped })
}
