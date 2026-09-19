// lib/captured-week-send.ts
//
// One Suite company, one week, one "what you captured" email. The only path
// that sends it: the Friday cron and the admin's "send me this now" both call
// sendCapturedWeek, so a support conversation that starts "send yourself one
// and tell me what you see" is testing the real thing.
//
// The counts are read here; the words are lib/captured-week.ts; the money is
// lib/captured.ts, which is also what the TODAY board calls. Hours come from
// summariseWeek in lib/weekly-report.ts, the same function the free plan's
// Friday PDF uses, so the two emails cannot disagree about a week.

import { addDays, londonMidnight } from "./format-time"
import { loadCaptured } from "./captured"
import { buildCapturedWeekEmail, isEmptyWeek, type CapturedWeek } from "./captured-week"
import { summariseWeek } from "./weekly-report"
import { readResendMessageId } from "./weekly-report-send"

export type CapturedWeekCompany = { id: string; name: string }

export type CapturedWeekResult =
  | { status: "sent"; messageId: string | null; recipients: string[]; week: CapturedWeek }
  | { status: "skipped"; why: string; week?: CapturedWeek }
  | { status: "failed"; why: string }

const count = async (q: any, what: string): Promise<number> => {
  const { count: n, error } = await q
  if (error) throw new Error(`${what}: ${error.message}`)
  return n || 0
}

/**
 * Read the week. `now` is the moment "this month" is measured from for the
 * uncaptured figure, which is the TODAY board's number at the time of sending.
 */
export async function loadCapturedWeek(
  service: any,
  company: CapturedWeekCompany,
  weekStart: string,
  now: Date = new Date(),
): Promise<CapturedWeek> {
  const from = londonMidnight(weekStart).toISOString()
  const until = londonMidnight(addDays(weekStart, 7)).toISOString()
  const inWeek = (q: any, col = "created_at") => q.eq("company_id", company.id).gte(col, from).lt(col, until)

  // Photos: every site photograph the app took this week, wherever it was
  // filed. Receipts are left out on purpose -- a picture of a till slip is
  // not what anyone means by photos from site.
  const [diaryRows, qaPhotos, defectPhotos, incidentRows, variationRows, signins, captured] = await Promise.all([
    inWeek(service.from("diary_entries").select("photo_urls")).limit(10000),
    count(inWeek(service.from("qa_submissions").select("id", { count: "exact", head: true })).not("photo_url", "is", null), "qa photos"),
    count(inWeek(service.from("defects").select("id", { count: "exact", head: true })).not("photo_url", "is", null), "defect photos"),
    inWeek(service.from("incidents").select("photo_urls"), "reported_at").limit(10000),
    inWeek(service.from("variations").select("kind, photo_urls")).limit(10000),
    service
      .from("signins")
      .select("id, user_id, job_id, signed_in_at, signed_out_at, hours_worked, users:user_id (name)")
      .eq("company_id", company.id)
      .gte("signed_in_at", from)
      .lt("signed_in_at", until)
      .limit(20000),
    loadCaptured(service, company.id, now),
  ])
  for (const [r, what] of [[diaryRows, "diary"], [incidentRows, "incidents"], [variationRows, "variations"], [signins, "signins"]] as const) {
    if ((r as any).error) throw new Error(`${what}: ${(r as any).error.message}`)
  }

  const arrLen = (rows: any[] | null) => (rows || []).reduce((n, r) => n + ((r.photo_urls || []).length), 0)
  const vRows: any[] = variationRows.data || []

  return {
    companyName: company.name,
    weekStart,
    photos: arrLen(diaryRows.data) + qaPhotos + defectPhotos + arrLen(incidentRows.data) + arrLen(vRows),
    diaryEntries: (diaryRows.data || []).length,
    variationsRaised: vRows.filter(v => v.kind !== "daywork").length,
    dayworksRaised: vRows.filter(v => v.kind === "daywork").length,
    hoursLogged: summariseWeek(company.name, weekStart, signins.data || [], null).totalHours,
    uncaptured: { pence: captured.pence },
  }
}

export type CapturedWeekOptions = {
  /** False for the cron: an empty week is not worth an email. True for the button. */
  allowEmptyWeek: boolean
  /**
   * Who to send to. Omitted, it is every active admin with an email -- the
   * cron. The button passes only the person who pressed it.
   */
  to?: string[]
  now?: Date
}

export async function sendCapturedWeek(
  service: any,
  company: CapturedWeekCompany,
  weekStart: string,
  options: CapturedWeekOptions,
): Promise<CapturedWeekResult> {
  let recipients = options.to
  if (!recipients) {
    const { data: admins, error } = await service
      .from("users")
      .select("email")
      .eq("company_id", company.id)
      .in("role", ["admin", "superadmin"])
      .eq("is_active", true)
    if (error) return { status: "failed", why: `could not list admins: ${error.message}` }
    recipients = (admins || []).map((a: any) => a.email).filter(Boolean)
  }
  recipients = Array.from(new Set((recipients || []).map(e => e.trim().toLowerCase()).filter(Boolean)))
  if (recipients.length === 0) return { status: "skipped", why: "no active admin with an email" }

  let week: CapturedWeek
  try {
    week = await loadCapturedWeek(service, company, weekStart, options.now)
  } catch (e: any) {
    return { status: "failed", why: `could not read the week: ${e?.message || e}` }
  }
  if (isEmptyWeek(week) && !options.allowEmptyWeek) return { status: "skipped", why: "nothing captured this week", week }

  const key = process.env.RESEND_API_KEY
  if (!key) return { status: "failed", why: "RESEND_API_KEY is not set" }

  const email = buildCapturedWeekEmail(week)
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "Vantro <noreply@getvantro.com>",
        to: recipients,
        subject: email.subject,
        html: email.html,
        text: email.text,
      }),
    })
    const body = await res.text()
    if (!res.ok) return { status: "failed", why: `resend ${res.status}: ${body.slice(0, 200)}` }
    const messageId = readResendMessageId(body)
    console.log(
      `[captured-week] sent company=${company.id} week=${weekStart} to=${recipients.length} ` +
        `resend_id=${messageId ?? "unknown"} uncaptured=${week.uncaptured.pence}p`,
    )
    return { status: "sent", messageId, recipients, week }
  } catch (e: any) {
    return { status: "failed", why: `send threw: ${e?.message || "unknown"}` }
  }
}
