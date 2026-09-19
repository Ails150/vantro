// lib/captured-week.ts
//
// Friday's "what you captured this week" email for Suite admins, as data and
// as words. Pure: the numbers come in, the subject and body come out, so the
// email can be pinned in a test without sending anything.
//
// The body is four counts and one sentence. The counts are the site's week --
// photos taken, diary entries written, variations raised, hours logged -- and
// the sentence is the TODAY board's "captured this month" line, word for word,
// because it is the one number in the email somebody can act on.

import { addDays, formatIn, londonMidnight } from "./format-time"
import { capturedSentence, type Captured } from "./captured"

export type CapturedWeek = {
  companyName: string
  /** Monday, YYYY-MM-DD, London. */
  weekStart: string
  photos: number
  diaryEntries: number
  variationsRaised: number
  dayworksRaised: number
  hoursLogged: number
  /** From lib/captured.ts: this month, approved, not on an application. */
  uncaptured: Pick<Captured, "pence">
}

/** Nothing happened and nothing is owed. Not worth an email on a Friday. */
export function isEmptyWeek(w: CapturedWeek): boolean {
  return w.photos === 0 && w.diaryEntries === 0 && w.variationsRaised === 0 &&
    w.dayworksRaised === 0 && w.hoursLogged === 0 && w.uncaptured.pence === 0
}

export function weekLabel(weekStart: string): string {
  const from = formatIn(londonMidnight(weekStart), { day: "numeric", month: "short" })
  const to = formatIn(londonMidnight(addDays(weekStart, 6)), { day: "numeric", month: "short" })
  return `${from} to ${to}`
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** "142.5 hours". One decimal, and "1 hour" when it is exactly one. */
export function hoursText(h: number): string {
  const r = Math.round(h * 10) / 10
  return `${r.toLocaleString("en-GB", { maximumFractionDigits: 1 })} ${r === 1 ? "hour" : "hours"}`
}

/** The four lines, in the order they happen on site. */
export function capturedWeekLines(w: CapturedWeek): string[] {
  const raised = w.variationsRaised + w.dayworksRaised
  const split =
    w.dayworksRaised > 0 && w.variationsRaised > 0
      ? ` (${plural(w.variationsRaised, "variation", "variations")}, ${plural(w.dayworksRaised, "daywork", "dayworks")})`
      : w.dayworksRaised > 0 && w.variationsRaised === 0
        ? ` (${plural(w.dayworksRaised, "daywork", "dayworks")})`
        : ""
  return [
    `${plural(w.photos, "photo", "photos")} taken`,
    `${plural(w.diaryEntries, "diary entry", "diary entries")}`,
    `${plural(raised, "variation", "variations")} raised${split}`,
    `${hoursText(w.hoursLogged)} logged`,
  ]
}

export function buildCapturedWeekEmail(w: CapturedWeek, appUrl = "https://app.getvantro.com") {
  // Names are whatever somebody typed; keep the subject inside what a mail
  // provider will accept (the variation email learned this the hard way).
  const name = w.companyName.replace(/\s+/g, " ").trim()
  const company = name.length > 80 ? `${name.slice(0, 79)}…` : name
  const label = weekLabel(w.weekStart)
  const lines = capturedWeekLines(w)
  const sentence = capturedSentence(w.uncaptured)
  const esc = (s: string) => s.replace(/[&<>"']/g, ch => `&#${ch.charCodeAt(0)};`)

  const subject = `${company}: what you captured this week, ${label}`
  const text = [
    `What ${company} captured on site, ${label}:`,
    "",
    ...lines.map(l => `- ${l}`),
    "",
    sentence,
    "",
    `Open Vantro: ${appUrl}/admin?tab=variations`,
  ].join("\n")

  const html = `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px">
  <div style="background:#00C896;width:40px;height:40px;border-radius:8px;text-align:center;line-height:40px;margin-bottom:24px">
    <span style="color:#07100D;font-weight:800;font-size:1rem">V</span>
  </div>
  <h2 style="color:#0A1A14;font-size:1.3rem;margin:0 0 4px">What you captured this week</h2>
  <p style="color:#4A6158;margin:0 0 20px">${esc(company)} &middot; ${esc(label)}</p>
  <table role="presentation" style="width:100%;border-collapse:collapse;margin-bottom:20px">
    ${lines.map(l => `<tr><td style="padding:10px 0;border-top:1px solid #E6ECE9;color:#0A1A14;font-size:15px">${esc(l)}</td></tr>`).join("\n    ")}
  </table>
  <p style="color:#0A1A14;font-size:15px;line-height:1.5;font-weight:600;margin:0 0 24px">${esc(sentence)}</p>
  <a href="${appUrl}/admin?tab=variations" style="display:inline-block;background:#00C896;color:#07100D;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:700">Open Variations</a>
  <p style="color:#888;font-size:12px;margin-top:24px">Sent on Fridays to admins of ${esc(company)} on the Suite plan.</p>
</div>`

  return { subject, text, html, lines, sentence }
}
