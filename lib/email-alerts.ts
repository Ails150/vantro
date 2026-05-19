import { createServiceClient } from "@/lib/supabase/server"

type AlertType = "blocker" | "issue"

interface SendDiaryAlertEmailArgs {
  companyId: string
  jobId: string
  alertType: AlertType
  summary: string
  loggedBy: string
  photoUrls?: string[]
}

/**
 * Send email alert to all admins and foremen of a company who have
 * email_alert_prefs.enabled = true AND email_alert_prefs[alertType] = true.
 *
 * Rate-limited: max 1 email per recipient per job per hour.
 * Logs every send to email_alert_sends for audit + rate-limit lookup.
 *
 * Returns count of emails actually sent (after pref + rate-limit filtering).
 */
export async function sendDiaryAlertEmail(args: SendDiaryAlertEmailArgs): Promise<number> {
  const { companyId, jobId, alertType, summary, loggedBy, photoUrls } = args

  if (!process.env.RESEND_API_KEY) {
    console.warn("[email-alerts] RESEND_API_KEY not set, skipping")
    return 0
  }

  const service = await createServiceClient()

  // 1. Look up job name (for subject + body)
  const { data: job } = await service
    .from("jobs")
    .select("name")
    .eq("id", jobId)
    .single()
  const jobName = job?.name || "Unknown job"

  // 2. Look up eligible recipients
  const { data: recipients } = await service
    .from("users")
    .select("id, email, name, email_alert_prefs")
    .eq("company_id", companyId)
    .in("role", ["admin", "foreman", "superadmin"])
    .not("email", "is", null)

  if (!recipients || recipients.length === 0) return 0

  // 3. Filter by prefs
  const eligible = recipients.filter((r: any) => {
    const prefs = r.email_alert_prefs || { enabled: true, blockers: true, issues: true }
    if (prefs.enabled === false) return false
    if (alertType === "blocker" && prefs.blockers === false) return false
    if (alertType === "issue" && prefs.issues === false) return false
    return true
  })

  if (eligible.length === 0) return 0

  // 4. Rate limit: who has received an alert for this job in the last hour?
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  const { data: recent } = await service
    .from("email_alert_sends")
    .select("recipient_email")
    .eq("job_id", jobId)
    .gte("sent_at", oneHourAgo)

  const rateLimited = new Set((recent || []).map((r: any) => r.recipient_email))
  const toSend = eligible.filter((r: any) => !rateLimited.has(r.email))

  if (toSend.length === 0) {
    console.log("[email-alerts] All recipients rate-limited for job", jobId)
    return 0
  }

  // 5. Build email
  const subjectPrefix = alertType === "blocker" ? "BLOCKER" : "ISSUE"
  const headerColour = alertType === "blocker" ? "#dc2626" : "#d97706"
  const photoHtml = (photoUrls && photoUrls.length > 0)
    ? "<p style=\"margin-top:16px\">" + photoUrls.slice(0, 4).map(
        (u: string) => "<img src=\"" + u + "\" style=\"max-width:200px;margin:4px;border-radius:8px;border:1px solid #e5e7eb\">"
      ).join("") + "</p>"
    : ""

  const html = `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,sans-serif">
  <div style="max-width:600px;margin:24px auto;background:white;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1)">
    <div style="background:${headerColour};padding:20px 24px">
      <h1 style="color:white;margin:0;font-size:20px">${subjectPrefix} — ${escapeHtml(jobName)}</h1>
    </div>
    <div style="padding:24px">
      <p style="margin:0 0 8px;color:#6b7280;font-size:13px">Logged by ${escapeHtml(loggedBy)}</p>
      <p style="margin:0 0 16px;font-size:16px;color:#111827;line-height:1.5">${escapeHtml(summary)}</p>
      ${photoHtml}
      <a href="https://app.getvantro.com/admin" style="display:inline-block;margin-top:24px;padding:12px 24px;background:#00C896;color:white;border-radius:8px;text-decoration:none;font-weight:600">Open Vantro Dashboard</a>
      <p style="margin-top:32px;padding-top:16px;border-top:1px solid #e5e7eb;color:#9ca3af;font-size:12px">
        You're receiving this because email alerts are enabled on your Vantro account.
        Manage preferences in Team Settings.
      </p>
    </div>
  </div>
</body></html>`

  // 6. Send + log
  let sent = 0
  const logRows: any[] = []
  for (const r of toSend) {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + process.env.RESEND_API_KEY,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          from: "Vantro Alerts <alerts@getvantro.com>",
          to: r.email,
          subject: subjectPrefix + " — " + jobName,
          html
        })
      })
      if (res.ok) {
        sent++
        logRows.push({
          recipient_email: r.email,
          company_id: companyId,
          job_id: jobId,
          alert_type: alertType
        })
      } else {
        const errText = await res.text().catch(() => "")
        console.error("[email-alerts] Resend " + res.status + " for " + r.email + ": " + errText.slice(0, 200))
      }
    } catch (e) {
      console.error("[email-alerts] Send failed for " + r.email + ":", String(e))
    }
  }

  // 7. Bulk log rate-limit entries
  if (logRows.length > 0) {
    await service.from("email_alert_sends").insert(logRows)
  }

  console.log("[email-alerts] Sent " + sent + " of " + eligible.length + " eligible (" + rateLimited.size + " rate-limited)")
  return sent
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}
