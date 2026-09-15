// lib/weekly-report-send.ts
//
// One company, one week, one email. The only path that sends the weekly report.
//
// This used to live inside the cron route, which was fine while the cron was
// the only caller. It is not any more: an admin can now ask for the report from
// Settings, and two copies of "gather the week, render it, email it" would have
// drifted apart on the first change to either. The rule is that the button and
// the Friday job send the SAME email, because a support conversation that
// starts "click send now and tell me what you get" is worthless if the manual
// send takes a different path from the one that is failing.
//
// The caller decides policy -- whether an empty week is worth sending. That is
// the only thing the cron and the button legitimately disagree about, and it is
// an argument rather than a branch on "am I a cron".

import { historyDays, toPlan } from "./plan"
import { addDays, formatIn, londonMidnight } from "./format-time"
import { renderWeeklyReportPdf, summariseWeek } from "./weekly-report"

export type WeeklyReportCompany = {
  id: string
  name: string
  plan: string | null
}

export type WeeklySendResult =
  | {
      status: "sent"
      /**
       * Resend's id for the message. Null only if the provider accepted the
       * send but returned a body we could not read an id out of, which has not
       * been observed -- it is null rather than an error because an email that
       * went out is still an email that went out.
       */
      messageId: string | null
      recipients: string[]
      totalHours: number
      shiftCount: number
    }
  | { status: "skipped"; why: string }
  | { status: "failed"; why: string }

export type WeeklySendOptions = {
  /**
   * Send even if nobody signed in.
   *
   * False for the cron: "0 hours, 0 shifts" every Friday to a company that has
   * not started yet is how a helpful email becomes one people filter away.
   * True for the button, because a button that decides it knows better and does
   * nothing is a broken button -- somebody asked for the report.
   */
  allowEmptyWeek: boolean
}

/**
 * Build and send one company's week.
 *
 * Writes nothing. The per-week marker is the CRON's dedupe and stays the cron's
 * business: a manual send on Wednesday must not suppress Friday's, and an admin
 * who clicks the button twice has asked for it twice.
 */
export async function sendWeeklyReport(
  service: any,
  company: WeeklyReportCompany,
  weekStart: string,
  options: WeeklySendOptions,
): Promise<WeeklySendResult> {
  const from = londonMidnight(weekStart)
  const until = londonMidnight(addDays(weekStart, 7))

  const { data: admins, error: adminErr } = await service
    .from("users")
    .select("email, name")
    .eq("company_id", company.id)
    .in("role", ["admin", "superadmin"])
    .eq("is_active", true)

  if (adminErr) return { status: "failed", why: `could not list admins: ${adminErr.message}` }

  const recipients = (admins || []).map((a: any) => a.email).filter(Boolean)
  if (recipients.length === 0) {
    return { status: "skipped", why: "no active admin with an email" }
  }

  const { data: signins, error: signinErr } = await service
    .from("signins")
    .select("id, user_id, job_id, signed_in_at, signed_out_at, hours_worked, users:user_id (name)")
    .eq("company_id", company.id)
    .gte("signed_in_at", from.toISOString())
    .lt("signed_in_at", until.toISOString())

  if (signinErr) return { status: "failed", why: `could not read shifts: ${signinErr.message}` }

  const rows = signins || []
  if (rows.length === 0 && !options.allowEmptyWeek) {
    return { status: "skipped", why: "no shifts this week" }
  }

  const summary = summariseWeek(company.name, weekStart, rows, historyDays(toPlan(company.plan)))
  const pdf = await renderWeeklyReportPdf(summary)

  const send = await emailReport(recipients, company.name, weekStart, pdf, summary.totalHours)
  if (!send.ok) return { status: "failed", why: send.why }

  // The id is logged HERE rather than left to each caller, so it is recorded
  // once for every send however it was triggered. Without it, "did the report go
  // out" could only be answered by asking the customer, and a Resend dashboard
  // search needs something to search for.
  console.log(
    `[weekly-report] sent company=${company.id} (${company.name}) week=${weekStart} ` +
      `to=${recipients.length} resend_id=${send.messageId ?? "unknown"}`,
  )

  return {
    status: "sent",
    messageId: send.messageId,
    recipients,
    totalHours: summary.totalHours,
    shiftCount: summary.shiftCount,
  }
}

/**
 * Pull Resend's message id out of an accepted response body.
 *
 * Resend answers { "id": "..." }. This reads it defensively and returns null
 * rather than throwing, because by the time this runs the email has ALREADY
 * been accepted: a body we cannot parse is a hole in our records, not a failed
 * send, and reporting it as a failure would make an admin send a second copy.
 *
 * Exported for the sake of the tests. Nothing else should need it.
 */
export function readResendMessageId(body: string): string | null {
  try {
    const parsed = JSON.parse(body)
    if (parsed && typeof parsed.id === "string" && parsed.id.trim()) return parsed.id
  } catch {
    // Not JSON. Falls through to null.
  }
  return null
}

type EmailResult = { ok: true; messageId: string | null } | { ok: false; why: string }

async function emailReport(
  to: string[],
  companyName: string,
  weekStart: string,
  pdf: Uint8Array,
  totalHours: number,
): Promise<EmailResult> {
  const key = process.env.RESEND_API_KEY
  if (!key) {
    console.error("[weekly-report] RESEND_API_KEY is not set")
    return { ok: false, why: "RESEND_API_KEY is not set" }
  }

  const weekLabel =
    `${formatIn(londonMidnight(weekStart), { day: "numeric", month: "short" })} to ` +
    `${formatIn(londonMidnight(addDays(weekStart, 6)), { day: "numeric", month: "short" })}`
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
            worth keeping &mdash; it outlives the rows behind it.
          </p>
          <a href="https://app.getvantro.com/admin" style="display:inline-block;background:#00C896;color:#07100D;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:700">Open Vantro</a>
          <p style="color:#888;font-size:12px;margin-top:24px">You are receiving this because you are an admin on ${companyName}.</p>
        </div>`,
        attachments: [{ filename, content: Buffer.from(pdf).toString("base64") }],
      }),
    })

    const body = await res.text()
    if (!res.ok) {
      console.error("[weekly-report] resend rejected:", res.status, body)
      return { ok: false, why: `resend ${res.status}: ${body.slice(0, 200)}` }
    }

    const messageId = readResendMessageId(body)
    if (messageId === null) {
      console.error("[weekly-report] resend accepted but returned no id:", body.slice(0, 200))
    }
    return { ok: true, messageId }
  } catch (err: any) {
    console.error("[weekly-report] send threw:", err?.message || err)
    return { ok: false, why: `send threw: ${err?.message || "unknown"}` }
  }
}
