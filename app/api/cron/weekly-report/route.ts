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

import { NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/server"
import { authoriseCron } from "@/lib/cron-auth"
import { historyDays, toPlan } from "@/lib/plan"
import { addDays, formatIn, isoWeekStart, londonMidnight } from "@/lib/format-time"
import { renderWeeklyReportPdf, summariseWeek } from "@/lib/weekly-report"

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
  const from = londonMidnight(weekStart)
  const until = londonMidnight(addDays(weekStart, 7))

  const { data: companies, error: listErr } = await service
    .from("companies")
    .select("id, name, plan, last_weekly_report_week")
    .eq("plan", "free")

  if (listErr) {
    console.error("[weekly-report] could not list companies:", listErr)
    return NextResponse.json({ error: "Could not list companies" }, { status: 500 })
  }

  const sent: string[] = []
  const skipped: Array<{ company: string; why: string }> = []

  for (const company of companies || []) {
    try {
      if (company.last_weekly_report_week === weekStart) {
        skipped.push({ company: company.name, why: "already sent this week" })
        continue
      }

      const { data: admins } = await service
        .from("users")
        .select("email, name")
        .eq("company_id", company.id)
        .in("role", ["admin", "superadmin"])
        .eq("is_active", true)

      const recipients = (admins || []).map((a: any) => a.email).filter(Boolean)
      if (recipients.length === 0) {
        skipped.push({ company: company.name, why: "no active admin with an email" })
        continue
      }

      const { data: signins } = await service
        .from("signins")
        .select("id, user_id, job_id, signed_in_at, signed_out_at, hours_worked, users:user_id (name)")
        .eq("company_id", company.id)
        .gte("signed_in_at", from.toISOString())
        .lt("signed_in_at", until.toISOString())

      const rows = signins || []

      // A week with nothing in it is not worth an attachment. Sending "0
      // hours, 0 shifts" every Friday to a company that has not started yet is
      // how a helpful email becomes one people filter away.
      if (rows.length === 0) {
        skipped.push({ company: company.name, why: "no shifts this week" })
        // Marked anyway, so the second firing does not re-check it.
        await service
          .from("companies")
          .update({ last_weekly_report_week: weekStart })
          .eq("id", company.id)
        continue
      }

      const summary = summariseWeek(
        company.name,
        weekStart,
        rows,
        historyDays(toPlan(company.plan)),
      )
      const pdf = await renderWeeklyReportPdf(summary)

      const ok = await emailReport(recipients, company.name, weekStart, pdf, summary.totalHours)
      if (!ok) {
        skipped.push({ company: company.name, why: "email failed" })
        continue
      }

      // Only marked after a send the provider accepted, so a failure retries
      // on the next firing rather than being silently dropped for the week.
      await service
        .from("companies")
        .update({ last_weekly_report_week: weekStart })
        .eq("id", company.id)
      sent.push(company.name)
    } catch (err: any) {
      // One company's bad data must not stop everyone else's report.
      console.error(`[weekly-report] ${company.id} failed:`, err?.message || err)
      skipped.push({ company: company.name, why: `error: ${err?.message || "unknown"}` })
    }
  }

  console.log(`[weekly-report] week ${weekStart}: sent ${sent.length}, skipped ${skipped.length}`)
  return NextResponse.json({ ok: true, weekStart, sent, skipped })
}

async function emailReport(
  to: string[],
  companyName: string,
  weekStart: string,
  pdf: Uint8Array,
  totalHours: number,
): Promise<boolean> {
  const key = process.env.RESEND_API_KEY
  if (!key) {
    console.error("[weekly-report] RESEND_API_KEY is not set")
    return false
  }

  const weekLabel = `${formatIn(londonMidnight(weekStart), { day: "numeric", month: "short" })} to ${formatIn(londonMidnight(addDays(weekStart, 6)), { day: "numeric", month: "short" })}`
  const filename = `vantro-week-${weekStart}.pdf`

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "Vantro <noreply@getvantro.com>",
        to,
        subject: `${companyName}: your week, ${weekLabel}`,
        html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px">
          <div style="background:#00C896;width:40px;height:40px;border-radius:8px;text-align:center;line-height:40px;margin-bottom:24px">
            <span style="color:#07100D;font-weight:800;font-size:1rem">V</span>
          </div>
          <h2 style="color:#0A1A14;font-size:1.4rem;margin-bottom:12px">Your week at ${companyName}</h2>
          <p style="color:#4A6158;line-height:1.6;margin-bottom:8px">
            ${totalHours.toFixed(1)} hours recorded between ${weekLabel}. The full
            breakdown is attached as a PDF.
          </p>
          <p style="color:#4A6158;line-height:1.6;margin-bottom:24px">
            Shift records are kept for 5 days on the Free plan, so this summary is
            worth keeping — it outlives the rows behind it.
          </p>
          <a href="https://app.getvantro.com/admin" style="display:inline-block;background:#00C896;color:#07100D;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:700">Open Vantro</a>
          <p style="color:#888;font-size:12px;margin-top:24px">You are receiving this because you are an admin on ${companyName}.</p>
        </div>`,
        attachments: [
          { filename, content: Buffer.from(pdf).toString("base64") },
        ],
      }),
    })
    if (!res.ok) {
      console.error("[weekly-report] resend rejected:", res.status, await res.text())
      return false
    }
    return true
  } catch (err: any) {
    console.error("[weekly-report] send threw:", err?.message || err)
    return false
  }
}
