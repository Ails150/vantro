// app/api/cron/captured-week/route.ts
//
// Friday, 5pm, London. "What you captured this week" to every Suite admin:
// photos taken, diary entries, variations raised, hours logged, and the
// captured-this-month figure from the TODAY board.
//
// The free plan's weekly PDF goes out on the same clock from
// /api/cron/weekly-report. This is its Suite counterpart and is kept apart
// rather than folded in: different audience, different marker, and one
// company's failure in either must not stop the other.
//
// Same scheduling trick as the weekly report: Vercel crons are UTC, so the
// schedule fires at 16:00 and 17:00 UTC and this sends only on the one that is
// 17:00 in London. companies.last_captured_week stops the other firing, and
// any retry, from sending a second copy.

import { NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/server"
import { authoriseCron } from "@/lib/cron-auth"
import { formatIn, isoWeekStart } from "@/lib/format-time"
import { sendCapturedWeek } from "@/lib/captured-week-send"

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
  // ?force=1 runs regardless of the clock. It still respects the per-week
  // marker, so it cannot double-send.
  const force = url.searchParams.get("force") === "1"

  const now = new Date()
  const londonHour = Number(formatIn(now, { hour: "2-digit", hour12: false }))
  const londonDay = formatIn(now, { weekday: "short" })
  if (!force && (londonDay !== SEND_WEEKDAY || londonHour !== SEND_HOUR_LONDON)) {
    return NextResponse.json({
      ok: true,
      skipped: `not ${SEND_WEEKDAY} ${SEND_HOUR_LONDON}:00 in London (it is ${londonDay} ${londonHour}:00)`,
    })
  }

  const service = await createServiceClient()
  const weekStart = isoWeekStart(now)

  const { data: companies, error } = await service
    .from("companies")
    .select("id, name, plan, last_captured_week")
    .eq("plan", "suite")
  if (error) {
    console.error("[captured-week] could not list companies:", error)
    return NextResponse.json({ error: "Could not list companies" }, { status: 500 })
  }

  const sent: Array<{ company: string; messageId: string | null }> = []
  const skipped: Array<{ company: string; why: string }> = []

  for (const company of companies || []) {
    try {
      if (company.last_captured_week === weekStart) {
        skipped.push({ company: company.name, why: "already sent this week" })
        continue
      }
      const result = await sendCapturedWeek(service, company, weekStart, { allowEmptyWeek: false, now })

      if (result.status === "sent") {
        await service.from("companies").update({ last_captured_week: weekStart }).eq("id", company.id)
        sent.push({ company: company.name, messageId: result.messageId })
        continue
      }
      skipped.push({ company: company.name, why: result.why })
      // An empty week is marked so the second firing does not re-read it.
      // Failures are left unmarked, so they retry.
      if (result.status === "skipped" && result.why === "nothing captured this week") {
        await service.from("companies").update({ last_captured_week: weekStart }).eq("id", company.id)
      }
    } catch (err: any) {
      console.error(`[captured-week] ${company.id} failed:`, err?.message || err)
      skipped.push({ company: company.name, why: `error: ${err?.message || "unknown"}` })
    }
  }

  console.log(`[captured-week] week ${weekStart}: sent ${sent.length}, skipped ${skipped.length}`)
  return NextResponse.json({ ok: true, weekStart, sent, skipped })
}
